use axum_server::tls_rustls::RustlsConfig;
use greekgod_storage::{NativeAppDataStore, StorageError, StoredServiceIdentity};
use rcgen::{generate_simple_self_signed, CertifiedKey};
use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;
use zeroize::Zeroizing;

const WINDOWS_DPAPI_PROTECTION: &str = "windows-dpapi-current-user-v1";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServicePublicIdentity {
    pub service_id: String,
    pub certificate_fingerprint_sha256: String,
}

pub struct ServiceTlsIdentity {
    public: ServicePublicIdentity,
    certificate_der: Vec<u8>,
    private_key_der: Zeroizing<Vec<u8>>,
}

#[derive(Debug, Error)]
pub enum TlsIdentityError {
    #[error("TLS identity storage failed: {0}")]
    Storage(#[from] StorageError),
    #[error("TLS certificate generation failed: {0}")]
    CertificateGeneration(String),
    #[error("TLS private-key protection failed: {0}")]
    KeyProtection(String),
    #[error("TLS identity is invalid or corrupt: {0}")]
    InvalidIdentity(String),
    #[error("configured serviceId does not match the persisted TLS identity")]
    ServiceIdMismatch,
    #[error("TLS server configuration failed: {0}")]
    ServerConfiguration(String),
}

impl ServiceTlsIdentity {
    pub fn load_or_create(
        store: &NativeAppDataStore,
        requested_service_id: Option<&str>,
    ) -> Result<Self, TlsIdentityError> {
        if let Some(stored) = store.load_service_identity()? {
            if requested_service_id.is_some_and(|expected| expected != stored.service_id) {
                return Err(TlsIdentityError::ServiceIdMismatch);
            }
            return Self::from_stored(stored);
        }

        let service_id = requested_service_id
            .map(str::to_owned)
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        if service_id.trim().is_empty() {
            return Err(TlsIdentityError::InvalidIdentity(
                "serviceId cannot be blank".into(),
            ));
        }
        let CertifiedKey { cert, signing_key } = generate_simple_self_signed(vec![
            "greekgod.local".into(),
            "localhost".into(),
            "127.0.0.1".into(),
            "::1".into(),
        ])
        .map_err(|error| TlsIdentityError::CertificateGeneration(error.to_string()))?;
        let certificate_der = cert.der().to_vec();
        let private_key_der = Zeroizing::new(signing_key.serialize_der());
        let fingerprint = certificate_fingerprint(&certificate_der);
        let protected_private_key = protect_private_key(&private_key_der)?;
        let stored = store.create_service_identity(&StoredServiceIdentity {
            service_id,
            certificate_der,
            protected_private_key,
            key_protection: WINDOWS_DPAPI_PROTECTION.into(),
            certificate_fingerprint_sha256: fingerprint,
        })?;
        Self::from_stored(stored)
    }

    fn from_stored(stored: StoredServiceIdentity) -> Result<Self, TlsIdentityError> {
        if stored.key_protection != WINDOWS_DPAPI_PROTECTION {
            return Err(TlsIdentityError::InvalidIdentity(format!(
                "unsupported private-key protection {}",
                stored.key_protection
            )));
        }
        let actual_fingerprint = certificate_fingerprint(&stored.certificate_der);
        if actual_fingerprint != stored.certificate_fingerprint_sha256 {
            return Err(TlsIdentityError::InvalidIdentity(
                "certificate fingerprint does not match persisted certificate".into(),
            ));
        }
        let private_key_der = Zeroizing::new(unprotect_private_key(&stored.protected_private_key)?);
        if private_key_der.is_empty() {
            return Err(TlsIdentityError::InvalidIdentity(
                "decrypted private key is empty".into(),
            ));
        }
        Ok(Self {
            public: ServicePublicIdentity {
                service_id: stored.service_id,
                certificate_fingerprint_sha256: actual_fingerprint,
            },
            certificate_der: stored.certificate_der,
            private_key_der,
        })
    }

    pub fn public_identity(&self) -> ServicePublicIdentity {
        self.public.clone()
    }

