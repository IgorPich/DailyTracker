use super::*;
use serde_json::json;
use tempfile::tempdir;

fn schema_seven(path: &Path, client: bool, rows: bool) -> Connection {
    let connection = Connection::open(path).unwrap();
    for migration in &MIGRATIONS[..7] {
        connection.execute_batch(migration.sql).unwrap();
        connection
            .execute(
                "INSERT INTO schema_migrations(version,name,checksum) VALUES (?1,?2,?3)",
                params![
                    migration.version,
                    migration.name,
                    migration_checksum(migration.sql)
                ],
            )
            .unwrap();
    }
    if client {
        connection.execute("INSERT INTO sync_remotes(service_id,certificate_fingerprint_sha256,last_known_host) VALUES ('pc',?1,'https://fixture')", ["ab".repeat(32)]).unwrap();
    }
    if rows {
        for (index, entity, id, ack) in [
            (1, "daily_entry", "2026-01-01", None),
            (2, "daily_entry", "2026-01-02", Some("accepted")),
            (3, "workout", "workout", None),
        ] {
            connection.execute("INSERT INTO sync_entities(entity_type,entity_id,revision,created_revision,created_by_device_id,updated_by_device_id,payload_json) VALUES (?1,?2,?3,?3,'fixture','fixture','{}')", params![entity,id,index]).unwrap();
            connection.execute("INSERT INTO sync_outbox(operation_id,change_set_id,device_id,entity_type,entity_id,base_revision,result_revision,operation_type,payload_json,request_hash,acknowledged_at) VALUES (?1,'change','fixture',?2,?3,0,?4,'upsert','{}',?5,?6)", params![format!("op-{index}"),entity,id,index,"a".repeat(64),ack]).unwrap();
        }
        connection.execute("INSERT INTO applied_operations(operation_id,request_hash,device_id,entity_type,entity_id,result_revision,result_json) VALUES ('applied',?1,'fixture','daily_entry','2026-01-02',2,'{}')", ["b".repeat(64)]).unwrap();
    }
    connection
}

#[test]
fn historical_migration_eight_checksum_is_preserved_exactly() {
    assert_eq!(
        migration_checksum(MIGRATION_8_SQL),
        "fc204e2d2af3d09e61dc23c72a25c9e514ac6f88cbe9f1d9d1ba1a3f39aa237f"
    );
}

