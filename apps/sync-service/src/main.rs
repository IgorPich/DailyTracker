use greekgod_storage::{NativeAppDataStore, DATABASE_FILENAME};
use greekgod_sync_service::build_router;
use sha2::{Digest, Sha256};
use std::env;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};

struct Config {
    database_path: PathBuf,
    bind: SocketAddr,
    service_id: String,
}

impl Config {
    fn parse() -> Result<Self, String> {
        let mut database_path = None;
        let mut bind = "127.0.0.1:39173"
            .parse::<SocketAddr>()
            .expect("default bind");
        let mut service_id = None;
        let mut arguments = env::args().skip(1);
        while let Some(argument) = arguments.next() {
            match argument.as_str() {
                "--database" => database_path = arguments.next().map(PathBuf::from),
                "--bind" => {
                    bind = arguments
                        .next()
                        .ok_or_else(|| "--bind requires an address".to_string())?
                        .parse()
                        .map_err(|error| format!("invalid --bind address: {error}"))?;
                }
                "--service-id" => service_id = arguments.next(),
                _ => return Err(format!("unknown argument {argument}")),
            }
        }
        let database_path = database_path.ok_or_else(|| {
            format!("--database requires an explicit path ending in {DATABASE_FILENAME}")
        })?;
        let service_id = service_id.ok_or_else(|| "--service-id is required".to_string())?;
        if service_id.trim().is_empty() {
            return Err("--service-id cannot be blank".into());
        }
        Ok(Self {
            database_path,
            bind,
            service_id,
        })
    }
}

#[cfg(windows)]
struct SingleInstance {
    handle: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
impl SingleInstance {
    fn acquire(database_path: &Path) -> Result<Self, String> {
        use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS};
        use windows_sys::Win32::System::Threading::CreateMutexW;

        let fingerprint = format!(
            "{:x}",
            Sha256::digest(database_path.as_os_str().as_encoded_bytes())
        );
        let name = format!("Local\\GreekGodSyncService-{}", &fingerprint[..24]);
        let wide_name = name.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, wide_name.as_ptr()) };
        if handle.is_null() {
            return Err("could not create the Sync Service instance mutex".into());
        }
        if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
            unsafe { CloseHandle(handle) };
            return Err("another Sync Service instance already owns this database".into());
        }
        Ok(Self { handle })
    }
}

#[cfg(windows)]
impl Drop for SingleInstance {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.handle) };
    }
}

#[cfg(not(windows))]
struct SingleInstance;

#[cfg(not(windows))]
impl SingleInstance {
    fn acquire(_database_path: &Path) -> Result<Self, String> {
        Ok(Self)
    }
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("GreekGod Sync Service failed: {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    let config = Config::parse()?;
    let store =
        NativeAppDataStore::new(&config.database_path).map_err(|error| error.to_string())?;
    let canonical_database_path = std::fs::canonicalize(store.database_path())
        .map_err(|error| format!("could not resolve database path: {error}"))?;
    let _instance = SingleInstance::acquire(&canonical_database_path)?;
    let router = build_router(store, config.service_id).map_err(|error| error.to_string())?;
    let listener = tokio::net::TcpListener::bind(config.bind)
        .await
        .map_err(|error| format!("could not bind {}: {error}", config.bind))?;

    eprintln!(
        "GreekGod Sync Service listening on loopback {}",
        config.bind
    );
    axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .map_err(|error| format!("HTTP server failed: {error}"))
}