    pub async fn rustls_config(&self) -> Result<RustlsConfig, TlsIdentityError> {
        RustlsConfig::from_der(
            vec![self.certificate_der.clone()],
            self.private_key_der.as_slice().to_vec(),
        )
        .await
        .map_err(|error| TlsIdentityError::ServerConfiguration(error.to_string()))
    }
}

pub fn ensure_crypto_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

fn certificate_fingerprint(certificate_der: &[u8]) -> String {
    format!("{:x}", Sha256::digest(certificate_der))
}

#[cfg(windows)]
fn protect_private_key(private_key: &[u8]) -> Result<Vec<u8>, TlsIdentityError> {
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input_length = u32::try_from(private_key.len()).map_err(|_| {
        TlsIdentityError::KeyProtection("private key is too large for Windows DPAPI".into())
    })?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: input_length,
        pbData: private_key.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let succeeded = unsafe {
        CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if succeeded == 0 {
        return Err(TlsIdentityError::KeyProtection(
            std::io::Error::last_os_error().to_string(),
        ));
    }
    copy_and_free_dpapi_output(output)
}

#[cfg(windows)]
fn unprotect_private_key(protected: &[u8]) -> Result<Vec<u8>, TlsIdentityError> {
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input_length = u32::try_from(protected.len()).map_err(|_| {
        TlsIdentityError::KeyProtection("protected key is too large for Windows DPAPI".into())
    })?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: input_length,
        pbData: protected.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let succeeded = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if succeeded == 0 {
        return Err(TlsIdentityError::KeyProtection(
            std::io::Error::last_os_error().to_string(),
        ));
    }
    copy_and_free_dpapi_output(output)
}

#[cfg(windows)]
fn copy_and_free_dpapi_output(
    output: windows_sys::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB,
) -> Result<Vec<u8>, TlsIdentityError> {
    use windows_sys::Win32::Foundation::LocalFree;

    if output.pbData.is_null() || output.cbData == 0 {
        if !output.pbData.is_null() {
            unsafe {
                let _ = LocalFree(output.pbData.cast());
            }
        }
        return Err(TlsIdentityError::KeyProtection(
            "Windows DPAPI returned empty key material".into(),
        ));
    }
    let bytes =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        std::ptr::write_bytes(output.pbData, 0, output.cbData as usize);
        let _ = LocalFree(output.pbData.cast());
    }
    Ok(bytes)
}

#[cfg(not(windows))]
fn protect_private_key(_private_key: &[u8]) -> Result<Vec<u8>, TlsIdentityError> {
    Err(TlsIdentityError::KeyProtection(
        "Sync Service TLS identity currently requires Windows DPAPI".into(),
    ))
}

#[cfg(not(windows))]
fn unprotect_private_key(_protected: &[u8]) -> Result<Vec<u8>, TlsIdentityError> {
    Err(TlsIdentityError::KeyProtection(
        "Sync Service TLS identity currently requires Windows DPAPI".into(),
    ))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use greekgod_storage::DATABASE_FILENAME;
    use tempfile::tempdir;

    fn store() -> (tempfile::TempDir, NativeAppDataStore) {
        let directory = tempdir().expect("temporary TLS identity directory");
        let store = NativeAppDataStore::new(directory.path().join(DATABASE_FILENAME))
            .expect("native store");
        (directory, store)
    }

    #[tokio::test]
    async fn identity_is_dpapi_protected_stable_and_usable_after_reopen() {
        ensure_crypto_provider();
        let (directory, store) = store();
        let first = ServiceTlsIdentity::load_or_create(&store, Some("service-tls-test"))
            .expect("create TLS identity");
        let first_public = first.public_identity();
        first.rustls_config().await.expect("first rustls config");
        let persisted = store
            .load_service_identity()
            .expect("load persisted identity")
            .expect("persisted identity");
        assert_eq!(persisted.key_protection, WINDOWS_DPAPI_PROTECTION);
        assert_ne!(
            persisted.protected_private_key,
            first.private_key_der.as_slice()
        );
        drop(first);

        let reopened = NativeAppDataStore::new(directory.path().join(DATABASE_FILENAME))
            .expect("simulated service update reopen");
        let after_update = ServiceTlsIdentity::load_or_create(&reopened, Some("service-tls-test"))
            .expect("load identity after update");
        assert_eq!(after_update.public_identity(), first_public);
        after_update
            .rustls_config()
            .await
            .expect("reopened rustls config");
    }

    #[test]
    fn service_id_change_and_corrupt_protected_key_fail_closed() {
        let (_directory, store) = store();
        ServiceTlsIdentity::load_or_create(&store, Some("service-tls-test"))
            .expect("create TLS identity");
        assert!(matches!(
            ServiceTlsIdentity::load_or_create(&store, Some("different-service")),
            Err(TlsIdentityError::ServiceIdMismatch)
        ));
        let mut corrupted = store
            .load_service_identity()
            .expect("load identity")
            .expect("stored identity");
        corrupted.protected_private_key = b"corrupt-key-material".to_vec();
        assert!(matches!(
            ServiceTlsIdentity::from_stored(corrupted),
            Err(TlsIdentityError::KeyProtection(_))
        ));
        assert!(unprotect_private_key(b"corrupt-key-material").is_err());
    }
}
