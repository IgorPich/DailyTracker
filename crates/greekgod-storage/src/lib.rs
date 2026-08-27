use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior, MAIN_DB};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use thiserror::Error;

mod legacy_bootstrap;
mod security_repository;
mod service_identity_repository;
mod sync_repository;

pub use legacy_bootstrap::*;
pub use security_repository::*;
pub use service_identity_repository::*;
pub use sync_repository::*;

pub const DATABASE_FILENAME: &str = "greekgod-v3.sqlite";
pub const MINIMUM_SAFE_WAL_SQLITE_VERSION: &str = "3.51.3";

const MIGRATION_1_SQL: &str = r#"
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;

    CREATE TABLE app_data (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      data_version INTEGER NOT NULL,
      payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
    ) STRICT;

    PRAGMA user_version = 1;
  "#;

const MIGRATION_2_SQL: &str = r#"
    CREATE TABLE sync_meta (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      global_revision INTEGER NOT NULL DEFAULT 0 CHECK (global_revision >= 0),
      bootstrap_state TEXT NOT NULL DEFAULT 'pending' CHECK (bootstrap_state IN ('pending', 'complete')),
      bootstrap_source_hash TEXT,
      bootstrap_completed_at TEXT
    ) STRICT;

    INSERT INTO sync_meta (singleton_id, global_revision, bootstrap_state)
    VALUES (1, 0, 'pending');

    CREATE TABLE sync_entities (
      entity_type TEXT NOT NULL CHECK (entity_type IN (
        'workout',
        'daily_entry',
        'training_template',
        'gym',
        'exercise_definition',
        'settings',
        'coach_note'
      )),
      entity_id TEXT NOT NULL CHECK (length(trim(entity_id)) > 0),
      revision INTEGER NOT NULL UNIQUE CHECK (revision > 0),
      created_revision INTEGER NOT NULL CHECK (created_revision > 0 AND created_revision <= revision),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by_device_id TEXT NOT NULL CHECK (length(trim(created_by_device_id)) > 0),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_by_device_id TEXT NOT NULL CHECK (length(trim(updated_by_device_id)) > 0),
      deleted_at TEXT,
      payload_json TEXT CHECK (payload_json IS NULL OR json_valid(payload_json)),
      CHECK (
        (deleted_at IS NULL AND payload_json IS NOT NULL)
        OR (deleted_at IS NOT NULL AND payload_json IS NULL)
      ),
      PRIMARY KEY (entity_type, entity_id)
    ) STRICT;

    CREATE INDEX sync_entities_revision_idx
      ON sync_entities (revision, entity_type, entity_id);

    CREATE TABLE sync_outbox (
      operation_id TEXT PRIMARY KEY CHECK (length(trim(operation_id)) > 0),
      change_set_id TEXT NOT NULL CHECK (length(trim(change_set_id)) > 0),
      device_id TEXT NOT NULL CHECK (length(trim(device_id)) > 0),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
      result_revision INTEGER NOT NULL CHECK (result_revision > 0),
      operation_type TEXT NOT NULL CHECK (operation_type IN ('upsert', 'delete')),
      payload_json TEXT CHECK (payload_json IS NULL OR json_valid(payload_json)),
      request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      last_attempt_at TEXT,
      acknowledged_at TEXT,
      CHECK (
        (operation_type = 'upsert' AND payload_json IS NOT NULL)
        OR (operation_type = 'delete' AND payload_json IS NULL)
      ),
      FOREIGN KEY (entity_type, entity_id)
        REFERENCES sync_entities (entity_type, entity_id)
    ) STRICT;

    CREATE INDEX sync_outbox_pending_idx
      ON sync_outbox (acknowledged_at, created_at, operation_id);

    CREATE TABLE applied_operations (
      operation_id TEXT PRIMARY KEY CHECK (length(trim(operation_id)) > 0),
      request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
      device_id TEXT NOT NULL CHECK (length(trim(device_id)) > 0),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      result_revision INTEGER NOT NULL CHECK (result_revision > 0),
      result_json TEXT NOT NULL CHECK (json_valid(result_json)),
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;

    CREATE INDEX applied_operations_entity_idx
      ON applied_operations (entity_type, entity_id, result_revision);

    CREATE TABLE gym_sync_identities (
      gym_id TEXT PRIMARY KEY CHECK (length(trim(gym_id)) > 0),
      legacy_name TEXT NOT NULL CHECK (length(trim(legacy_name)) > 0),
      legacy_ordinal INTEGER NOT NULL CHECK (legacy_ordinal >= 0),
      current_name TEXT NOT NULL CHECK (length(trim(current_name)) > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (legacy_name, legacy_ordinal)
    ) STRICT;

    PRAGMA user_version = 2;
  "#;

const MIGRATION_3_SQL: &str = r#"
    CREATE TABLE sync_entity_order (
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      updated_revision INTEGER NOT NULL CHECK (updated_revision > 0),
      PRIMARY KEY (entity_type, entity_id),
      FOREIGN KEY (entity_type, entity_id)
        REFERENCES sync_entities (entity_type, entity_id)
    ) STRICT;

    CREATE INDEX sync_entity_order_position_idx
      ON sync_entity_order (entity_type, position, entity_id);

    ALTER TABLE sync_outbox
      ADD COLUMN order_position INTEGER CHECK (order_position IS NULL OR order_position >= 0);

    CREATE INDEX sync_outbox_revision_idx
      ON sync_outbox (acknowledged_at, result_revision);

    PRAGMA user_version = 3;
  "#;

const MIGRATION_4_SQL: &str = r#"
    CREATE TABLE pairing_windows (
      nonce_hash TEXT PRIMARY KEY CHECK (length(nonce_hash) = 64),
      expires_at_epoch INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      consumed_at TEXT
    ) STRICT;

    CREATE INDEX pairing_windows_active_idx
      ON pairing_windows (consumed_at, expires_at_epoch);

    CREATE TABLE paired_devices (
      device_id TEXT PRIMARY KEY CHECK (length(trim(device_id)) > 0),
      display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
      token_hash TEXT NOT NULL CHECK (length(token_hash) = 64),
      paired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT,
      revoked_at TEXT
    ) STRICT;

    CREATE INDEX paired_devices_active_idx
      ON paired_devices (revoked_at, device_id);

    PRAGMA user_version = 4;
  "#;

const MIGRATION_5_SQL: &str = r#"
    CREATE TABLE sync_service_identity (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      identity_state TEXT NOT NULL CHECK (identity_state IN ('uninitialized', 'ready')),
      service_id TEXT UNIQUE,
      certificate_der BLOB,
      protected_private_key BLOB,
      key_protection TEXT,
      certificate_fingerprint_sha256 TEXT,
      created_at TEXT,
      CHECK (
        (
          identity_state = 'uninitialized'
          AND service_id IS NULL
          AND certificate_der IS NULL
          AND protected_private_key IS NULL
          AND key_protection IS NULL
          AND certificate_fingerprint_sha256 IS NULL
          AND created_at IS NULL
        )
        OR
        (
          identity_state = 'ready'
          AND length(trim(service_id)) > 0
          AND length(certificate_der) > 0
          AND length(protected_private_key) > 0
          AND length(trim(key_protection)) > 0
          AND length(certificate_fingerprint_sha256) = 64
          AND created_at IS NOT NULL
        )
      )
    ) STRICT;

    INSERT INTO sync_service_identity (singleton_id, identity_state)
    VALUES (1, 'uninitialized');

    PRAGMA user_version = 5;
  "#;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("SQLite database is unavailable: {0}")]
    DatabaseUnavailable(String),
    #[error("SQLite migration failed: {0}")]
    MigrationFailed(String),
    #[error("SQLite data is invalid or corrupt: {0}")]
    InvalidData(String),
    #[error("Invalid sync mutation: {0}")]
    InvalidMutation(String),
    #[error(
        "Sync conflict for {entity_type}/{entity_id}: base revision {base_revision}, current revision {current_revision}"
    )]
    Conflict {
        entity_type: String,
        entity_id: String,
        base_revision: i64,
        current_revision: i64,
    },
    #[error("Sync operation ID was reused with different content: {0}")]
    OperationIdReuse(String),
    #[error("Legacy sync bootstrap mismatch: {0}")]
    BootstrapMismatch(String),
    #[error("Pairing window is unavailable, expired or already consumed")]
    PairingWindowClosed,
    #[error("Device authentication failed")]
    UnauthorizedDevice,
    #[error("Secure random generation failed: {0}")]
    EntropyUnavailable(String),
    #[error("Sync Service TLS identity is invalid or corrupt: {0}")]
    InvalidServiceIdentity(String),
    #[error("Sync Service TLS identity already exists with different material")]
    ServiceIdentityConflict,
    #[error("SQLite operation failed: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Storage filesystem operation failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON serialization failed: {0}")]
    Json(#[from] serde_json::Error),
}

