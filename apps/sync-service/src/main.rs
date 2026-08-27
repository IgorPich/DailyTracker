use greekgod_storage::{NativeAppDataStore, PairingWindow, DATABASE_FILENAME};
use greekgod_sync::{PROTOCOL_VERSION, SERVICE_VERSION};
use greekgod_sync_service::{
    build_router, ensure_crypto_provider, ServicePublicIdentity, ServiceTlsIdentity,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::env;
use std::fs::OpenOptions;
use std::io::Write;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

mod discovery;

use discovery::MdnsAdvertisement;

const DEFAULT_SYNC_PORT: u16 = 39173;

#[derive(Debug)]
struct Config {
    database_path: PathBuf,
    bind: BindSelection,
    service_id: Option<String>,
    pairing: Option<PairingConfig>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BindSelection {
    Explicit(SocketAddr),
    PrivateLan,
}

#[derive(Debug)]
struct PairingConfig {
    ttl_seconds: u64,
    output_path: PathBuf,
}

impl Config {
    fn parse_from(arguments: impl IntoIterator<Item = String>) -> Result<Self, String> {
        let mut database_path = None;
        let mut bind = BindSelection::Explicit(
            format!("127.0.0.1:{DEFAULT_SYNC_PORT}")
                .parse::<SocketAddr>()
                .expect("default bind"),
        );
        let mut bind_was_configured = false;
        let mut service_id = None;
        let mut pairing_window_seconds = None;
        let mut pairing_nonce_output = None;
        let mut arguments = arguments.into_iter();
        while let Some(argument) = arguments.next() {
            match argument.as_str() {
                "--database" => database_path = arguments.next().map(PathBuf::from),
                "--bind" => {
                    if bind_was_configured {
                        return Err("--bind and --bind-private-lan are mutually exclusive".into());
                    }
                    bind = BindSelection::Explicit(
                        arguments
                            .next()
                            .ok_or_else(|| "--bind requires an address".to_string())?
                            .parse()
                            .map_err(|error| format!("invalid --bind address: {error}"))?,
                    );
                    bind_was_configured = true;
                }
                "--bind-private-lan" => {
                    if bind_was_configured {
                        return Err("--bind and --bind-private-lan are mutually exclusive".into());
                    }
                    bind = BindSelection::PrivateLan;
                    bind_was_configured = true;
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
        if service_id
            .as_ref()
            .is_some_and(|value| value.trim().is_empty())
        {
            return Err("--service-id cannot be blank".into());
        }
        if matches!(bind, BindSelection::Explicit(address) if !is_local_network_address(address.ip()))
        {
            return Err(
                "Sync Service must bind to an explicit loopback or private LAN address".into(),
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
    let arguments = env::args().skip(1).collect::<Vec<_>>();
    if arguments == ["--version-json"] {
        println!(
            "{}",
            serde_json::json!({
                "serviceVersion": SERVICE_VERSION,
                "protocolVersion": PROTOCOL_VERSION,
            })
        );
        return Ok(());
    }
    ensure_crypto_provider();
    let config = Config::parse_from(arguments)?;
    let bind = resolve_bind(config.bind).await?;
    let store =
        NativeAppDataStore::new(&config.database_path).map_err(|error| error.to_string())?;
    let canonical_database_path = std::fs::canonicalize(store.database_path())
        .map_err(|error| format!("could not resolve database path: {error}"))?;
    let _instance = SingleInstance::acquire(&canonical_database_path)?;
    let tls_identity = ServiceTlsIdentity::load_or_create(&store, config.service_id.as_deref())
        .map_err(|error| error.to_string())?;
    let public_identity = tls_identity.public_identity();
    let tls_config = tls_identity
        .rustls_config()
        .await
        .map_err(|error| error.to_string())?;
    let router =
        build_router(store.clone(), public_identity.clone()).map_err(|error| error.to_string())?;
    let listener =
        TcpListener::bind(bind).map_err(|error| format!("could not bind {bind}: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("could not configure TLS listener: {error}"))?;
    if let Some(pairing) = config.pairing {
        let window = store
            .open_pairing_window(pairing.ttl_seconds)
            .map_err(|error| error.to_string())?;
        write_pairing_window(&pairing.output_path, &public_identity, &window)?;
        eprintln!("GreekGod pairing window opened; nonce written to the configured output file");
    }

    let discovery = MdnsAdvertisement::register(&public_identity.service_id, bind)?;

    eprintln!("GreekGod Sync Service listening with HTTPS on {}", bind);
    let handle = axum_server::Handle::new();
    let shutdown_handle = handle.clone();
    tokio::spawn(async move {
        if tokio::signal::ctrl_c().await.is_ok() {
            shutdown_handle.graceful_shutdown(Some(Duration::from_secs(15)));
        }
    });
    let network_address_lost = Arc::new(AtomicBool::new(false));
    if !bind.ip().is_loopback() {
        let network_handle = handle.clone();
        let network_address_lost = network_address_lost.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(5));
            interval.tick().await;
            loop {
                interval.tick().await;
                if !local_address_is_available(bind.ip()) {
                    network_address_lost.store(true, Ordering::Release);
                    network_handle.graceful_shutdown(Some(Duration::from_secs(15)));
                    break;
                }
            }
        });
    }
    let server_result = axum_server::from_tcp_rustls(listener, tls_config)
        .map_err(|error| format!("could not create HTTPS listener: {error}"))?
        .handle(handle)
        .serve(router.into_make_service())
        .await
        .map_err(|error| format!("HTTPS server failed: {error}"));
    if let Some(discovery) = discovery {
        discovery.shutdown()?;
    }
    if network_address_lost.load(Ordering::Acquire) {
        return Err("private LAN address changed; Sync Service restart required".into());
    }
    server_result
}

async fn resolve_bind(selection: BindSelection) -> Result<SocketAddr, String> {
    match selection {
        BindSelection::Explicit(bind) => Ok(bind),
        BindSelection::PrivateLan => wait_for_private_lan_address(DEFAULT_SYNC_PORT).await,
    }
}

async fn wait_for_private_lan_address(port: u16) -> Result<SocketAddr, String> {
    let mut waiting_was_logged = false;
    let shutdown = tokio::signal::ctrl_c();
    tokio::pin!(shutdown);
    loop {
        match select_private_lan_address(port) {
            Ok(address) => return Ok(address),
            Err(error) => {
                if !waiting_was_logged {
                    eprintln!("GreekGod Sync Service waiting for a private LAN: {error}");
                    waiting_was_logged = true;
                }
            }
        }
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(5)) => {}
            signal = &mut shutdown => {
                return match signal {
                    Ok(()) => Err("Sync Service startup cancelled".into()),
                    Err(error) => Err(format!("could not monitor shutdown signal: {error}")),
                };
            }
        }
    }
}

fn select_private_lan_address(port: u16) -> Result<SocketAddr, String> {
    let interfaces = if_addrs::get_if_addrs()
        .map_err(|error| format!("could not enumerate local network interfaces: {error}"))?;
    let candidates = interfaces
        .into_iter()
        .map(|interface| {
            let address = interface.ip();
            (interface.name, address)
        })
        .collect::<Vec<_>>();
    select_private_lan_address_from(candidates, port).ok_or_else(|| {
        "no active private IPv4 LAN interface is available; connect to a private LAN and retry"
            .into()
    })
}

fn select_private_lan_address_from(
    interfaces: impl IntoIterator<Item = (String, IpAddr)>,
    port: u16,
) -> Option<SocketAddr> {
    let mut candidates = interfaces
        .into_iter()
        .filter_map(|(name, address)| match address {
            IpAddr::V4(address) if is_private_ipv4(address) && !is_virtual_interface(&name) => {
                Some((physical_interface_score(&name), name, address))
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| left.1.cmp(&right.1))
            .then_with(|| left.2.octets().cmp(&right.2.octets()))
    });
    candidates
        .first()
        .map(|(_, _, address)| SocketAddr::new(IpAddr::V4(*address), port))
}

fn is_private_ipv4(address: Ipv4Addr) -> bool {
    address.is_private() && !address.is_loopback() && !address.is_link_local()
}

fn is_virtual_interface(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    [
        "vethernet",
        "virtualbox",
        "vmware",
        "docker",
        "wsl",
        "tailscale",
        "zerotier",
        "tunnel",
    ]
    .iter()
    .any(|marker| name.contains(marker))
}

fn physical_interface_score(name: &str) -> u8 {
    let name = name.to_ascii_lowercase();
    if ["ethernet", "wi-fi", "wifi", "wlan"]
        .iter()
        .any(|marker| name.contains(marker))
    {
        1
    } else {
        0
    }
}

fn local_address_is_available(expected: IpAddr) -> bool {
    if_addrs::get_if_addrs().is_ok_and(|interfaces| {
        interfaces
            .into_iter()
            .any(|interface| interface.ip() == expected)
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PairingBootstrap<'a> {
    service_id: &'a str,
    certificate_fingerprint_sha256: &'a str,
    nonce: &'a str,
    expires_at_epoch: i64,
}

fn write_pairing_window(
    path: &Path,
    identity: &ServicePublicIdentity,
    window: &PairingWindow,
) -> Result<(), String> {
    let encoded = serde_json::to_vec(&PairingBootstrap {
        service_id: &identity.service_id,
        certificate_fingerprint_sha256: &identity.certificate_fingerprint_sha256,
        nonce: &window.nonce,
        expires_at_epoch: window.expires_at_epoch,
    })
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

fn is_local_network_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            address.is_loopback() || address.is_private() || address.is_link_local()
        }
        IpAddr::V6(address) => {
            let first = address.segments()[0];
            address.is_loopback() || first & 0xfe00 == 0xfc00 || first & 0xffc0 == 0xfe80
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn required_arguments() -> Vec<String> {
        vec!["--database".into(), format!("test/{DATABASE_FILENAME}")]
    }

    #[test]
    fn listener_rejects_unspecified_and_public_addresses() {
        let mut arguments = required_arguments();
        arguments.extend(["--bind".into(), "0.0.0.0:39173".into()]);

        let error = Config::parse_from(arguments).expect_err("unspecified bind must fail closed");
        assert!(error.contains("private LAN"));

        let mut public_arguments = required_arguments();
        public_arguments.extend(["--bind".into(), "8.8.8.8:39173".into()]);
        assert!(Config::parse_from(public_arguments).is_err());
        let mut private_arguments = required_arguments();
        private_arguments.extend(["--bind".into(), "192.168.1.25:39173".into()]);
        assert!(Config::parse_from(private_arguments).is_ok());
    }

    #[test]
    fn installed_mode_selects_a_physical_private_lan_and_fixed_port() {
        let selected = select_private_lan_address_from(
            [
                ("vEthernet (WSL)".into(), "172.20.16.1".parse().unwrap()),
                ("Ethernet".into(), "192.168.1.110".parse().unwrap()),
                ("Wi-Fi".into(), "8.8.8.8".parse().unwrap()),
            ],
            DEFAULT_SYNC_PORT,
        );
        assert_eq!(selected, "192.168.1.110:39173".parse().ok());

        let mut arguments = required_arguments();
        arguments.push("--bind-private-lan".into());
        assert_eq!(
            Config::parse_from(arguments)
                .expect("private LAN mode")
                .bind,
            BindSelection::PrivateLan
        );
    }

    #[test]
    fn bind_modes_are_mutually_exclusive() {
        let mut arguments = required_arguments();
        arguments.extend([
            "--bind-private-lan".into(),
            "--bind".into(),
            "192.168.1.25:39173".into(),
        ]);
        let error = Config::parse_from(arguments).expect_err("duplicate bind mode");
        assert!(error.contains("mutually exclusive"));
    }

    #[test]
    fn public_version_contract_is_non_secret_and_stable() {
        let encoded = serde_json::json!({
            "serviceVersion": SERVICE_VERSION,
            "protocolVersion": PROTOCOL_VERSION,
        });
        assert_eq!(encoded["protocolVersion"], PROTOCOL_VERSION);
        assert!(encoded["serviceVersion"]
            .as_str()
            .is_some_and(|value| !value.is_empty()));
        assert_eq!(encoded.as_object().map(|object| object.len()), Some(2));
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
        let identity = ServicePublicIdentity {
            service_id: "service-test".into(),
            certificate_fingerprint_sha256:
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
        };

        write_pairing_window(&path, &identity, &window).expect("first write");
        let output = std::fs::read_to_string(&path).expect("pairing output");
        assert!(output.contains("secret-nonce"));
        assert!(output.contains("service-test"));
        assert!(output.contains(&identity.certificate_fingerprint_sha256));
        assert!(write_pairing_window(&path, &identity, &window).is_err());
        assert!(!format!("{window:?}").contains("secret-nonce"));
    }
}
