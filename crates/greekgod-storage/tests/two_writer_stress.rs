#![cfg(feature = "stress-harness")]

use greekgod_storage::{
    open_stress_harness_connection, sqlite_version_is_safe_for_multiple_writers,
    NativeAppDataStore, DATABASE_FILENAME,
};
use serde::Deserialize;
use std::path::Path;
use std::process::{Child, Command, Output, Stdio};
use std::thread;
use std::time::Duration;
use tempfile::tempdir;

const WRITER_BINARY: &str = env!("CARGO_BIN_EXE_greekgod-storage-stress-writer");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriterStats {
    writer_id: String,
    start_index: u64,
    operations: u64,
    busy_retries: u64,
    sqlite_version: String,
}

fn spawn_writer(database_path: &Path, writer_id: &str, start_index: u64, operations: u64) -> Child {
    Command::new(WRITER_BINARY)
        .arg(database_path)
        .arg(writer_id)
        .arg(start_index.to_string())
        .arg(operations.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn independent writer process")
}

fn successful_stats(output: Output) -> WriterStats {
    assert!(
        output.status.success(),
        "writer failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("parse writer stats")
}

#[test]
fn two_independent_processes_survive_contention_restart_and_wal_reset() {
    let directory = tempdir().expect("temporary stress directory");
    let database_path = directory.path().join(DATABASE_FILENAME);
    NativeAppDataStore::new(&database_path).expect("initialize native SQLite");

    let mut coordinator =
        open_stress_harness_connection(&database_path).expect("open coordinator connection");
    coordinator
        .execute_batch(
            r#"
            CREATE TABLE stress_entities (
              entity_id TEXT PRIMARY KEY,
              revision INTEGER NOT NULL,
              deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
              payload_json TEXT CHECK (payload_json IS NULL OR json_valid(payload_json))
            ) STRICT;
            CREATE TABLE stress_operations (
              operation_id TEXT PRIMARY KEY,
              writer_id TEXT NOT NULL,
              operation_index INTEGER NOT NULL,
              operation_type TEXT NOT NULL CHECK (operation_type IN ('upsert', 'delete')),
              UNIQUE(writer_id, operation_index)
            ) STRICT;
            CREATE TABLE stress_counter (
              singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
              committed_operations INTEGER NOT NULL
            ) STRICT;
            INSERT INTO stress_counter (singleton_id, committed_operations) VALUES (1, 0);
            PRAGMA wal_autocheckpoint = 16;
            "#,
        )
        .expect("create isolated stress schema");

    let blocker = coordinator
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .expect("hold initial write lock");
    let desktop_writer = spawn_writer(&database_path, "desktop", 0, 1_200);
    let service_writer_first_run = spawn_writer(&database_path, "service", 0, 500);
    thread::sleep(Duration::from_millis(250));
    blocker.commit().expect("release initial contention lock");

    let service_first = successful_stats(
        service_writer_first_run
            .wait_with_output()
            .expect("wait for first service process"),
    );
    let checkpoint_during_desktop: (i64, i64, i64) = coordinator
        .query_row("PRAGMA wal_checkpoint(RESTART)", [], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .expect("checkpoint while desktop-like writer remains active");

    let service_writer_after_restart = spawn_writer(&database_path, "service", 500, 500);
    let service_second = successful_stats(
        service_writer_after_restart
            .wait_with_output()
            .expect("wait for restarted service process"),
    );
    let desktop = successful_stats(
        desktop_writer
            .wait_with_output()
            .expect("wait for desktop process"),
    );

    let final_checkpoint: (i64, i64, i64) = coordinator
        .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .expect("final WAL reset");
    let operation_count: i64 = coordinator
        .query_row("SELECT COUNT(*) FROM stress_operations", [], |row| {
            row.get(0)
        })
        .expect("operation count");
    let committed_counter: i64 = coordinator
        .query_row(
            "SELECT committed_operations FROM stress_counter WHERE singleton_id = 1",
            [],
            |row| row.get(0),
        )
        .expect("committed operation counter");
    let entity_count: i64 = coordinator
        .query_row("SELECT COUNT(*) FROM stress_entities", [], |row| row.get(0))
        .expect("entity count");
    let tombstone_count: i64 = coordinator
        .query_row(
            "SELECT COUNT(*) FROM stress_entities WHERE deleted = 1",
            [],
            |row| row.get(0),
        )
        .expect("tombstone count");
    let integrity: String = coordinator
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .expect("integrity check");
    let journal_mode: String = coordinator
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .expect("journal mode");

    assert_eq!(desktop.writer_id, "desktop");
    assert_eq!(desktop.start_index, 0);
    assert_eq!(desktop.operations, 1_200);
    assert_eq!(service_first.writer_id, "service");
    assert_eq!(service_first.start_index, 0);
    assert_eq!(service_second.start_index, 500);
    assert_eq!(service_first.operations + service_second.operations, 1_000);
    assert_eq!(desktop.sqlite_version, service_first.sqlite_version);
    assert_eq!(desktop.sqlite_version, service_second.sqlite_version);
    assert!(sqlite_version_is_safe_for_multiple_writers(
        &desktop.sqlite_version
    ));
    let total_busy_retries =
        desktop.busy_retries + service_first.busy_retries + service_second.busy_retries;
    assert!(total_busy_retries > 0);
    assert_eq!(operation_count, 2_200);
    assert_eq!(committed_counter, 2_200);
    assert_eq!(entity_count, 128);
    assert!(tombstone_count > 0);
    assert_eq!(integrity, "ok");
    assert_eq!(journal_mode.to_ascii_lowercase(), "wal");
    assert!(checkpoint_during_desktop.1 >= checkpoint_during_desktop.2);
    assert_eq!(final_checkpoint.0, 0);
    println!(
        "PASS two-writer stress: SQLite {}, 2 processes + service restart, {} committed transactions, {} SQLITE_BUSY/LOCKED retries, RESTART checkpoint {:?}, TRUNCATE checkpoint {:?}",
        desktop.sqlite_version,
        operation_count,
        total_busy_retries,
        checkpoint_during_desktop,
        final_checkpoint,
    );
}
