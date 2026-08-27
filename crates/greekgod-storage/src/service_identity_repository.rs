use crate::{NativeAppDataStore, StorageError, StorageResult};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::fmt;

#[derive(Clone, PartialEq, Eq)]
pub struct StoredServiceIdentity {
    pub service_id: String,
    pub certificate_der: Vec<u8>,
    pub protected_private_key: Vec<u8>,
    pub key_protection: String,
    pub certificate_fingerprint_sha256: String,
}

impl fmt::Debug for StoredServiceIdentity {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("StoredServiceIdentity")
            .field("service_id", &self.service_id)
            .field("certificate_der_bytes", &self.certificate_der.len())
            .field("protected_private_key", &"<redacted>")
            .field("key_protection", &self.key_protection)
            .field(
                "certificate_fingerprint_sha256",
                &self.certificate_fingerprint_sha256,
            )
            .finish()
    }
}

impl NativeAppDataStore {
    pub fn load_service_identity(&self) -> StorageResult<Option<StoredServiceIdentity>> {
        self.with_connection(|connection| load_service_identity(connection))
    }

    pub fn create_service_identity(
        &self,
        candidate: &StoredServiceIdentity,
    ) -> StorageResult<StoredServiceIdentity> {
        validate_identity(candidate)?;
        self.with_connection(|connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let existing = load_service_identity(&transaction)?;
            if let Some(existing) = existing {
                return if existing == *candidate {
                    Ok(existing)
                } else {
                    Err(StorageError::ServiceIdentityConflict)
                };
            }
            let updated = transaction.execute(
                r#"
                UPDATE sync_service_identity
                SET identity_state = 'ready',
                    service_id = ?1,
                    certificate_der = ?2,
                    protected_private_key = ?3,
                    key_protection = ?4,
                    certificate_fingerprint_sha256 = ?5,
                    created_at = CURRENT_TIMESTAMP
                WHERE singleton_id = 1 AND identity_state = 'uninitialized'
                "#,
                params![
                    candidate.service_id,
                    candidate.certificate_der,
                    candidate.protected_private_key,
                    candidate.key_protection,
                    candidate.certificate_fingerprint_sha256,
                ],
            )?;
            if updated != 1 {
                return Err(StorageError::InvalidServiceIdentity(
                    "identity state could not be initialized exactly once".into(),
                ));
            }
            transaction.commit()?;
            self.load_service_identity()?.ok_or_else(|| {
                StorageError::InvalidServiceIdentity(
                    "identity disappeared after committed initialization".into(),
                )
            })
        })
    }
}

fn load_service_identity(connection: &Connection) -> StorageResult<Option<StoredServiceIdentity>> {
    let row = connection
        .query_row(
            r#"
            SELECT identity_state,
                   service_id,
                   certificate_der,
                   protected_private_key,
                   key_protection,
                   certificate_fingerprint_sha256
            FROM sync_service_identity
            WHERE singleton_id = 1
            "#,
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<Vec<u8>>>(2)?,
                    row.get::<_, Option<Vec<u8>>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .optional()?;
    let Some((
        state,
        service_id,
        certificate_der,
        protected_private_key,
        key_protection,
        fingerprint,
    )) = row
    else {
        return Err(StorageError::InvalidServiceIdentity(
            "singleton identity state row is missing".into(),
        ));
    };
    match state.as_str() {
        "uninitialized" => {
            if service_id.is_some()
                || certificate_der.is_some()
                || protected_private_key.is_some()
                || key_protection.is_some()
                || fingerprint.is_some()
            {
                return Err(StorageError::InvalidServiceIdentity(
                    "uninitialized identity contains key material".into(),
                ));
            }
            Ok(None)
        }
        "ready" => {
            let identity = StoredServiceIdentity {
                service_id: required(service_id, "serviceId")?,
                certificate_der: required(certificate_der, "certificate")?,
                protected_private_key: required(protected_private_key, "private key")?,
                key_protection: required(key_protection, "key protection")?,
                certificate_fingerprint_sha256: required(fingerprint, "fingerprint")?,
            };
            validate_identity(&identity)?;
            Ok(Some(identity))
        }
        _ => Err(StorageError::InvalidServiceIdentity(format!(
            "unknown identity state {state}"
        ))),
    }
}

fn required<T>(value: Option<T>, field: &str) -> StorageResult<T> {
    value.ok_or_else(|| {
        StorageError::InvalidServiceIdentity(format!("ready identity is missing {field}"))
    })
}

fn validate_identity(identity: &StoredServiceIdentity) -> StorageResult<()> {
    if identity.service_id.trim().is_empty()
        || identity.certificate_der.is_empty()
        || identity.protected_private_key.is_empty()
        || identity.key_protection.trim().is_empty()
        || identity.certificate_fingerprint_sha256.len() != 64
        || !identity
            .certificate_fingerprint_sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(StorageError::InvalidServiceIdentity(
            "identity fields do not satisfy the storage contract".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DATABASE_FILENAME;
    use tempfile::tempdir;

    fn store() -> (tempfile::TempDir, NativeAppDataStore) {
        let directory = tempdir().expect("temporary service identity directory");
        let store = NativeAppDataStore::new(directory.path().join(DATABASE_FILENAME))
            .expect("native store");
        (directory, store)
    }

    fn identity(service_id: &str, marker: u8) -> StoredServiceIdentity {
        StoredServiceIdentity {
            service_id: service_id.into(),
            certificate_der: vec![marker, 2, 3],
            protected_private_key: vec![marker, 5, 6],
            key_protection: "test-protection".into(),
            certificate_fingerprint_sha256: format!("{marker:064x}"),
        }
    }

    #[test]
    fn identity_is_initialized_once_and_survives_reopen() {
        let (directory, store) = store();
        assert_eq!(store.load_service_identity().expect("initial state"), None);
        let expected = identity("service-a", 1);
        assert_eq!(
            store
                .create_service_identity(&expected)
                .expect("create identity"),
            expected
        );

        let reopened = NativeAppDataStore::new(directory.path().join(DATABASE_FILENAME))
            .expect("reopen native store");
        assert_eq!(
            reopened
                .load_service_identity()
                .expect("persisted identity"),
            Some(expected.clone())
        );
        assert_eq!(
            reopened
                .create_service_identity(&expected)
                .expect("idempotent create"),
            expected
        );
        assert!(matches!(
            reopened.create_service_identity(&identity("service-b", 2)),
            Err(StorageError::ServiceIdentityConflict)
        ));
    }

    #[test]
    fn missing_identity_state_fails_closed_instead_of_looking_like_first_run() {
        let (_directory, store) = store();
        store
            .with_connection(|connection| {
                connection.execute("DELETE FROM sync_service_identity", [])?;
                Ok(())
            })
            .expect("remove identity state for corruption test");

        assert!(matches!(
            store.load_service_identity(),
            Err(StorageError::InvalidServiceIdentity(_))
        ));
    }
}
