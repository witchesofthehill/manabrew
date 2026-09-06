//! The webview's view of what is on this network. The mDNS itself is
//! `manabrew-lan-discovery`, which a headless relay uses to advertise.
//!
//! Browsing is deliberately not behind `forge-room`: a client that only ever
//! joins still has to find the machine hosting, and that is the whole point.

// Re-exported for `local_relay`, which only exists under `forge-room`; a
// client that just joins uses the command below and none of these.
#[allow(unused_imports)]
pub use manabrew_lan_discovery::{
    advertise, Advertisement, LanEndpoint, LanRole, LAN_RELAY_KEY, SERVICE_TYPE,
};

#[tauri::command]
pub async fn discover_lan_rooms(timeout_ms: Option<u64>) -> Result<Vec<LanEndpoint>, String> {
    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(1500).clamp(200, 8000));
    // mdns browsing parks a thread on a socket, so it does not belong on the
    // runtime a command is answered from.
    tokio::task::spawn_blocking(move || manabrew_lan_discovery::discover(timeout))
        .await
        .map_err(|e| e.to_string())?
}
