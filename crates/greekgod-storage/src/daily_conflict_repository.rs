use crate::{NativeAppDataStore, StorageError, StorageResult};
use rusqlite::params;
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyConflict {
    pub service_id: String,
    pub operation_id: String,
    pub date: String,
    pub original_remote_base: Option<i64>,
    pub local_base_revision: i64,
    pub authority_revision: Option<i64>,
    pub status: String,
    pub payload: Option<Value>,
}

impl NativeAppDataStore {
    pub fn mark_daily_conflict(&self, service: &str, operation: &str, revision: i64) -> StorageResult<()> {
        self.with_connection(|connection| {
            let changed = connection.execute(
                "UPDATE daily_delivery SET status='needs_review', authority_revision=?3
                 WHERE service_id=?1 AND operation_id=?2 AND status='pending'",
                params![service, operation, revision],
            )?;
            if changed != 1 { return Err(StorageError::InvalidData("DailyEntry delivery metadata unavailable".into())); }
            Ok(())
        })
    }

    pub fn daily_conflicts(&self) -> StorageResult<Vec<DailyConflict>> {
        self.with_connection(|connection| {
            let mut query = connection.prepare(
                "SELECT d.service_id,o.operation_id,o.entity_id,d.original_remote_base,o.base_revision,
                 d.authority_revision,d.status,o.payload_json FROM daily_delivery d JOIN sync_outbox o
                 ON o.operation_id=d.operation_id WHERE d.status!='pending' ORDER BY o.result_revision"
            )?;
            let rows = query.query_map([], |row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?,
                row.get::<_,Option<i64>>(3)?,row.get::<_,i64>(4)?,row.get::<_,Option<i64>>(5)?,row.get::<_,String>(6)?,row.get::<_,Option<String>>(7)?)))?;
            rows.map(|row| {
                let (service_id,operation_id,date,original_remote_base,local_base_revision,authority_revision,status,payload) = row?;
                Ok(DailyConflict { service_id,operation_id,date,original_remote_base,local_base_revision,authority_revision,status,
                    payload: payload.map(|value| serde_json::from_str(&value)).transpose()? })
            }).collect()
        })
    }
}