impl StorageError {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::DatabaseUnavailable(_) => "database-unavailable",
            Self::MigrationFailed(_) => "migration-failed",
            Self::InvalidData(_) => "invalid-or-corrupt-data",
            Self::InvalidMutation(_) => "invalid-mutation",
            Self::Conflict { .. } => "revision-conflict",
            Self::OperationIdReuse(_) => "operation-id-reuse",
            Self::BootstrapMismatch(_) => "bootstrap-mismatch",
            Self::PairingWindowClosed => "pairing_window_closed",
            Self::UnauthorizedDevice => "unauthorized_device",
            Self::EntropyUnavailable(_) => "entropy_unavailable",
            Self::InvalidServiceIdentity(_) => "invalid_service_identity",
            Self::ServiceIdentityConflict => "service_identity_conflict",
            Self::Sqlite(_) => "sqlite-operation-failed",
            Self::Io(_) => "filesystem-operation-failed",
            Self::Json(_) => "json-serialization-failed",
        }
    }
}

pub type StorageResult<T> = Result<T, StorageError>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeStorageProbe {
    pub database_path: PathBuf,
    pub sqlite_version: String,
    pub schema_version: i64,
    pub journal_mode: String,
}

#[derive(Clone, Debug)]
pub struct NativeAppDataStore {
    database_path: PathBuf,
}

