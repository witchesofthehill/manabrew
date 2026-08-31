//! Finding a room on the local network, so nobody types an IP address.
//!
//! The host publishes an mDNS service while it is sharing; the others browse
//! for it. This is the only part of a LAN session that needs discovery at all:
//! once a guest has the host's address the ordinary relay client and the
//! ordinary room flow take over, exactly as they do against manabrew.app.

use serde::Serialize;

#[cfg(feature = "forge-room")]
pub const SERVICE_TYPE: &str = "_manabrew._tcp.local.";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanRoom {
    /// What to show a player choosing between rooms.
    pub name: String,
    pub host: String,
    pub port: u16,
}

#[cfg(feature = "forge-room")]
pub struct Advertisement {
    daemon: mdns_sd::ServiceDaemon,
    full_name: String,
}

#[cfg(feature = "forge-room")]
impl Drop for Advertisement {
    fn drop(&mut self) {
        let _ = self.daemon.unregister(&self.full_name);
        let _ = self.daemon.shutdown();
    }
}

/// Publishes this machine as a room host. The password is deliberately not in
/// the record: discovery says where a room is, never how to enter it.
#[cfg(feature = "forge-room")]
pub fn advertise(host: &str, port: u16) -> Result<Advertisement, String> {
    let daemon = mdns_sd::ServiceDaemon::new().map_err(|e| format!("mdns daemon: {e}"))?;
    let label = hostname();
    let instance = format!("{label}-{port}");
    let service = mdns_sd::ServiceInfo::new(
        SERVICE_TYPE,
        &instance,
        &format!("{instance}.local."),
        host,
        port,
        &[("name", label.as_str())][..],
    )
    .map_err(|e| format!("mdns service: {e}"))?;
    let full_name = service.get_fullname().to_string();
    daemon
        .register(service)
        .map_err(|e| format!("mdns register: {e}"))?;
    Ok(Advertisement { daemon, full_name })
}

#[cfg(feature = "forge-room")]
fn hostname() -> String {
    std::env::var("HOSTNAME")
        .ok()
        .or_else(|| std::env::var("COMPUTERNAME").ok())
        .unwrap_or_else(|| "manabrew".to_string())
        .replace('.', "-")
}

/// Collects the rooms answering on this network. Browsing is time-boxed rather
/// than continuous: a player opens the list, sees who is hosting, and joins.
#[tauri::command]
pub async fn discover_lan_rooms(timeout_ms: Option<u64>) -> Result<Vec<LanRoom>, String> {
    #[cfg(not(feature = "forge-room"))]
    {
        let _ = timeout_ms;
        Ok(Vec::new())
    }
    #[cfg(feature = "forge-room")]
    {
        let deadline =
            std::time::Duration::from_millis(timeout_ms.unwrap_or(1500).clamp(200, 8000));
        let daemon = mdns_sd::ServiceDaemon::new().map_err(|e| format!("mdns daemon: {e}"))?;
        let receiver = daemon
            .browse(SERVICE_TYPE)
            .map_err(|e| format!("mdns browse: {e}"))?;

        let mut rooms: Vec<LanRoom> = Vec::new();
        let started = std::time::Instant::now();
        while started.elapsed() < deadline {
            let remaining = deadline.saturating_sub(started.elapsed());
            match receiver.recv_timeout(remaining) {
                Ok(mdns_sd::ServiceEvent::ServiceResolved(info)) => {
                    let Some(addr) = info.get_addresses().iter().next() else {
                        continue;
                    };
                    let host = addr.to_string();
                    let port = info.get_port();
                    if rooms.iter().any(|r| r.host == host && r.port == port) {
                        continue;
                    }
                    rooms.push(LanRoom {
                        name: info
                            .get_property_val_str("name")
                            .unwrap_or_else(|| info.get_fullname())
                            .to_string(),
                        host,
                        port,
                    });
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        let _ = daemon.shutdown();
        Ok(rooms)
    }
}
