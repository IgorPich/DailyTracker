use crate::{NativeAppDataStore, StorageError, StorageResult};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use subtle::ConstantTimeEq;

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PairingWindow {
    pub nonce: String,
    pub expires_at_epoch: i64,
}

impl fmt::Debug for PairingWindow {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PairingWindow")
            .field("nonce", &"<redacted>")
            .field("expires_at_epoch", &self.expires_at_epoch)
            .finish()
    }
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PairedDeviceCredentials {
    pub device_id: String,
    pub device_token: String,
}

impl fmt::Debug for PairedDeviceCredentials {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PairedDeviceCredentials")
            .field("device_id", &self.device_id)
            .field("device_token", &"<redacted>")
            .finish()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PairedDevice {
    pub device_id: String,
    pub display_name: String,
    pub paired_at: String,
    pub last_seen_at: Option<String>,
    pub revoked_at: Option<String>,
}

impl NativeAppDataStore {
    pub fn open_pairing_window(&self, ttl_seconds: u64) -> StorageResult<PairingWindow> {
        if !(1..=900).contains(&ttl_seconds) {
            return Err(StorageError::InvalidMutation(
                "pairing window TTL must be 1..=900 seconds".into(),
            ));
        }
        let nonce = secure_random_hex::<16>()?;
        let nonce_hash = hash_secret(&nonce);
        self.with_connection(|connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute(
                "DELETE FROM pairing_windows WHERE consumed_at IS NOT NULL OR expires_at_epoch <= unixepoch()",
                [],
            )?;
            transaction.execute(
                "UPDATE pairing_windows SET consumed_at = CURRENT_TIMESTAMP WHERE consumed_at IS NULL",
                [],
            )?;
            let expires_at_epoch: i64 = transaction.query_row(
                r#"
                INSERT INTO pairing_windows (nonce_hash, expires_at_epoch)
                VALUES (?1, unixepoch() + ?2)
                RETURNING expires_at_epoch
                "#,
                params![nonce_hash, ttl_seconds as i64],
                |row| row.get(0),
            )?;
            transaction.commit()?;
            Ok(PairingWindow {
                nonce,
                expires_at_epoch,
            })
        })
    }

    pub fn pair_device(
        &self,
        nonce: &str,
        device_id: &str,
        display_name: &str,
    ) -> StorageResult<PairedDeviceCredentials> {
        if nonce.trim().is_empty() || device_id.trim().is_empty() || display_name.trim().is_empty()
        {
            return Err(StorageError::InvalidMutation(
                "pairing nonce, deviceId and displayName cannot be blank".into(),
            ));
        }
        let nonce_hash = hash_secret(nonce);
        let device_token = secure_random_hex::<32>()?;
        let token_hash = hash_secret(&device_token);
        self.with_connection(|connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let consumed = transaction.execute(
                r#"
                UPDATE pairing_windows
                SET consumed_at = CURRENT_TIMESTAMP
                WHERE nonce_hash = ?1
                  AND consumed_at IS NULL
                  AND expires_at_epoch > unixepoch()
                "#,
                [&nonce_hash],
            )?;
            if consumed != 1 {
                return Err(StorageError::PairingWindowClosed);
            }
            transaction.execute(
                r#"
                INSERT INTO paired_devices (device_id, display_name, token_hash)
                VALUES (?1, ?2, ?3)
                ON CONFLICT(device_id) DO UPDATE SET
                  display_name = excluded.display_name,
                  token_hash = excluded.token_hash,
                  paired_at = CURRENT_TIMESTAMP,
                  last_seen_at = NULL,
                  revoked_at = NULL
                "#,
                params![device_id, display_name, token_hash],
            )?;
            transaction.commit()?;
            Ok(PairedDeviceCredentials {
                device_id: device_id.into(),
                device_token,
            })
        })
    }

    pub fn authenticate_device(&self, device_id: &str, device_token: &str) -> StorageResult<()> {
        self.with_connection(|connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let expected_hash = transaction
                .query_row(
                    r#"
                    SELECT token_hash
                    FROM paired_devices
                    WHERE device_id = ?1 AND revoked_at IS NULL
                    "#,
                    [device_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            let actual_hash = hash_secret(device_token);
            let comparison_hash = expected_hash.as_deref().unwrap_or(
                "0000000000000000000000000000000000000000000000000000000000000000",
            );
            let hash_matches =
                bool::from(comparison_hash.as_bytes().ct_eq(actual_hash.as_bytes()));
            if expected_hash.is_none() || !hash_matches {
                return Err(StorageError::UnauthorizedDevice);
            }
            let updated = transaction.execute(
                "UPDATE paired_devices SET last_seen_at = CURRENT_TIMESTAMP WHERE device_id = ?1 AND revoked_at IS NULL",
                [device_id],
            )?;
            if updated != 1 {
                return Err(StorageError::UnauthorizedDevice);
            }
            transaction.commit()?;
            Ok(())
        })
    }

    pub fn revoke_device(&self, device_id: &str) -> StorageResult<bool> {
        self.with_connection(|connection| {
            Ok(connection.execute(
                r#"
                UPDATE paired_devices
                SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
                WHERE device_id = ?1
                "#,
                [device_id],
            )? == 1)
        })
    }

    pub fn paired_devices(&self) -> StorageResult<Vec<PairedDevice>> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                r#"
                SELECT device_id, display_name, paired_at, last_seen_at, revoked_at
                FROM paired_devices
                ORDER BY paired_at ASC, device_id ASC
                "#,
            )?;
            let devices = statement
                .query_map([], |row| {
                    Ok(PairedDevice {
                        device_id: row.get(0)?,
                        display_name: row.get(1)?,
                        paired_at: row.get(2)?,
                        last_seen_at: row.get(3)?,
                        revoked_at: row.get(4)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(devices)
        })
    }
}

