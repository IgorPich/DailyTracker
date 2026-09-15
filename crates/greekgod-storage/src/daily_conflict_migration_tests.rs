use super::*;
use tempfile::tempdir;

fn schema_seven(path: &Path, client: bool, rows: bool) -> Connection {
    let connection = Connection::open(path).unwrap();
    for migration in &MIGRATIONS[..7] {
        connection.execute_batch(migration.sql).unwrap();
        connection.execute("INSERT INTO schema_migrations(version,name,checksum) VALUES (?1,?2,?3)",
            params![migration.version,migration.name,migration_checksum(migration.sql)]).unwrap();
    }
    if client {
        connection.execute("INSERT INTO sync_remotes(service_id,certificate_fingerprint_sha256,last_known_host) VALUES ('pc',?1,'https://fixture')", ["ab".repeat(32)]).unwrap();
    }
    if rows {
        for (index, entity, id, ack) in [(1,"daily_entry","2026-01-01",None),(2,"daily_entry","2026-01-02",Some("accepted")),(3,"workout","workout",None)] {
            connection.execute("INSERT INTO sync_entities(entity_type,entity_id,revision,created_revision,created_by_device_id,updated_by_device_id,payload_json) VALUES (?1,?2,?3,?3,'fixture','fixture','{}')", params![entity,id,index]).unwrap();
            connection.execute("INSERT INTO sync_outbox(operation_id,change_set_id,device_id,entity_type,entity_id,base_revision,result_revision,operation_type,payload_json,request_hash,acknowledged_at) VALUES (?1,'change','fixture',?2,?3,0,?4,'upsert','{}',?5,?6)", params![format!("op-{index}"),entity,id,index,"a".repeat(64),ack]).unwrap();
        }
        connection.execute("INSERT INTO applied_operations(operation_id,request_hash,device_id,entity_type,entity_id,result_revision,result_json) VALUES ('applied',?1,'fixture','daily_entry','2026-01-02',2,'{}')", ["b".repeat(64)]).unwrap();
    }
    connection
}

#[test]
fn migration_quarantines_only_pending_client_daily_rows_without_rewriting_entities() {
    for (client, rows) in [(false,false),(true,false),(false,true),(true,true)] {
        let directory = tempdir().unwrap();
        let path = directory.path().join(DATABASE_FILENAME);
        let connection = schema_seven(&path,client,rows);
        drop(connection);
        let store = NativeAppDataStore::new(&path).unwrap();
        assert_eq!(store.probe().unwrap().schema_version,8);
        assert_eq!(store.daily_conflicts().unwrap().len(),usize::from(client && rows));
        if client && rows {
            let conflicts = store.daily_conflicts().unwrap();
            assert_eq!(conflicts[0].operation_id,"op-1");
            assert_eq!(conflicts[0].status,"legacy_needs_review");
            assert_eq!(conflicts[0].original_remote_base,None);
            assert_eq!(store.prepare_remote_outbox("pc",1).unwrap()[0].request.entity_type,SyncEntityType::Workout);
        }
        store.with_connection(|connection| {
            let count: i64 = connection.query_row("SELECT COUNT(*) FROM sync_outbox",[],|r|r.get(0))?;
            assert_eq!(count,if rows {3} else {0});
            let changed: i64 = connection.query_row("SELECT COUNT(*) FROM sync_entities WHERE payload_json!='{}'",[],|r|r.get(0))?;
            assert_eq!(changed,0);
            let applied: i64 = connection.query_row("SELECT COUNT(*) FROM applied_operations",[],|r|r.get(0))?;
            assert_eq!(applied,if rows {1} else {0});
            Ok(())
        }).unwrap();
    }
}

#[test]
fn failed_migration_rolls_back_all_new_metadata_and_keeps_schema_seven() {
    let directory = tempdir().unwrap();
    let path = directory.path().join(DATABASE_FILENAME);
    let connection = schema_seven(&path,true,true);
    // Inject a late DDL failure after CREATE/INSERT, inside the migration transaction.
    connection.execute_batch("CREATE TABLE daily_conflict_rejections (fixture TEXT)").unwrap();
    drop(connection);
    assert!(NativeAppDataStore::new(&path).is_err());
    let connection = Connection::open(&path).unwrap();
    assert_eq!(connection.pragma_query_value::<i64,_>(None,"user_version",|r|r.get(0)).unwrap(),7);
    assert_eq!(connection.query_row::<i64,_,_>("SELECT COUNT(*) FROM sqlite_master WHERE name='daily_delivery'",[],|r|r.get(0)).unwrap(),0);
    assert_eq!(connection.query_row::<i64,_,_>("SELECT COUNT(*) FROM sync_outbox",[],|r|r.get(0)).unwrap(),3);
}
