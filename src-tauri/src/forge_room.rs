use std::sync::{Arc, Mutex};

use manabrew_agent_interface::protocol::GameFormat;
#[cfg(feature = "forge-room")]
use tauri::Emitter;
use tauri::State;
use tokio::sync::Notify;

/// Engine envelopes for a browser seat, and signalling for the host, on their
/// way out to the webview that holds the peer connections. A null payload is
/// never sent: the webview learns a channel is gone from its own
/// `RTCDataChannel`, and tells the node with `forge_host_serving`.
#[cfg(feature = "forge-room")]
const BRIDGE_EVENT: &str = "forge-host:bridge";

const NO_BRIDGE: &str = "no forge room is hosting through this webview";

#[cfg(feature = "forge-room")]
type BridgeSender =
    tokio::sync::mpsc::UnboundedSender<self_hosted_node::shell_bridge::ShellCommand>;

struct RunningRoom {
    cancel: Arc<Notify>,
    handle: tauri::async_runtime::JoinHandle<()>,
    /// How the webview answers the node: the seats it is serving, signalling
    /// to send under the host's identity, and seat envelopes to feed the
    /// engine.
    #[cfg(feature = "forge-room")]
    bridge: Option<BridgeSender>,
}

/// Holds the single Forge room this app is hosting (one at a time).
#[derive(Default)]
pub struct ForgeRoomHost {
    running: Mutex<Option<RunningRoom>>,
}

/// What crosses to the webview. Mirrors `ShellEvent`, tagged the way the
/// webview's other transport events are.
#[cfg(feature = "forge-room")]
#[derive(serde::Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum BridgeEvent {
    /// An engine envelope this host wants delivered to `target`.
    Envelope {
        target: String,
        envelope: serde_json::Value,
    },
    /// Signalling addressed to this host, from a room member.
    Signal {
        from: String,
        payload: serde_json::Value,
    },
}

impl ForgeRoomHost {
    pub fn new() -> Self {
        Self::default()
    }
}

#[tauri::command]
pub fn forge_room_available() -> bool {
    cfg!(feature = "forge-room")
}

#[tauri::command]
pub fn forge_room_running(forge: State<'_, ForgeRoomHost>) -> Result<bool, String> {
    Ok(forge.running.lock().map_err(|e| e.to_string())?.is_some())
}

/// Spawn the embedded self-hosted-node Forge host and return the id of the room
/// it created, so the UI can immediately join it through the web relay client.
#[tauri::command]
pub async fn start_forge_host(
    app: tauri::AppHandle,
    forge: State<'_, ForgeRoomHost>,
    host: String,
    port: u16,
    relay_password: String,
    room_name: String,
    format: GameFormat,
    max_players: u8,
    password: Option<String>,
    reconnect_timeout_s: Option<u32>,
    direct_transport: Option<bool>,
) -> Result<String, String> {
    #[cfg(not(feature = "forge-room"))]
    {
        let _ = (
            app,
            forge,
            host,
            port,
            relay_password,
            room_name,
            format,
            max_players,
            password,
            reconnect_timeout_s,
            direct_transport,
        );
        Err("this desktop build was not compiled with the forge-room feature".to_string())
    }
    #[cfg(feature = "forge-room")]
    {
        if forge.running.lock().map_err(|e| e.to_string())?.is_some() {
            return Err("a forge room is already running".to_string());
        }

        let scheme = if port == 443 { "wss" } else { "ws" };
        let relay_url = format!("{}://{}:{}", scheme, host, port);

        // The hosting player's own opt-in, read by the webview from Settings.
        // Off, this host has no direct plane of either kind: no native
        // endpoint, and no bridge for the webview to carry browser seats over.
        // It announces nothing, so the relay keeps the room on the relay.
        let direct_transport = direct_transport.unwrap_or(false);
        let config = self_hosted_node::Config::for_hosted_room(
            relay_url,
            relay_password,
            room_name,
            format,
            max_players,
            password.filter(|value| !value.is_empty()),
            reconnect_timeout_s,
        )
        .with_direct_plane(direct_transport);

        let cancel: Arc<Notify> = Arc::new(Notify::new());
        let room_cancel = cancel.clone();
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<String>();

        // A browser seat cannot be dialled from the node, so its envelopes go
        // out through the webview instead. The bridge is installed for every
        // hosted room the player opted in for: it costs one idle channel, and
        // whether a browser seat turns up is not known until one joins.
        let mut bridge_tx = None;
        let handle = if direct_transport {
            let emitter = app.clone();
            let (bridge, tx, bridge_rx) =
                self_hosted_node::shell_bridge::ShellBridge::new(move |event| {
                    let payload = match event {
                        self_hosted_node::shell_bridge::ShellEvent::Envelope {
                            target,
                            envelope,
                        } => BridgeEvent::Envelope { target, envelope },
                        self_hosted_node::shell_bridge::ShellEvent::Signal { from, payload } => {
                            BridgeEvent::Signal { from, payload }
                        }
                    };
                    let _ = emitter.emit(BRIDGE_EVENT, payload);
                });
            bridge_tx = Some(tx);
            let shell = self_hosted_node::ShellBridgeHandle {
                bridge,
                commands: bridge_rx,
            };
            tauri::async_runtime::spawn(async move {
                if let Err(error) =
                    self_hosted_node::host_room_bridged(config, room_cancel, ready_tx, shell).await
                {
                    eprintln!("[forge_room] host exited: {error}");
                }
            })
        } else {
            tauri::async_runtime::spawn(async move {
                if let Err(error) = self_hosted_node::host_room(config, room_cancel, ready_tx).await
                {
                    eprintln!("[forge_room] host exited: {error}");
                }
            })
        };

        let room_id = match tokio::time::timeout(std::time::Duration::from_secs(20), ready_rx).await
        {
            Ok(Ok(room_id)) => room_id,
            Ok(Err(_)) => {
                handle.abort();
                return Err("forge host exited before creating the room".to_string());
            }
            Err(_) => {
                cancel.notify_one();
                handle.abort();
                return Err("timed out creating forge room".to_string());
            }
        };

        *forge.running.lock().map_err(|e| e.to_string())? = Some(RunningRoom {
            cancel,
            handle,
            bridge: bridge_tx,
        });
        Ok(room_id)
    }
}

