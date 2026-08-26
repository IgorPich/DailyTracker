use greekgod_storage::{NativeAppDataStore, PairingWindow, DATABASE_FILENAME};
use greekgod_sync_service::build_router;
use sha2::{Digest, Sha256};
use std::env;
use std::fs::OpenOptions;
use std::io::Write;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};

#[derive(Debug)]
struct Config {
    database_path: PathBuf,
    bind: SocketAddr,
    service_id: String,
    pairing: Option<PairingConfig>,
}

#[derive(Debug)]
struct PairingConfig {
    ttl_seconds: u64,
    output_path: PathBuf,
}

impl Config {
    fn parse() -> Result<Self, String> {
        Self::parse_from(env::args().skip(1))
    }

    fn parse_from(arguments: impl IntoIterator<Item = String>) -> Result<Self, String> {
        let mut database_path = None;
        let mut bind = "127.0.0.1:39173"
            .parse::<SocketAddr>()
            .expect("default bind");
        let mut service_id = None;
        let mut pairing_window_seconds = None;
        let mut pairing_nonce_output = None;
        let mut arguments = arguments.into_iter();
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
                "--pairing-window-seconds" => {
                    pairing_window_seconds = Some(
                        arguments
                            .next()
                            .ok_or_else(|| "--pairing-window-seconds requires a value".to_string())?
                            .parse::<u64>()
                            .map_err(|error| {
                                format!("invalid --pairing-window-seconds value: {error}")
                            })?,
                    );
                }
                "--pairing-nonce-output" => {
                    pairing_nonce_output = arguments.next().map(PathBuf::from)
                }
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
        if !bind.ip().is_loopback() {
            return Err(
                "plaintext Sync Service transport is restricted to a loopback address".into(),
            );
        }
        let pairing = match (pairing_window_seconds, pairing_nonce_output) {
            (Some(ttl_seconds), Some(output_path)) => Some(PairingConfig {
                ttl_seconds,
                output_path,
            }),
            (None, None) => None,
            _ => {
                return Err(
                    "--pairing-window-seconds and --pairing-nonce-output must be used together"
                        .into(),
                )
            }
        };
        Ok(Self {
            database_path,
            bind,
            service_id,
            pairing,
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
    let router =
        build_router(store.clone(), config.service_id).map_err(|error| error.to_string())?;
    let listener = tokio::net::TcpListener::bind(config.bind)
        .await
        .map_err(|error| format!("could not bind {}: {error}", config.bind))?;
    if let Some(pairing) = config.pairing {
        let window = store
            .open_pairing_window(pairing.ttl_seconds)
            .map_err(|error| error.to_string())?;
        write_pairing_window(&pairing.output_path, &window)?;
        eprintln!("GreekGod pairing window opened; nonce written to the configured output file");
    }

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

fn write_pairing_window(path: &Path, window: &PairingWindow) -> Result<(), String> {
    let encoded = serde_json::to_vec(window)
        .map_err(|error| format!("could not encode pairing window: {error}"))?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("could not create pairing output file: {error}"))?;
    file.write_all(&encoded)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("could not write pairing output file: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn required_arguments() -> Vec<String> {
        vec![
            "--database".into(),
            format!("test/{DATABASE_FILENAME}"),
            "--service-id".into(),
            "service-test".into(),
        ]
    }

    #[test]
    fn plaintext_listener_is_loopback_only() {
        let mut arguments = required_arguments();
        arguments.extend(["--bind".into(), "0.0.0.0:39173".into()]);

        let error = Config::parse_from(arguments).expect_err("LAN plaintext must fail closed");
        assert!(error.contains("loopback"));
    }

    #[test]
    fn pairing_window_requires_an_explicit_output_file() {
        let mut arguments = required_arguments();
        arguments.extend(["--pairing-window-seconds".into(), "120".into()]);

        let error = Config::parse_from(arguments).expect_err("incomplete pairing arguments");
        assert!(error.contains("must be used together"));
    }

    #[test]
    fn pairing_output_is_create_new_and_debug_safe() {
        let directory = tempfile::tempdir().expect("temporary pairing output directory");
        let path = directory.path().join("pairing.json");
        let window = PairingWindow {
            nonce: "secret-nonce".into(),
            expires_at_epoch: 123,
        };

        write_pairing_window(&path, &window).expect("first write");
        assert!(std::fs::read_to_string(&path)
            .expect("pairing output")
            .contains("secret-nonce"));
        assert!(write_pairing_window(&path, &window).is_err());
        assert!(!format!("{window:?}").contains("secret-nonce"));
    }
}
