use serde_json::{json, Value};
use std::{fs, io, path::{Path, PathBuf}};
use tauri::Manager;
use crate::human_coach_storage::atomic_replace;

fn validate(bytes: &[u8]) -> io::Result<()> {
    let value: Value = serde_json::from_slice(bytes).map_err(io::Error::other)?;
    let memory = &value["memory"];
    if value.as_object().map(|o| o.len()) != Some(1) || memory.as_object().map(|o| o.len()) != Some(2)
        || memory["version"] != 1 || memory["items"].as_array().map(|a| a.len() <= 100) != Some(true) {
        return Err(io::Error::other("Invalid Companion memory envelope"));
    }
    // Domain validation is performed by the application repository before reads/writes.
    // This native boundary additionally rejects non-accepted/malformed record envelopes.
    for item in memory["items"].as_array().unwrap() {
        if item.as_object().map(|o| o.len()) != Some(8) || !item["id"].is_string()
            || !item["createdAt"].is_string() || !(item["expiresAt"].is_null() || item["expiresAt"].is_string())
            || !matches!(item["status"].as_str(), Some("ACTIVE" | "ARCHIVED"))
            || !matches!(item["source"].as_str(), Some("USER_EXPLICIT" | "HUMAN_COACH" | "COMPANION_SUGGESTED"))
            || item["provenance"]["acceptedBy"] != "USER"
            || !matches!(item["content"]["kind"].as_str(), Some("SUMMARY_STYLE" | "HUMAN_COACH_REFERENCE")) {
            return Err(io::Error::other("Invalid Companion memory record"));
        }
    }
    Ok(())
}
fn save(directory: &Path, development: bool, memory: Value, before_replace: impl FnOnce() -> io::Result<()>) -> io::Result<PathBuf> {
    let name = if development { "greekgod-companion-memory.dev.v1.json" } else { "greekgod-companion-memory.v1.json" };
    let target = directory.join(name);
    let backup = directory.join(format!("{name}.backup.json"));
    let bytes = serde_json::to_vec_pretty(&json!({"memory": memory})).map_err(io::Error::other)?;
    validate(&bytes)?;
    let previous = match fs::read(&target) {
        Ok(bytes) => { validate(&bytes)?; bytes },
        Err(error) if error.kind() == io::ErrorKind::NotFound => bytes.clone(),
        Err(error) => return Err(error),
    };
    fs::create_dir_all(directory)?;
    atomic_replace(&backup, &previous, || Ok(()))?;
    if fs::read(&backup)? != previous { return Err(io::Error::other("Memory backup verification failed")); }
    atomic_replace(&target, &bytes, before_replace)?;
    Ok(backup)
}
#[tauri::command]
pub async fn companion_memory_save(app: tauri::AppHandle, development: bool, memory: Value) -> Result<(), String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || save(&directory, development, memory, || Ok(())))
        .await.map_err(|error| error.to_string())?.map(|_| ()).map_err(|error| error.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepted_record_roundtrip_preserves_provenance_and_previous_backup() {
        let dir = tempfile::tempdir().unwrap();
        let mut state = json!({"version":1,"items":[{
            "id":"synthetic-memory", "content":{"kind":"SUMMARY_STYLE","value":"SHORT"},
            "scope":{"kind":"GLOBAL"}, "expiresAt":null, "source":"COMPANION_SUGGESTED",
            "createdAt":"2026-01-01T00:00:00.000Z", "provenance":{"acceptedBy":"USER","sourceId":"synthetic-candidate"},
            "status":"ACTIVE"
        }]});
        let backup = save(dir.path(), true, state.clone(), || Ok(())).unwrap();
        let target = dir.path().join("greekgod-companion-memory.dev.v1.json");
        let before = fs::read(&target).unwrap();
        let reopened: Value = serde_json::from_slice(&before).unwrap();
        assert_eq!(reopened["memory"], state);
        state["items"][0]["status"] = json!("ARCHIVED");
        assert!(save(dir.path(), true, state.clone(), || Err(io::Error::other("interruption"))).is_err());
        assert_eq!(fs::read(&target).unwrap(), before);
        save(dir.path(), true, state.clone(), || Ok(())).unwrap();
        assert_eq!(fs::read(&backup).unwrap(), before);
        let reopened: Value = serde_json::from_slice(&fs::read(&target).unwrap()).unwrap();
        assert_eq!(reopened["memory"], state);
    }
    #[test]
    fn backup_and_interruption_never_truncate_previous_memory() {
        let dir = tempfile::tempdir().unwrap();
        let state = json!({"version":1,"items":[]});
        let backup = save(dir.path(), true, state.clone(), || Ok(())).unwrap();
        let target = dir.path().join("greekgod-companion-memory.dev.v1.json");
        let before = fs::read(&target).unwrap();
        assert_eq!(fs::read(&backup).unwrap(), before);
        assert!(save(dir.path(), true, state.clone(), || Err(io::Error::other("interruption"))).is_err());
        assert_eq!(fs::read(&target).unwrap(), before);
        assert_eq!(fs::read(&backup).unwrap(), before);
        assert!(!dir.path().join("greekgod-companion-memory.v1.json").exists());
        fs::write(&target, b"broken").unwrap();
        assert!(save(dir.path(), true, state, || Ok(())).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"broken");
        assert_eq!(fs::read(&backup).unwrap(), before);
    }
    #[test]
    fn invalid_version_and_backup_failure_leave_authority_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let state = json!({"version":1,"items":[]});
        let backup = save(dir.path(), true, state.clone(), || Ok(())).unwrap();
        let target = dir.path().join("greekgod-companion-memory.dev.v1.json");
        let before = fs::read(&target).unwrap();
        assert!(save(dir.path(), true, json!({"version":2,"items":[]}), || Ok(())).is_err());
        fs::remove_file(&backup).unwrap(); fs::create_dir(&backup).unwrap();
        assert!(save(dir.path(), true, state, || Ok(())).is_err());
        assert_eq!(fs::read(&target).unwrap(), before);
    }
}