fn secure_random_hex<const N: usize>() -> StorageResult<String> {
    let mut bytes = [0_u8; N];
    getrandom::fill(&mut bytes)
        .map_err(|error| StorageError::EntropyUnavailable(error.to_string()))?;
    Ok(hex(&bytes))
}

fn hash_secret(secret: &str) -> String {
    hex(&Sha256::digest(secret.as_bytes()))
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DATABASE_FILENAME;
    use tempfile::tempdir;

    fn store() -> (tempfile::TempDir, NativeAppDataStore) {
        let directory = tempdir().expect("temporary security directory");
        let store = NativeAppDataStore::new(directory.path().join(DATABASE_FILENAME))
            .expect("native store");
        (directory, store)
    }

    #[test]
    fn pairing_nonce_is_one_time_and_only_secret_hashes_are_persisted() {
        let (_directory, store) = store();
        let window = store.open_pairing_window(120).expect("pairing window");
        let credentials = store
            .pair_device(&window.nonce, "mobile-a", "Gym phone")
            .expect("pair device");

        assert_eq!(window.nonce.len(), 32);
        assert_eq!(credentials.device_token.len(), 64);
        assert!(!format!("{window:?}").contains(&window.nonce));
        assert!(!format!("{credentials:?}").contains(&credentials.device_token));
        assert!(matches!(
            store.pair_device(&window.nonce, "mobile-b", "Other phone"),
            Err(StorageError::PairingWindowClosed)
        ));
        store
            .with_connection(|connection| {
                let stored_nonce_hash: String =
                    connection.query_row("SELECT nonce_hash FROM pairing_windows", [], |row| {
                        row.get(0)
                    })?;
                let stored_token_hash: String = connection.query_row(
                    "SELECT token_hash FROM paired_devices WHERE device_id = 'mobile-a'",
                    [],
                    |row| row.get(0),
                )?;
                assert_ne!(stored_nonce_hash, window.nonce);
                assert_ne!(stored_token_hash, credentials.device_token);
                assert_eq!(stored_nonce_hash.len(), 64);
                assert_eq!(stored_token_hash.len(), 64);
                Ok(())
            })
            .expect("inspect hashes");
    }

    #[test]
    fn authentication_is_constant_shape_and_revocation_fails_closed() {
        let (_directory, store) = store();
        let window = store.open_pairing_window(120).expect("pairing window");
        let credentials = store
            .pair_device(&window.nonce, "mobile-a", "Gym phone")
            .expect("pair device");

        store
            .authenticate_device("mobile-a", &credentials.device_token)
            .expect("authenticate");
        assert!(matches!(
            store.authenticate_device("mobile-a", "wrong-token"),
            Err(StorageError::UnauthorizedDevice)
        ));
        assert!(matches!(
            store.authenticate_device("unknown-device", &credentials.device_token),
            Err(StorageError::UnauthorizedDevice)
        ));
        assert!(store.revoke_device("mobile-a").expect("revoke"));
        assert!(matches!(
            store.authenticate_device("mobile-a", &credentials.device_token),
            Err(StorageError::UnauthorizedDevice)
        ));
        let devices = store.paired_devices().expect("paired devices");
        assert_eq!(devices.len(), 1);
        assert!(devices[0].last_seen_at.is_some());
        assert!(devices[0].revoked_at.is_some());
    }

    #[test]
    fn expired_pairing_window_cannot_be_used() {
        let (_directory, store) = store();
        let window = store.open_pairing_window(120).expect("pairing window");
        store
            .with_connection(|connection| {
                connection.execute("UPDATE pairing_windows SET expires_at_epoch = 0", [])?;
                Ok(())
            })
            .expect("expire window");

        assert!(matches!(
            store.pair_device(&window.nonce, "mobile-a", "Gym phone"),
            Err(StorageError::PairingWindowClosed)
        ));
        assert!(store.paired_devices().expect("devices").is_empty());
    }

    #[test]
    fn opening_a_new_pairing_window_invalidates_the_previous_window() {
        let (_directory, store) = store();
        let previous = store.open_pairing_window(120).expect("previous window");
        let current = store.open_pairing_window(120).expect("current window");

        assert!(matches!(
            store.pair_device(&previous.nonce, "mobile-old", "Old phone"),
            Err(StorageError::PairingWindowClosed)
        ));
        store
            .pair_device(&current.nonce, "mobile-current", "Current phone")
            .expect("current pairing window remains active");
    }

    #[test]
    fn concurrent_pairing_consumes_a_nonce_exactly_once() {
        use std::sync::{Arc, Barrier};
        use std::thread;

        let (_directory, store) = store();
        let window = store.open_pairing_window(120).expect("pairing window");
        let barrier = Arc::new(Barrier::new(3));
        let attempts = ["mobile-a", "mobile-b"]
            .into_iter()
            .map(|device_id| {
                let attempt_store = store.clone();
                let attempt_barrier = barrier.clone();
                let nonce = window.nonce.clone();
                thread::spawn(move || {
                    attempt_barrier.wait();
                    attempt_store.pair_device(&nonce, device_id, device_id)
                })
            })
            .collect::<Vec<_>>();
        barrier.wait();
        let results = attempts
            .into_iter()
            .map(|attempt| attempt.join().expect("pairing thread"))
            .collect::<Vec<_>>();

        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, Err(StorageError::PairingWindowClosed)))
                .count(),
            1
        );
        assert_eq!(store.paired_devices().expect("paired devices").len(), 1);
    }
}