/// Which seats the webview has an open channel to, right now. Replaces the
/// whole set: a seat missing from this list is one whose channel has gone, and
/// the node puts it back on the relay owing a board.
#[tauri::command]
pub fn forge_host_serving(
    forge: State<'_, ForgeRoomHost>,
    seats: Vec<String>,
) -> Result<(), String> {
    #[cfg(not(feature = "forge-room"))]
    {
        let _ = (forge, seats);
        Err(NO_BRIDGE.to_string())
    }
    #[cfg(feature = "forge-room")]
    send_bridge(
        &forge,
        self_hosted_node::shell_bridge::ShellCommand::Serving { seats },
    )
}

/// Signalling the webview wants sent under the host's relay identity. It has
/// no session of its own to speak for the host with, which is why it goes back
/// through the node.
#[tauri::command]
pub fn forge_host_signal(
    forge: State<'_, ForgeRoomHost>,
    to: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    #[cfg(not(feature = "forge-room"))]
    {
        let _ = (forge, to, payload);
        Err(NO_BRIDGE.to_string())
    }
    #[cfg(feature = "forge-room")]
    send_bridge(
        &forge,
        self_hosted_node::shell_bridge::ShellCommand::Signal { to, payload },
    )
}

/// A seat's own envelope, arrived over the webview's channel. Takes the same
/// route into the engine a relay `StateUpdate` takes.
#[tauri::command]
pub fn forge_host_seat_envelope(
    forge: State<'_, ForgeRoomHost>,
    from: String,
    envelope: serde_json::Value,
) -> Result<(), String> {
    #[cfg(not(feature = "forge-room"))]
    {
        let _ = (forge, from, envelope);
        Err(NO_BRIDGE.to_string())
    }
    #[cfg(feature = "forge-room")]
    send_bridge(
        &forge,
        self_hosted_node::shell_bridge::ShellCommand::SeatEnvelope { from, envelope },
    )
}

#[cfg(feature = "forge-room")]
fn send_bridge(
    forge: &State<'_, ForgeRoomHost>,
    command: self_hosted_node::shell_bridge::ShellCommand,
) -> Result<(), String> {
    let running = forge.running.lock().map_err(|e| e.to_string())?;
    let Some(bridge) = running.as_ref().and_then(|room| room.bridge.as_ref()) else {
        return Err(NO_BRIDGE.to_string());
    };
    bridge
        .send(command)
        .map_err(|_| "forge host is gone".to_string())
}

#[tauri::command]
pub async fn stop_forge_host(forge: State<'_, ForgeRoomHost>) -> Result<(), String> {
    if let Some(room) = forge.running.lock().map_err(|e| e.to_string())?.take() {
        room.cancel.notify_one();
        room.handle.abort();
    }
    Ok(())
}
