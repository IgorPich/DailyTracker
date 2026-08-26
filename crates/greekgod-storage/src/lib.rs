use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior, MAIN_DB};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use thiserror::Error;

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

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("SQLite database is unavailable: {0}")]
    DatabaseUnavailable(String),
    #[error("SQLite migration failed: {0}")]
    MigrationFailed(String),
    #[error("SQLite data is invalid or corrupt: {0}")]
    InvalidData(String),
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

const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    name: "mirror-current-app-data",
    sql: MIGRATION_1_SQL,
}];

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
    fn native_runtime_uses_wal_safe_bundled_sqlite() {
        let (_directory, store) = store();
        let probe = store.probe().expect("probe");

        assert!(sqlite_version_is_safe_for_multiple_writers(
            &probe.sqlite_version
        ));
        assert_eq!(probe.schema_version, 1);
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
