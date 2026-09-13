use serde_json::{json, Value};
use std::{fs, io::{self, Write}, path::{Path, PathBuf}};
use tauri::Manager;

fn validate_envelope(bytes: &[u8]) -> io::Result<()> {
    let value: Value = serde_json::from_slice(bytes).map_err(io::Error::other)?;
    let context = &value["context"];
    if context["version"] != 1 || !context["items"].is_array() {
        return Err(io::Error::other("Invalid HumanCoach envelope"));
    }
    Ok(())
}

// Same-directory rename; never truncate the authoritative file. Windows tempfile
// persist uses MoveFileExW(REPLACE_EXISTING). Failure retains the original target.
fn atomic_replace(path: &Path, bytes: &[u8], before_replace: impl FnOnce() -> io::Result<()>) -> io::Result<()> {
    let parent = path.parent().ok_or_else(|| io::Error::other("Missing parent"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    temporary.flush()?;
    temporary.as_file().sync_all()?;
    if fs::read(temporary.path())? != bytes { return Err(io::Error::other("Temporary file verification failed")); }
    before_replace()?;
    temporary.persist(path).map_err(|error| error.error)?;
    Ok(())
}

fn save(directory: &Path, development: bool, context: Value) -> io::Result<PathBuf> {
    let name = if development { "greekgod-human-coach.dev.v1.json" } else { "greekgod-human-coach.v1.json" };
    let destination = directory.join(name);
    let backup = directory.join(format!("{name}.backup.json"));
    let bytes = serde_json::to_vec_pretty(&json!({ "context": context })).map_err(io::Error::other)?;
    validate_envelope(&bytes)?;
    // Back up the entire previous file byte-for-byte, including the Store envelope.
    // On first creation back up the initial snapshot. Never automatically restore.
    let previous = match fs::read(&destination) {
        Ok(previous) => { validate_envelope(&previous)?; previous }
        Err(error) if error.kind() == io::ErrorKind::NotFound => bytes.clone(),
        Err(error) => return Err(error),
    };
    fs::create_dir_all(directory)?;
    atomic_replace(&backup, &previous, || Ok(()))?;
    if fs::read(&backup)? != previous { return Err(io::Error::other("Backup verification failed")); }
    atomic_replace(&destination, &bytes, || Ok(()))?;
    Ok(backup)
}

#[tauri::command]
pub async fn human_coach_save(app: tauri::AppHandle, development: bool, context: Value) -> Result<(), String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || save(&directory, development, context))
        .await.map_err(|error| error.to_string())?.map(|_| ()).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backup_preserves_whole_previous_file_and_never_recovers_implicitly() {
        let dir = tempfile::tempdir().unwrap();
        let first = json!({"version":1,"items":[]});
        let backup = save(dir.path(), false, first.clone()).unwrap();
        let path = dir.path().join("greekgod-human-coach.v1.json");
        let original = fs::read(&path).unwrap();
        assert_eq!(fs::read(&backup).unwrap(), original);
        save(dir.path(), false, json!({"version":1,"items":[],"fixture":true})).unwrap();
        assert_eq!(fs::read(&backup).unwrap(), original);
        let current = fs::read(&path).unwrap();
        assert_ne!(current, original);
        // Broken destination is not replaced with backup or new data.
        fs::write(&path, b"broken").unwrap();
        assert!(save(dir.path(), false, first).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"broken");
        assert_eq!(fs::read(&backup).unwrap(), original);
    }
    #[test]
    fn interrupted_pre_replace_keeps_original_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fixture.json");
        fs::write(&path, b"original").unwrap();
        assert!(atomic_replace(&path, b"replacement", || Err(io::Error::other("injected interruption"))).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test]
    fn invalid_input_or_backup_failure_cannot_replace_authority() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), true, json!({"version":1,"items":[]})).unwrap();
        let path = dir.path().join("greekgod-human-coach.dev.v1.json");
        let before = fs::read(&path).unwrap();
        assert!(save(dir.path(), true, json!({"version":2,"items":[]})).is_err());
        let backup = dir.path().join("greekgod-human-coach.dev.v1.json.backup.json");
        fs::remove_file(&backup).unwrap();
        fs::create_dir(&backup).unwrap();
        assert!(save(dir.path(), true, json!({"version":1,"items":[]})).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        assert!(!dir.path().join("greekgod-human-coach.v1.json").exists());
    }
}
