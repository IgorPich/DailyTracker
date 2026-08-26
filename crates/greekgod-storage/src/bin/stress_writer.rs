use greekgod_storage::open_stress_harness_connection;
use rusqlite::{ffi::ErrorCode, params, TransactionBehavior};
use serde::Serialize;
use std::env;
use std::path::PathBuf;
use std::thread;
use std::time::Duration;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WriterStats {
    writer_id: String,
    start_index: u64,
    operations: u64,
    busy_retries: u64,
    sqlite_version: String,
}

fn argument(index: usize, name: &str) -> String {
    env::args()
        .nth(index)
        .unwrap_or_else(|| panic!("missing {name}"))
}

fn is_busy(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(details, _)
            if matches!(details.code, ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked)
    )
}

fn write_operation(
    connection: &mut rusqlite::Connection,
    writer_id: &str,
    operation_index: u64,
) -> rusqlite::Result<()> {
    let entity_id = format!("{writer_id}:entity:{}", operation_index % 64);
    let operation_id = format!("{writer_id}:operation:{operation_index}");
    let tombstone = operation_index % 11 == 0;
    let operation_type = if tombstone { "delete" } else { "upsert" };
    let payload = (!tombstone)
        .then(|| format!(r#"{{"writer":"{writer_id}","operation":{operation_index}}}"#));

    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    transaction.execute(
        r#"
        INSERT INTO stress_operations (operation_id, writer_id, operation_index, operation_type)
        VALUES (?1, ?2, ?3, ?4)
        "#,
        params![
            operation_id,
            writer_id,
            operation_index as i64,
            operation_type
        ],
    )?;
    transaction.execute(
        r#"
        INSERT INTO stress_entities (entity_id, revision, deleted, payload_json)
        VALUES (?1, 1, ?2, ?3)
        ON CONFLICT(entity_id) DO UPDATE SET
          revision = stress_entities.revision + 1,
          deleted = excluded.deleted,
          payload_json = excluded.payload_json
        "#,
        params![entity_id, tombstone, payload],
    )?;
    transaction.execute(
        "UPDATE stress_counter SET committed_operations = committed_operations + 1 WHERE singleton_id = 1",
        [],
    )?;
    transaction.commit()
}

fn main() {
    let database_path = PathBuf::from(argument(1, "database path"));
    let writer_id = argument(2, "writer id");
    let start_index = argument(3, "start index")
        .parse::<u64>()
        .expect("start index must be an integer");
    let operations = argument(4, "operation count")
        .parse::<u64>()
        .expect("operation count must be an integer");
    let mut connection = open_stress_harness_connection(&database_path)
        .expect("open native stress harness connection");
    let sqlite_version: String = connection
        .query_row("SELECT sqlite_version()", [], |row| row.get(0))
        .expect("read SQLite version");
    let mut busy_retries = 0_u64;

    for operation_index in start_index..start_index + operations {
        let mut attempt = 0_u32;
        loop {
            match write_operation(&mut connection, &writer_id, operation_index) {
                Ok(()) => break,
                Err(error) if is_busy(&error) && attempt < 100 => {
                    attempt += 1;
                    busy_retries += 1;
                    let backoff_ms = u64::from((attempt * 2).min(50));
                    thread::sleep(Duration::from_millis(backoff_ms));
                }
                Err(error) => panic!(
                    "writer {writer_id} failed operation {operation_index} after {attempt} retries: {error}"
                ),
            }
        }

        if operation_index % 97 == 0 {
            let _ = connection.query_row("PRAGMA wal_checkpoint(PASSIVE)", [], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            });
        }
        if operation_index % 13 == 0 {
            thread::sleep(Duration::from_millis(1));
        }
    }

    println!(
        "{}",
        serde_json::to_string(&WriterStats {
            writer_id,
            start_index,
            operations,
            busy_retries,
            sqlite_version,
        })
        .expect("serialize writer stats")
    );
}
