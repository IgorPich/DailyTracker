use greekgod_sync::PROTOCOL_VERSION;
use mdns_sd::{ServiceDaemon, ServiceInfo};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::time::Duration;

pub const SERVICE_TYPE: &str = "_greekgod-sync._tcp.local.";
const PROTOCOL_VERSION_PROPERTY: &str = "protocolVersion";
const SERVICE_ID_PROPERTY: &str = "serviceId";

pub struct MdnsAdvertisement {
    daemon: ServiceDaemon,
    fullname: String,
}

impl MdnsAdvertisement {
    pub fn register(service_id: &str, bind: SocketAddr) -> Result<Option<Self>, String> {
        if bind.ip().is_loopback() {
            return Ok(None);
        }

        let service_info = build_service_info(service_id, bind)?;
        let fullname = service_info.get_fullname().to_owned();
        let daemon = ServiceDaemon::new()
            .map_err(|error| format!("could not start mDNS discovery: {error}"))?;
        daemon
            .register(service_info)
            .map_err(|error| format!("could not register mDNS discovery: {error}"))?;

        Ok(Some(Self { daemon, fullname }))
    }

    pub fn shutdown(self) -> Result<(), String> {
        let unregister = self
            .daemon
            .unregister(&self.fullname)
            .map_err(|error| format!("could not unregister mDNS discovery: {error}"))?;
        unregister
            .recv_timeout(Duration::from_secs(3))
            .map_err(|error| format!("mDNS unregister did not complete: {error}"))?;
        let shutdown = self
            .daemon
            .shutdown()
            .map_err(|error| format!("could not stop mDNS discovery: {error}"))?;
        shutdown
            .recv_timeout(Duration::from_secs(3))
            .map_err(|error| format!("mDNS shutdown did not complete: {error}"))?;
        Ok(())
    }
}

fn build_service_info(service_id: &str, bind: SocketAddr) -> Result<ServiceInfo, String> {
    let short_id = service_id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(16)
        .collect::<String>();
    if short_id.is_empty() {
        return Err("serviceId cannot produce a valid mDNS name".into());
    }
    let instance_name = format!("GreekGod-{short_id}");
    let hostname = format!("greekgod-{short_id}.local.");
    let properties = HashMap::from([
        (
            PROTOCOL_VERSION_PROPERTY.to_owned(),
            PROTOCOL_VERSION.to_string(),
        ),
        (SERVICE_ID_PROPERTY.to_owned(), service_id.to_owned()),
    ]);
    ServiceInfo::new(
        SERVICE_TYPE,
        &instance_name,
        &hostname,
        bind.ip(),
        bind.port(),
        properties,
    )
    .map_err(|error| format!("invalid mDNS service metadata: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_contains_only_public_connection_fields() {
        let bind = "192.168.1.25:39173".parse().expect("private bind");
        let service = build_service_info("service-discovery-test", bind).expect("service info");

        assert_eq!(service.get_type(), SERVICE_TYPE);
        assert_eq!(service.get_port(), 39173);
        let protocol_version = PROTOCOL_VERSION.to_string();
        assert_eq!(
            service.get_property_val_str(PROTOCOL_VERSION_PROPERTY),
            Some(protocol_version.as_str())
        );
        assert_eq!(
            service.get_property_val_str(SERVICE_ID_PROPERTY),
            Some("service-discovery-test")
        );
        assert_eq!(service.get_properties().iter().count(), 2);
        for forbidden in [
            "token",
            "deviceToken",
            "certificateFingerprint",
            "user",
            "workout",
            "training",
        ] {
            assert!(service.get_property(forbidden).is_none());
        }
    }

    #[test]
    fn loopback_does_not_advertise_to_lan() {
        let bind = "127.0.0.1:39173".parse().expect("loopback bind");
        assert!(MdnsAdvertisement::register("service-loopback-test", bind)
            .expect("loopback decision")
            .is_none());
    }
}