struct Migration {
    version: i64,
    name: &'static str,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "mirror-current-app-data",
        sql: MIGRATION_1_SQL,
    },
    Migration {
        version: 2,
        name: "sync-ready-entity-metadata",
        sql: MIGRATION_2_SQL,
    },
    Migration {
        version: 3,
        name: "preserve-entity-order",
        sql: MIGRATION_3_SQL,
    },
    Migration {
        version: 4,
        name: "pairing-and-device-authentication",
        sql: MIGRATION_4_SQL,
    },
    Migration {
        version: 5,
        name: "persistent-sync-service-tls-identity",
        sql: MIGRATION_5_SQL,
    },
];

impl NativeAppDataStore {
    pub fn new(database_path: impl Into<PathBuf>) -> StorageResult<Self> {
        let database_path = database_path.into();
        if database_path.file_name().and_then(|value| value.to_str()) != Some(DATABASE_FILENAME) {
            return Err(StorageError::DatabaseUnavailable(format!(
                "database filename must be {DATABASE_FILENAME}"
            )));
        }
        if let Some(parent) = database_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let store = Self { database_path };
        store.with_connection(|_| Ok(()))?;
        Ok(store)
    }

    pub fn database_path(&self) -> &Path {
        &self.database_path
    }

    pub fn probe(&self) -> StorageResult<NativeStorageProbe> {
        self.with_connection(|connection| {
            let sqlite_version = sqlite_version(connection)?;
            let schema_version =
                connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
            let journal_mode =
                connection.pragma_query_value(None, "journal_mode", |row| row.get(0))?;
            Ok(NativeStorageProbe {
                database_path: self.database_path.clone(),
                sqlite_version,
                schema_version,
                journal_mode,
            })
        })
    }

    pub fn load(&self) -> StorageResult<Option<Value>> {
        self.with_connection(load_app_data)
    }

