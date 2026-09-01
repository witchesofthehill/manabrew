use serde::Serialize;
use tauri::State;

#[cfg(feature = "forge-room")]
use std::sync::{Arc, Mutex};

// A room hosted here turns the direct plane on. Built without the feature it
// would announce no endpoint and quietly relay every seat, including four
// machines on one switch, which is the case this exists for.
#[cfg(feature = "forge-room")]
const _: () = assert!(
    self_hosted_node::DIRECT_PLANE,
    "forge-room needs self-hosted-node/iroh, or a LAN game silently falls back to the relay"
);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRelayInfo {
    pub host: String,
    pub port: u16,
    pub password: String,
    /// The address other machines on this network use. `None` when the relay is
    /// on loopback, which is the play-vs-AI case.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lan_host: Option<String>,
    /// Where this process hosts its iroh relay, so seats with no direct path
    /// still reach the host without anything leaving the network.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub iroh_relay_url: Option<String>,
    /// Where the other seats read this machine's card art, so only one of them
    /// has to have gone online. `None` when there is nothing to serve.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub art_port: Option<u16>,
}

#[cfg(feature = "forge-room")]
struct RunningRelay {
    info: LocalRelayInfo,
    shutdown: Arc<tokio::sync::Notify>,
    handle: tauri::async_runtime::JoinHandle<()>,
    /// Held so it lives as long as the room, not for its methods.
    iroh: Option<manabrew_server::iroh_relay::Server>,
    discovery: Option<crate::lan_discovery::Advertisement>,
    art: Option<crate::art_lan_server::ArtServer>,
}

/// Holds the relay this app is running (one at a time), so Forge play-vs-AI
/// works without an external relay: the self-hosted-node host and the webview
/// relay client both connect to it on 127.0.0.1.
///
/// With `share_on_lan` it binds the network instead, which is what turns one
/// desktop into the host for a room of machines that have no internet at all.
/// The password is the only thing gating it, so sharing is always a deliberate
/// act and never the default.
#[derive(Default)]
pub struct LocalRelayHost {
    #[cfg(feature = "forge-room")]
    running: Mutex<Option<RunningRelay>>,
}

impl LocalRelayHost {
    pub fn new() -> Self {
        Self::default()
    }
}

#[tauri::command]
pub fn local_relay_running(relay: State<'_, LocalRelayHost>) -> Result<bool, String> {
    #[cfg(not(feature = "forge-room"))]
    {
        let _ = relay;
        Ok(false)
    }
    #[cfg(feature = "forge-room")]
    {
        Ok(relay.running.lock().map_err(|e| e.to_string())?.is_some())
    }
}

