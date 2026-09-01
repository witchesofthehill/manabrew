//! Finding a manabrew relay or room on the local network, so nobody types an
//! address.
//!
//! Advertised by whoever is worth connecting to: an always-on relay on a box in
//! a cupboard, or a desktop hosting a table. The record says where something is
//! and what kind of thing it is, never how to enter it: a room's password is
//! not in here.

use serde::{Deserialize, Serialize};

pub const SERVICE_TYPE: &str = "_manabrew._tcp.local.";

/// The key a shared listener runs on. Never access control: `Authenticate`
/// checks it and then runs the real identity handshake. It is here so a client
/// never has to be told it.
pub const LAN_RELAY_KEY: &str = "manabrew-lan";

/// What is answering. A relay is infrastructure worth staying connected to; a
/// room is one table on somebody's desktop. They need the same fields and lead
/// to different places, so the record has to say which.
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

    /// Absent means room: desktop builds already shipped advertising without
    /// this property, and they were all rooms.
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

/// Publishes this machine. Held for as long as it should be findable; dropping
/// it withdraws the record.
pub fn advertise(
    role: LanRole,
    host: &str,
    port: u16,
    art_port: Option<u16>,
) -> Result<Advertisement, String> {
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
        host,
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

/// Collects what is answering on this network. Time-boxed rather than
/// continuous: a player opens the list, sees what is there, and picks.
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

/// The label a player picks this machine out of a list by, so it has to be the
/// machine's actual name. `HOSTNAME` is a shell variable: a macOS GUI app and a
/// systemd unit both run without it, and every one of them would otherwise
/// advertise as "manabrew" and collide with the next.
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