    pub fn replace_snapshot(&self, data: &Value) -> StorageResult<Value> {
        let data_version = app_data_version(data)?;
        let payload = serde_json::to_string(data)?;
        self.with_connection(|connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute(
                r#"
                INSERT INTO app_data (singleton_id, data_version, payload_json)
                VALUES (1, ?1, ?2)
                ON CONFLICT(singleton_id) DO UPDATE SET
                  data_version = excluded.data_version,
                  payload_json = excluded.payload_json
                "#,
                params![data_version, payload],
            )?;
            transaction.commit()?;
            load_app_data(connection)?.ok_or_else(|| {
                StorageError::InvalidData("snapshot disappeared after a committed write".into())
            })
        })
    }

    pub fn backup_snapshot_before_import(&self, data: &Value) -> StorageResult<PathBuf> {
        let expected = self.replace_snapshot(data)?;
        let backup_path = self.backup_path_for(&expected)?;
        self.with_connection(|connection| {
            if !backup_path.exists() {
                connection.backup(MAIN_DB, &backup_path, None)?;
            }
            verify_backup(&backup_path, &expected)?;
            Ok(backup_path.clone())
        })
    }

    pub fn integrity_check(&self) -> StorageResult<()> {
        self.with_connection(|connection| {
            let result: String =
                connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
            if result == "ok" {
                Ok(())
            } else {
                Err(StorageError::InvalidData(format!(
                    "PRAGMA integrity_check returned {result}"
                )))
            }
        })
    }

    fn with_connection<T>(
        &self,
        operation: impl FnOnce(&mut Connection) -> StorageResult<T>,
    ) -> StorageResult<T> {
        let mut connection = Connection::open(&self.database_path)
            .map_err(|error| StorageError::DatabaseUnavailable(error.to_string()))?;
        configure_connection(&mut connection)?;
        apply_migrations(&mut connection)?;
        operation(&mut connection)
    }

    fn backup_path_for(&self, data: &Value) -> StorageResult<PathBuf> {
        let payload = serde_json::to_vec(data)?;
        let fingerprint = format!("{:x}", Sha256::digest(payload));
        let filename = format!(
            "{DATABASE_FILENAME}.pre-import-{}.backup.sqlite",
            &fingerprint[..16]
        );
        self.database_path
            .parent()
            .map(|parent| parent.join(filename))
            .ok_or_else(|| {
                StorageError::DatabaseUnavailable("database has no parent directory".into())
            })
    }
}

#[cfg(feature = "stress-harness")]
#[doc(hidden)]
pub fn open_stress_harness_connection(database_path: &Path) -> StorageResult<Connection> {
    if database_path.file_name().and_then(|value| value.to_str()) != Some(DATABASE_FILENAME) {
        return Err(StorageError::DatabaseUnavailable(format!(
            "stress database filename must be {DATABASE_FILENAME}"
        )));
    }
    let mut connection = Connection::open(database_path)
        .map_err(|error| StorageError::DatabaseUnavailable(error.to_string()))?;
    configure_connection(&mut connection)?;
    apply_migrations(&mut connection)?;
    connection.busy_timeout(Duration::from_millis(1))?;
    Ok(connection)
}

fn configure_connection(connection: &mut Connection) -> StorageResult<()> {
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    let journal_mode: String =
        connection.query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))?;
    if !journal_mode.eq_ignore_ascii_case("wal") {
        return Err(StorageError::DatabaseUnavailable(format!(
            "expected WAL journal mode, received {journal_mode}"
        )));
    }
    connection.pragma_update(None, "synchronous", "FULL")?;
    connection.pragma_update(None, "wal_autocheckpoint", 1000)?;
    let version = sqlite_version(connection)?;
    if !sqlite_version_is_safe_for_multiple_writers(&version) {
        return Err(StorageError::DatabaseUnavailable(format!(
            "SQLite {version} is older than the required WAL-safe {MINIMUM_SAFE_WAL_SQLITE_VERSION}"
        )));
    }
    Ok(())
}

fn sqlite_version(connection: &Connection) -> StorageResult<String> {
    Ok(connection.query_row("SELECT sqlite_version()", [], |row| row.get(0))?)
}

pub fn sqlite_version_is_safe_for_multiple_writers(version: &str) -> bool {
    let parsed = parse_version(version);
    parsed >= parse_version(MINIMUM_SAFE_WAL_SQLITE_VERSION)
        || parsed == [3, 50, 7]
        || parsed == [3, 44, 6]
}

fn parse_version(version: &str) -> [u64; 3] {
    let mut values = version
        .split('.')
        .take(3)
        .map(|part| part.parse::<u64>().unwrap_or_default());
    [
        values.next().unwrap_or_default(),
        values.next().unwrap_or_default(),
        values.next().unwrap_or_default(),
    ]
}

fn migration_checksum(sql: &str) -> String {
    format!("{:x}", Sha256::digest(sql.as_bytes()))
}