#[test]
fn migration_quarantines_only_pending_client_daily_rows_without_rewriting_entities() {
    for (client, rows) in [(false, false), (true, false), (false, true), (true, true)] {
        let directory = tempdir().unwrap();
        let path = directory.path().join(DATABASE_FILENAME);
        let connection = schema_seven(&path, client, rows);
        drop(connection);
        let store = NativeAppDataStore::new(&path).unwrap();
        assert_eq!(store.probe().unwrap().schema_version, 8);
        assert_eq!(
            store.daily_conflicts().unwrap().len(),
            usize::from(client && rows)
        );
        if client && rows {
            let conflicts = store.daily_conflicts().unwrap();
            assert_eq!(conflicts[0].operation_id, "op-1");
            assert_eq!(conflicts[0].status, "legacy_needs_review");
            assert_eq!(conflicts[0].original_remote_base, None);
            assert_eq!(
                store.prepare_remote_outbox("pc", 1).unwrap()[0]
                    .request
                    .entity_type,
                SyncEntityType::Workout
            );
        }
        store
            .with_connection(|connection| {
                let count: i64 =
                    connection
                        .query_row("SELECT COUNT(*) FROM sync_outbox", [], |row| row.get(0))?;
                assert_eq!(count, if rows { 3 } else { 0 });
                let changed: i64 = connection.query_row(
                    "SELECT COUNT(*) FROM sync_entities WHERE payload_json!='{}'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(changed, 0);
                let applied: i64 =
                    connection.query_row("SELECT COUNT(*) FROM applied_operations", [], |row| {
                        row.get(0)
                    })?;
                assert_eq!(applied, if rows { 1 } else { 0 });
                Ok(())
            })
            .unwrap();

        drop(store);
        let reopened = NativeAppDataStore::new(&path).expect("existing schema-8 database reopens");
        assert_eq!(reopened.probe().unwrap().schema_version, 8);
    }
}

#[test]
fn failed_migration_rolls_back_all_new_metadata_and_keeps_schema_seven() {
    let directory = tempdir().unwrap();
    let path = directory.path().join(DATABASE_FILENAME);
    let connection = schema_seven(&path, true, true);
    connection
        .execute_batch("CREATE TABLE daily_conflict_rejections (fixture TEXT)")
        .unwrap();
    drop(connection);
    assert!(NativeAppDataStore::new(&path).is_err());
    let connection = Connection::open(&path).unwrap();
    assert_eq!(
        connection
            .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        7
    );
    assert_eq!(
        connection
            .query_row::<i64, _, _>(
                "SELECT COUNT(*) FROM sqlite_master WHERE name='daily_delivery'",
                [],
                |row| row.get(0)
            )
            .unwrap(),
        0
    );
    assert_eq!(
        connection
            .query_row::<i64, _, _>("SELECT COUNT(*) FROM sync_outbox", [], |row| row.get(0))
            .unwrap(),
        3
    );
}

#[test]
fn remote_daily_conflict_rejection_survives_reopen_without_blocking_other_entities() {
    let directory = tempdir().unwrap();
    let path = directory.path().join(DATABASE_FILENAME);
    let store = NativeAppDataStore::new(&path).unwrap();
    let initial = json!({
        "version":4,"dailyEntries":[],"workouts":[],"templates":[],
        "exerciseLibrary":[],"settings":{"gymLocations":[]},"coachNotes":{}
    });
    store
        .bootstrap_from_legacy_snapshot(&initial, "pc")
        .unwrap();
    let mut first = initial.clone();
    first["dailyEntries"] = json!([{"id":"day","date":"2026-01-15","weight":80}]);
    let first_result = store
        .replace_authoritative_snapshot(&first, "pc", store.current_sync_revision().unwrap())
        .unwrap();
    let original_revision = store
        .load_sync_entity(SyncEntityType::DailyEntry, "2026-01-15")
        .unwrap()
        .unwrap()
        .revision;
    let mut newer = first.clone();
    newer["dailyEntries"][0]["weight"] = json!(81);
    newer["dailyEntries"][0]["measurements"] = json!({"CHEST":101.5});
    let newer_result = store
        .replace_authoritative_snapshot(&newer, "pc", first_result.revision)
        .unwrap();
    let stale_daily = SyncMutationRequest {
        operation_id: "10000000-0000-4000-8000-000000000001".into(),
        change_set_id: "20000000-0000-4000-8000-000000000001".into(),
        device_id: "mobile:test".into(),
        entity_type: SyncEntityType::DailyEntry,
        entity_id: "2026-01-15".into(),
        base_revision: original_revision,
        order_position: Some(0),
        operation_type: SyncOperationType::Upsert,
        payload: Some(json!({"id":"day","date":"2026-01-15","weight":79})),
    };
    assert!(matches!(
        store.apply_remote_mutation(&stale_daily),
        Err(StorageError::Conflict { .. })
    ));
    assert_eq!(
        store.current_sync_revision().unwrap(),
        newer_result.revision
    );
    drop(store);

    let reopened = NativeAppDataStore::new(&path).unwrap();
    assert!(matches!(
        reopened.apply_remote_mutation(&stale_daily),
        Err(StorageError::Conflict { .. })
    ));
    let workout = SyncMutationRequest {
        operation_id: "10000000-0000-4000-8000-000000000002".into(),
        change_set_id: "20000000-0000-4000-8000-000000000002".into(),
        device_id: "mobile:test".into(),
        entity_type: SyncEntityType::Workout,
        entity_id: "unrelated".into(),
        base_revision: 0,
        order_position: Some(0),
        operation_type: SyncOperationType::Upsert,
        payload: Some(json!({"id":"unrelated","date":"2026-01-15","exercises":[]})),
    };
    reopened.apply_remote_mutation(&workout).unwrap();
    let loaded = reopened.load_authoritative_snapshot().unwrap();
    assert_eq!(loaded.data["dailyEntries"], newer["dailyEntries"]);
    assert_eq!(loaded.data["workouts"][0]["id"], "unrelated");
}
