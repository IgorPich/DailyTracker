use tauri::{RunEvent, WindowEvent};

#[cfg(feature = "native-sqlite-shadow")]
mod native_storage_shadow {
    use greekgod_storage::{
        NativeAppDataStore, NativeStorageProbe, StorageError, DATABASE_FILENAME,
    };
    use serde::Serialize;
    use serde_json::Value;
    use std::path::PathBuf;
    use tauri::{AppHandle, Manager};

    const DEVELOPMENT_IDENTIFIER: &str = "com.igorpich.formlog.dev";
    const SQLITE_SMOKE_IDENTIFIER: &str = "com.igorpich.formlog.sqlitesmoke";

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub(super) struct NativeCommandError {
        kind: String,
        message: String,
    }

    impl NativeCommandError {
        fn new(kind: impl Into<String>, message: impl Into<String>) -> Self {
            Self {
                kind: kind.into(),
                message: message.into(),
            }
        }
    }

    impl From<StorageError> for NativeCommandError {
        fn from(error: StorageError) -> Self {
            Self::new(error.kind(), error.to_string())
        }
    }

    type CommandResult<T> = Result<T, NativeCommandError>;

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub(super) struct NativeStorageProbeResponse {
        enabled: bool,
        probe: Option<NativeStorageProbe>,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub(super) struct NativeShadowResponse {
        enabled: bool,
        data: Option<Value>,
        probe: Option<NativeStorageProbe>,
        backup_path: Option<PathBuf>,
    }

    fn development_database_path(app: &AppHandle) -> CommandResult<PathBuf> {
        let identifier = app.config().identifier.as_str();
        if identifier != DEVELOPMENT_IDENTIFIER && identifier != SQLITE_SMOKE_IDENTIFIER {
            return Err(NativeCommandError::new(
                "storage-isolation-violation",
                format!("native SQLite is forbidden for application identifier {identifier}"),
            ));
        }
        let app_data_dir = app.path().app_data_dir().map_err(|error| {
            NativeCommandError::new("app-data-path-unavailable", error.to_string())
        })?;
        if app_data_dir.file_name().and_then(|value| value.to_str()) != Some(identifier) {
            return Err(NativeCommandError::new(
                "storage-isolation-violation",
                "development SQLite path is outside the exact isolated application directory",
            ));
        }
        Ok(app_data_dir.join(DATABASE_FILENAME))
    }

    async fn run_native<T>(
        operation: impl FnOnce() -> Result<T, StorageError> + Send + 'static,
    ) -> CommandResult<T>
    where
        T: Send + 'static,
    {
        tauri::async_runtime::spawn_blocking(operation)
            .await
            .map_err(|error| NativeCommandError::new("native-task-failed", error.to_string()))?
            .map_err(Into::into)
    }

    #[tauri::command]
    pub(super) async fn native_storage_probe(
        app: AppHandle,
    ) -> CommandResult<NativeStorageProbeResponse> {
        let database_path = development_database_path(&app)?;
        let probe = run_native(move || NativeAppDataStore::new(database_path)?.probe()).await?;
        Ok(NativeStorageProbeResponse {
            enabled: true,
            probe: Some(probe),
        })
    }

    #[tauri::command]
    pub(super) async fn native_shadow_replace(
        app: AppHandle,
        data: Value,
    ) -> CommandResult<NativeShadowResponse> {
        let database_path = development_database_path(&app)?;
        let (data, probe) = run_native(move || {
            let store = NativeAppDataStore::new(database_path)?;
            let data = store.replace_snapshot(&data)?;
            store.integrity_check()?;
            Ok::<_, greekgod_storage::StorageError>((data, store.probe()?))
        })
        .await?;
        Ok(NativeShadowResponse {
            enabled: true,
            data: Some(data),
            probe: Some(probe),
            backup_path: None,
        })
    }

    #[tauri::command]
    pub(super) async fn native_shadow_load(app: AppHandle) -> CommandResult<NativeShadowResponse> {
        let database_path = development_database_path(&app)?;
        let (data, probe) = run_native(move || {
            let store = NativeAppDataStore::new(database_path)?;
            let data = store.load()?;
            store.integrity_check()?;
            Ok::<_, greekgod_storage::StorageError>((data, store.probe()?))
        })
        .await?;
        Ok(NativeShadowResponse {
            enabled: true,
            data,
            probe: Some(probe),
            backup_path: None,
        })
    }

    #[tauri::command]
    pub(super) async fn native_shadow_backup_before_import(
        app: AppHandle,
        data: Value,
    ) -> CommandResult<NativeShadowResponse> {
        let database_path = development_database_path(&app)?;
        let (data, probe, backup_path) = run_native(move || {
            let store = NativeAppDataStore::new(database_path)?;
            let backup_path = store.backup_snapshot_before_import(&data)?;
            let data = store.load()?.ok_or_else(|| {
                StorageError::InvalidData("snapshot disappeared after backup".into())
            })?;
            store.integrity_check()?;
            Ok::<_, StorageError>((data, store.probe()?, backup_path))
        })
        .await?;
        Ok(NativeShadowResponse {
            enabled: true,
            data: Some(data),
            probe: Some(probe),
            backup_path: Some(backup_path),
        })
    }

    #[tauri::command]
    pub(super) fn native_sqlite_smoke_exit(app: AppHandle) -> CommandResult<()> {
        if app.config().identifier != SQLITE_SMOKE_IDENTIFIER {
            return Err(NativeCommandError::new(
                "storage-isolation-violation",
                "the SQLite smoke exit command is restricted to the exact smoke identifier",
            ));
        }
        app.exit(0);
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());
    #[cfg(feature = "native-sqlite-shadow")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        native_storage_shadow::native_storage_probe,
        native_storage_shadow::native_shadow_replace,
        native_storage_shadow::native_shadow_load,
        native_storage_shadow::native_shadow_backup_before_import,
        native_storage_shadow::native_sqlite_smoke_exit
    ]);
    let app = builder
        .build(tauri::generate_context!())
        .expect("failed to initialize GreekGod");

    app.run(|app_handle, event| {
        if let RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { .. },
            ..
        } = event
        {
            if label == "main" {
                app_handle.exit(0);
            }
        }
    });
}