fn migration_table_exists(connection: &Connection) -> StorageResult<bool> {
    Ok(connection
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn apply_migrations(connection: &mut Connection) -> StorageResult<()> {
    if migration_table_exists(connection)? {
        let mut statement = connection.prepare(
            "SELECT version, name, checksum FROM schema_migrations ORDER BY version ASC",
        )?;
        let applied = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        for (version, name, checksum) in applied {
            let migration = MIGRATIONS
                .iter()
                .find(|migration| migration.version == version);
            match migration {
                Some(migration)
                    if migration.name == name && migration_checksum(migration.sql) == checksum => {}
                _ => {
                    return Err(StorageError::MigrationFailed(format!(
                        "migration {version} does not match its recorded name/checksum"
                    )))
                }
            }
        }
    }

    for migration in MIGRATIONS {
        let already_applied = if migration_table_exists(connection)? {
            connection
                .query_row(
                    "SELECT 1 FROM schema_migrations WHERE version = ?1",
                    [migration.version],
                    |_| Ok(()),
                )
                .optional()?
                .is_some()
        } else {
            false
        };
        if already_applied {
            continue;
        }

        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| StorageError::MigrationFailed(error.to_string()))?;
        transaction
            .execute_batch(migration.sql)
            .map_err(|error| StorageError::MigrationFailed(error.to_string()))?;
        transaction
            .execute(
                "INSERT INTO schema_migrations (version, name, checksum) VALUES (?1, ?2, ?3)",
                params![
                    migration.version,
                    migration.name,
                    migration_checksum(migration.sql)
                ],
            )
            .map_err(|error| StorageError::MigrationFailed(error.to_string()))?;
        transaction
            .commit()
            .map_err(|error| StorageError::MigrationFailed(error.to_string()))?;
    }
    Ok(())
}

fn app_data_version(data: &Value) -> StorageResult<i64> {
    data.as_object()
        .and_then(|object| object.get("version"))
        .and_then(Value::as_i64)
        .ok_or_else(|| StorageError::InvalidData("AppData.version must be an integer".into()))
}

fn load_app_data(connection: &mut Connection) -> StorageResult<Option<Value>> {
    let row = connection
        .query_row(
            "SELECT data_version, payload_json FROM app_data WHERE singleton_id = 1",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let Some((data_version, payload)) = row else {
        return Ok(None);
    };
    let parsed: Value = serde_json::from_str(&payload)?;
    if app_data_version(&parsed)? != data_version {
        return Err(StorageError::InvalidData(
            "data_version does not match payload version".into(),
        ));
    }
    Ok(Some(parsed))
}

fn verify_backup(path: &Path, expected: &Value) -> StorageResult<()> {
    let mut connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let integrity: String = connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err(StorageError::InvalidData(format!(
            "backup integrity_check returned {integrity}"
        )));
    }
    let actual = load_app_data(&mut connection)?.ok_or_else(|| {
        StorageError::InvalidData("verified backup does not contain an AppData snapshot".into())
    })?;
    if &actual != expected {
        return Err(StorageError::InvalidData(
            "verified backup differs from the requested AppData snapshot".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    fn fixture() -> Value {
        json!({
            "version": 4,
            "dailyEntries": [
                { "id": "daily-z", "date": "2026-08-26", "weight": 82.35 },
                { "id": "daily-a", "date": "2026-08-25", "protein": 195 }
            ],
            "workouts": [{
                "id": "workout-z",
                "date": "2026-08-26",
                "templateId": "template-a",
                "templateCode": "A",
                "templateName": "PUSH",
                "exercises": [{
                    "id": "row-z",
                    "exerciseId": "bench-press",
                    "name": "Bench Press",
                    "sets": [
                        { "id": "set-z", "weight": 90.5, "reps": 6 },
                        { "id": "set-a", "weight": 85, "reps": 8 }
                    ]
                }]
            }],
            "templates": [],
            "exerciseLibrary": [],
            "settings": {
                "phase": "Maintenance",
                "calorieTarget": 2800,
                "proteinTarget": 160,
                "trendThresholds": {
                    "lossBelow": -0.15,
                    "stableUpper": 0.05,
                    "slowGainUpper": 0.2
                }
            },
            "coachNotes": {}
        })
    }

    fn store() -> (tempfile::TempDir, NativeAppDataStore) {
        let directory = tempdir().expect("temporary directory");
        let store = NativeAppDataStore::new(directory.path().join(DATABASE_FILENAME))
            .expect("native store");
        (directory, store)
    }

    #[test]
    fn phase_two_migration_checksum_is_preserved_exactly() {
        assert_eq!(
            migration_checksum(MIGRATION_1_SQL),
            "59ed5e8b139970d7079f94364d7dba5167633eec97c847727ca5422496461b6b"
        );
    }

    #[test]
    fn sync_ready_migration_checksum_is_preserved_exactly() {
        assert_eq!(
            migration_checksum(MIGRATION_2_SQL),
            "98727da50f74fe43aed0d509aa500c44729b59100eb11ca255b668ac43175ae1"
        );
    }

    #[test]
    fn entity_order_migration_checksum_is_preserved_exactly() {
        assert_eq!(
            migration_checksum(MIGRATION_3_SQL),
            "e749f770e7180dabd722782a51a4f87b2e4af834ba785ad2ed6873ca621739ee"
        );
    }

    #[test]
    fn pairing_migration_checksum_is_preserved_exactly() {
        assert_eq!(
            migration_checksum(MIGRATION_4_SQL),
            "c06937379acaf4c7467b5b290e129c019904ca894a0ac1221110a2c6fb14a995"
        );
    }

    #[test]
    fn service_identity_migration_checksum_is_preserved_exactly() {
        assert_eq!(
            migration_checksum(MIGRATION_5_SQL),
            "7ed285d69a41530878341febde946b94f76b3ece5d5b059b02019ce886f6d1ff"
        );
    }

    #[test]
    fn sync_ready_schema_is_additive_and_starts_without_projected_entities() {
        let (_directory, store) = store();
        store
            .with_connection(|connection| {
                let tables = [
                    "app_data",
                    "sync_meta",
                    "sync_entities",
                    "sync_outbox",
                    "applied_operations",
                    "gym_sync_identities",
                    "sync_entity_order",
                    "pairing_windows",
                    "paired_devices",
                    "sync_service_identity",
                ];
                for table in tables {
                    let exists: i64 = connection.query_row(
                        "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = ?1",
                        [table],
                        |row| row.get(0),
                    )?;
                    assert_eq!(exists, 1, "missing table {table}");
                }
                let meta: (i64, String) = connection.query_row(
                    "SELECT global_revision, bootstrap_state FROM sync_meta WHERE singleton_id = 1",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?;
                let entity_count: i64 =
                    connection
                        .query_row("SELECT COUNT(*) FROM sync_entities", [], |row| row.get(0))?;
                assert_eq!(meta, (0, "pending".into()));
                assert_eq!(entity_count, 0);
                Ok(())
            })
            .expect("inspect sync-ready schema");
    }

    #[test]
    fn native_runtime_uses_wal_safe_bundled_sqlite() {
        let (_directory, store) = store();
        let probe = store.probe().expect("probe");

        assert!(sqlite_version_is_safe_for_multiple_writers(
            &probe.sqlite_version
        ));
        assert_eq!(probe.schema_version, 5);
        assert_eq!(probe.journal_mode.to_ascii_lowercase(), "wal");
    }

    #[test]
    fn complete_snapshot_round_trips_without_reordering() {
        let (_directory, store) = store();
        let fixture = fixture();

        let loaded = store.replace_snapshot(&fixture).expect("replace snapshot");

        assert_eq!(loaded, fixture);
        assert_eq!(
            loaded["workouts"][0]["exercises"][0]["sets"][0]["id"],
            "set-z"
        );
        store.integrity_check().expect("integrity check");
    }

    #[test]
    fn reopen_reads_the_same_snapshot() {
        let (directory, store) = store();
        let fixture = fixture();
        store.replace_snapshot(&fixture).expect("replace snapshot");

        let reopened = NativeAppDataStore::new(directory.path().join(DATABASE_FILENAME))
            .expect("reopened store");

        assert_eq!(reopened.load().expect("load"), Some(fixture));
    }

    #[test]
    fn online_backup_is_verified_for_fresh_and_existing_database() {
        let (_directory, store) = store();
        let fixture = fixture();

        let fresh_backup = store
            .backup_snapshot_before_import(&fixture)
            .expect("fresh backup");
        let existing_backup = store
            .backup_snapshot_before_import(&fixture)
            .expect("existing backup");

        assert_eq!(fresh_backup, existing_backup);
        assert!(fresh_backup.exists());
        verify_backup(&fresh_backup, &fixture).expect("verified backup");
    }

    #[test]
    fn errors_keep_stable_structural_categories() {
        let (_directory, store) = store();
        let error = store
            .replace_snapshot(&json!({ "version": "not-an-integer" }))
            .expect_err("invalid snapshot must fail");

        assert_eq!(error.kind(), "invalid-or-corrupt-data");

        let wrong_path =
            NativeAppDataStore::new(store.database_path().with_file_name("wrong.sqlite"))
                .expect_err("wrong filename must fail");
        assert_eq!(wrong_path.kind(), "database-unavailable");
    }
}