#[tauri::command]
pub async fn start_local_relay(
    relay: State<'_, LocalRelayHost>,
    share_on_lan: Option<bool>,
) -> Result<LocalRelayInfo, String> {
    #[cfg(not(feature = "forge-room"))]
    {
        let _ = (relay, share_on_lan);
        Err("this desktop build was not compiled with the forge-room feature".to_string())
    }
    #[cfg(feature = "forge-room")]
    {
        let share_on_lan = share_on_lan.unwrap_or(false);
        if let Some(running) = relay.running.lock().map_err(|e| e.to_string())?.as_ref() {
            return Ok(running.info.clone());
        }

        // Bound to the one interface the neighbours are on rather than every
        // interface this machine has, so sharing a room on a home network does
        // not also open a lobby on whatever else the machine is attached to.
        let lan_host = if share_on_lan { lan_address() } else { None };
        let bind_ip = match &lan_host {
            Some(host) => host.parse().unwrap_or(std::net::IpAddr::from([0, 0, 0, 0])),
            None => std::net::IpAddr::from([127, 0, 0, 1]),
        };
        let listener = tokio::net::TcpListener::bind((bind_ip, 0))
            .await
            .map_err(|e| format!("failed to bind the local relay: {e}"))?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();

        // A shared room uses the well-known LAN key; a loopback one may as well
        // use a random one, since nothing else can reach it anyway.
        let password = if share_on_lan {
            crate::lan_discovery::LAN_RELAY_KEY.to_string()
        } else {
            use rand::{distributions::Alphanumeric, Rng};
            rand::thread_rng()
                .sample_iter(&Alphanumeric)
                .take(32)
                .map(char::from)
                .collect()
        };

        // Sharing means this machine serves the whole session, iroh relay
        // included, so a seat with no direct path is still served from here
        // rather than from the internet.
        let (iroh, iroh_relay_url) = match &lan_host {
            Some(host) => {
                match manabrew_server::iroh_relay::spawn(std::net::SocketAddr::from((bind_ip, 0)))
                    .await
                {
                    Some(server) => {
                        let url = server
                            .http_addr()
                            .map(|addr| format!("http://{host}:{}", addr.port()));
                        (Some(server), url)
                    }
                    None => (None, None),
                }
            }
            None => (None, None),
        };

        let state = Arc::new(
            manabrew_server::state::ServerState::new(
                password.clone(),
                4,
                None,
                manabrew_server::analytics::AnalyticsHandle::disabled(),
                manabrew_server::deck_play_events::DeckPlayEventHandle::disabled(),
                None,
            )
            .with_iroh_relay_url(iroh_relay_url.clone()),
        );
        let shutdown = Arc::new(tokio::sync::Notify::new());
        let health_addr = std::net::SocketAddr::from(([127, 0, 0, 1], 0));
        let handle = tauri::async_runtime::spawn(manabrew_server::server::serve(
            state,
            listener,
            health_addr,
            manabrew_server::metrics::detached_handle(),
            shutdown.clone(),
        ));

        // Only while sharing: art is world-readable to the subnet, which is a
        // different trust decision from the password-gated relay.
        let art = lan_host
            .as_ref()
            .and_then(|_| crate::image_cache::cache())
            .and_then(|cache| crate::art_lan_server::spawn(bind_ip, cache));
        let info = LocalRelayInfo {
            host: lan_host.clone().unwrap_or_else(|| "127.0.0.1".to_string()),
            port,
            password,
            lan_host: lan_host.clone(),
            iroh_relay_url,
            art_port: art.as_ref().map(|server| server.port),
        };
        let discovery = match &lan_host {
            // A room without discovery is still a room: the host can read its
            // address off the screen and the others type it once.
            Some(host) => crate::lan_discovery::advertise(host, port, info.art_port)
                .inspect_err(|e| eprintln!("[lan] not advertising this room: {e}"))
                .ok(),
            None => None,
        };

        let mut guard = relay.running.lock().map_err(|e| e.to_string())?;
        if let Some(running) = guard.as_ref() {
            shutdown.notify_waiters();
            handle.abort();
            return Ok(running.info.clone());
        }
        *guard = Some(RunningRelay {
            info: info.clone(),
            shutdown,
            handle,
            iroh,
            discovery,
            art,
        });
        Ok(info)
    }
}

/// This machine's address on the local network. Opening a UDP socket toward a
/// routable address picks the interface the kernel would use without sending
/// anything, which is the only portable way to answer "which of my addresses do
/// my neighbours see".
#[cfg(feature = "forge-room")]
fn lan_address() -> Option<String> {
    let socket = std::net::UdpSocket::bind(("0.0.0.0", 0)).ok()?;
    socket.connect(("192.168.1.1", 80)).ok()?;
    let addr = socket.local_addr().ok()?.ip();
    (!addr.is_loopback() && !addr.is_unspecified()).then(|| addr.to_string())
}

#[tauri::command]
pub async fn stop_local_relay(relay: State<'_, LocalRelayHost>) -> Result<(), String> {
    #[cfg(not(feature = "forge-room"))]
    {
        let _ = relay;
    }
    #[cfg(feature = "forge-room")]
    {
        // Taken out from under the lock before any await: a guard held across
        // one makes the whole command future non-Send.
        let running = relay.running.lock().map_err(|e| e.to_string())?.take();
        if let Some(running) = running {
            running.shutdown.notify_waiters();
            running.handle.abort();
            drop(running.discovery);
            drop(running.art);
            if let Some(iroh) = running.iroh {
                let _ = iroh.shutdown().await;
            }
        }
    }
    Ok(())
}
