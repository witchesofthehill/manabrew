//! Finding a manabrew relay or room on the local network, so nobody types an
//! address. The record says where something is and what it is, never how to
//! enter it: a room's password is not in here.

use serde::{Deserialize, Serialize};
use std::net::IpAddr;

pub const SERVICE_TYPE: &str = "_manabrew._tcp.local.";

/// Never access control: `Authenticate` checks it and then runs the real
/// identity handshake. Here so a client is never told it.
pub const LAN_RELAY_KEY: &str = "manabrew-lan";

/// A relay is the network's lobby; a room is one table on a desktop. The
/// record says which.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LanRole {
    Relay,
    Room,
}

impl LanRole {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Relay => "relay",
            Self::Room => "room",
        }
    }

    /// Absent means room: shipped builds advertise without it, and all are rooms.
    fn parse(value: Option<&str>) -> Self {
        match value {
            Some("relay") => Self::Relay,
            _ => Self::Room,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanEndpoint {
    /// What to show a player choosing between them.
    pub name: String,
    pub host: String,
    pub port: u16,
    pub role: LanRole,
    /// Where this machine serves its card art, when it is serving any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub art_port: Option<u16>,
    /// Carried so the client never duplicates the constant, and never has to
    /// ask anyone for it.
    pub key: String,
}

pub struct Advertisement {
    daemon: mdns_sd::ServiceDaemon,
    full_name: String,
}

impl Drop for Advertisement {
    fn drop(&mut self) {
        let _ = self.daemon.unregister(&self.full_name);
        let _ = self.daemon.shutdown();
    }
}

/// Held for as long as this should be findable; dropping it withdraws.
///
/// `host` is where the socket is bound. `0.0.0.0` is every interface to a
/// socket and no interface to mDNS, which announces a service only where its
/// address belongs; a relay bound that way said it was advertising and was
/// found by nobody. So the record carries the address the neighbours reach.
pub fn advertise(
    role: LanRole,
    host: &str,
    port: u16,
    art_port: Option<u16>,
) -> Result<Advertisement, String> {
    let host = advertised_host(host)
        .ok_or_else(|| "no address to advertise: this machine is on no network".to_string())?;
    let daemon = mdns_sd::ServiceDaemon::new().map_err(|e| format!("mdns daemon: {e}"))?;
    let label = hostname();
    let instance = format!("{label}-{port}");
    let mut properties = vec![
        ("name".to_string(), label.clone()),
        ("role".to_string(), role.as_str().to_string()),
    ];
    if let Some(port) = art_port {
        properties.push(("art".to_string(), port.to_string()));
    }
    let service = mdns_sd::ServiceInfo::new(
        SERVICE_TYPE,
        &instance,
        &format!("{instance}.local."),
        host.as_str(),
        port,
        &properties[..],
    )
    .map_err(|e| format!("mdns service: {e}"))?;
    let full_name = service.get_fullname().to_string();
    daemon
        .register(service)
        .map_err(|e| format!("mdns register: {e}"))?;
    Ok(Advertisement { daemon, full_name })
}

/// Time-boxed rather than continuous: a player opens the list and picks.
pub fn discover(timeout: std::time::Duration) -> Result<Vec<LanEndpoint>, String> {
    let daemon = mdns_sd::ServiceDaemon::new().map_err(|e| format!("mdns daemon: {e}"))?;
    let receiver = daemon
        .browse(SERVICE_TYPE)
        .map_err(|e| format!("mdns browse: {e}"))?;

    let mut found: Vec<LanEndpoint> = Vec::new();
    let started = std::time::Instant::now();
    while started.elapsed() < timeout {
        let remaining = timeout.saturating_sub(started.elapsed());
        match receiver.recv_timeout(remaining) {
            Ok(mdns_sd::ServiceEvent::ServiceResolved(info)) => {
                let Some(addr) = info.get_addresses().iter().next() else {
                    continue;
                };
                let host = addr.to_string();
                let port = info.get_port();
                if found.iter().any(|e| e.host == host && e.port == port) {
                    continue;
                }
                found.push(LanEndpoint {
                    name: info
                        .get_property_val_str("name")
                        .unwrap_or_else(|| info.get_fullname())
                        .to_string(),
                    host,
                    port,
                    role: LanRole::parse(info.get_property_val_str("role")),
                    art_port: info
                        .get_property_val_str("art")
                        .and_then(|value| value.parse().ok()),
                    key: LAN_RELAY_KEY.to_string(),
                });
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    let _ = daemon.shutdown();
    Ok(found)
}

fn advertised_host(bound: &str) -> Option<String> {
    match bound.parse::<IpAddr>() {
        Ok(ip) if ip.is_unspecified() => lan_address().map(|ip| ip.to_string()),
        Ok(_) => Some(bound.to_string()),
        Err(_) if bound.is_empty() => lan_address().map(|ip| ip.to_string()),
        Err(_) => Some(bound.to_string()),
    }
}

/// The address the neighbours reach this machine on: the interface carrying
/// the default route, or with no route at all, which is what a network without
/// internet looks like, the first interface with an address of its own.
pub fn lan_address() -> Option<IpAddr> {
    routed_address().or_else(first_interface_address)
}

fn routed_address() -> Option<IpAddr> {
    let socket = std::net::UdpSocket::bind(("0.0.0.0", 0)).ok()?;
    socket.connect(("192.168.1.1", 80)).ok()?;
    let ip = socket.local_addr().ok()?.ip();
    reachable(ip).then_some(ip)
}

fn first_interface_address() -> Option<IpAddr> {
    if_addrs::get_if_addrs()
        .ok()?
        .into_iter()
        .map(|interface| interface.ip())
        .find(|ip| reachable(*ip))
}

/// IPv4 only: a link-local IPv6 address needs a scope id the record cannot
/// carry, and the desktop dials what the record says.
fn reachable(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => !v4.is_loopback() && !v4.is_unspecified() && !v4.is_link_local(),
        IpAddr::V6(_) => false,
    }
}

/// `HOSTNAME` is a shell variable that a systemd unit and a macOS GUI app both
/// run without, so reading only the environment made every machine advertise as
/// "manabrew" and collide with the next.
fn hostname() -> String {
    #[cfg(unix)]
    let read = std::fs::read_to_string("/etc/hostname")
        .ok()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty());
    #[cfg(not(unix))]
    let read: Option<String> = None;

    read.or_else(|| std::env::var("HOSTNAME").ok())
        .or_else(|| std::env::var("COMPUTERNAME").ok())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "manabrew".to_string())
        .replace('.', "-")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Desktop builds already in the wild advertise no `role`, and every one of
    /// them is a room. Reading absence as a relay would put a client's lobby on
    /// somebody's laptop.
    #[test]
    fn a_record_without_a_role_is_a_room() {
        assert_eq!(LanRole::parse(None), LanRole::Room);
        assert_eq!(LanRole::parse(Some("room")), LanRole::Room);
        assert_eq!(LanRole::parse(Some("relay")), LanRole::Relay);
        assert_eq!(LanRole::parse(Some("something else")), LanRole::Room);
    }

    /// A relay bound to `0.0.0.0` (the default) registered that as its
    /// address, and mDNS announced it on no interface: the log said
    /// "answering mdns" and `dns-sd -B _manabrew._tcp` showed nothing.
    #[test]
    fn an_unspecified_bind_address_is_never_the_advertised_one() {
        assert_ne!(advertised_host("0.0.0.0").as_deref(), Some("0.0.0.0"));
        assert_ne!(advertised_host("::").as_deref(), Some("::"));
        assert_ne!(advertised_host("").as_deref(), Some(""));
        assert_eq!(advertised_host("10.1.2.3").as_deref(), Some("10.1.2.3"));
        assert_eq!(
            advertised_host("relay.local").as_deref(),
            Some("relay.local")
        );
        if let Some(ip) = lan_address() {
            assert!(reachable(ip));
        }
    }

    /// The name is what a player picks a server by. A systemd unit has no
    /// `HOSTNAME`, so reading only the environment made every Linux box
    /// advertise as "manabrew".
    #[test]
    fn the_advertised_name_is_the_machine_not_a_placeholder() {
        let name = hostname();
        assert!(!name.is_empty());
        assert!(!name.contains('.'), "dots break the mdns instance name");
        #[cfg(target_os = "linux")]
        if std::path::Path::new("/etc/hostname").exists() {
            assert_ne!(name, "manabrew", "a linux host knows its own name");
        }
    }
}
