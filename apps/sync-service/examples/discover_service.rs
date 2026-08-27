use mdns_sd::{ServiceDaemon, ServiceEvent};
use std::collections::HashSet;
use std::env;
use std::net::IpAddr;
use std::time::{Duration, Instant};

const SERVICE_TYPE: &str = "_greekgod-sync._tcp.local.";

fn main() {
    if let Err(error) = run() {
        eprintln!("mDNS discovery client failed: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut arguments = env::args().skip(1);
    let expected_service_id = arguments
        .next()
        .ok_or_else(|| "expected serviceId argument".to_string())?;
    let expected_address = arguments
        .next()
        .ok_or_else(|| "expected address argument".to_string())?
        .parse::<IpAddr>()
        .map_err(|error| format!("invalid expected address: {error}"))?;
    let expected_port = arguments
        .next()
        .ok_or_else(|| "expected port argument".to_string())?
        .parse::<u16>()
        .map_err(|error| format!("invalid expected port: {error}"))?;
    if arguments.next().is_some() {
        return Err("unexpected extra arguments".into());
    }

    let daemon = ServiceDaemon::new().map_err(|error| error.to_string())?;
    let receiver = daemon
        .browse(SERVICE_TYPE)
        .map_err(|error| error.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(12);
    let result = loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break Err("timed out before the expected service was resolved".into());
        }
        let event = receiver
            .recv_timeout(remaining)
            .map_err(|error| format!("discovery receive failed: {error}"))?;
        let ServiceEvent::ServiceResolved(service) = event else {
            continue;
        };
        if service.get_property_val_str("serviceId") != Some(&expected_service_id) {
            continue;
        }
        if service.get_property_val_str("protocolVersion") != Some("1") {
            break Err("discovered service has the wrong protocolVersion".into());
        }
        if service.get_port() != expected_port {
            break Err("discovered service has the wrong port".into());
        }
        let addresses = service
            .get_addresses()
            .iter()
            .map(|address| address.to_ip_addr())
            .collect::<HashSet<_>>();
        if !addresses.contains(&expected_address) {
            break Err(format!(
                "discovered service did not contain expected address {expected_address}"
            ));
        }
        if let Some(forbidden) = [
            "token",
            "deviceToken",
            "certificateFingerprint",
            "user",
            "workout",
            "training",
        ]
        .into_iter()
        .find(|key| service.get_property(key).is_some())
        {
            break Err(format!("discovery exposed forbidden metadata {forbidden}"));
        }
        break Ok(());
    };

    let _ = daemon.stop_browse(SERVICE_TYPE);
    if let Ok(shutdown) = daemon.shutdown() {
        let _ = shutdown.recv_timeout(Duration::from_secs(3));
    }
    result?;
    println!("mDNS discovery gate PASS");
    Ok(())
}
