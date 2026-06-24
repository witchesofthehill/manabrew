use std::sync::{Arc, Mutex};

use manabrew_agent_interface::protocol::GameFormat;
use tauri::State;
use tokio::sync::Notify;

struct RunningRoom {
    cancel: Arc<Notify>,
    handle: tauri::async_runtime::JoinHandle<()>,
}

/// Holds the single Forge room this app is hosting (one at a time).
#[derive(Default)]
pub struct ForgeRoomHost {
    running: Mutex<Option<RunningRoom>>,
}

impl ForgeRoomHost {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Spawn the embedded self-hosted-node Forge host and return the id of the room
/// it created, so the UI can immediately join it through the web relay client.
#[tauri::command]
pub async fn start_forge_host(
    forge: State<'_, ForgeRoomHost>,
    host: String,
    port: u16,
    relay_password: String,
    room_name: String,
    format: GameFormat,
    max_players: u8,
    password: Option<String>,
) -> Result<String, String> {
    #[cfg(not(feature = "forge-room"))]
    {
        let _ = (
            forge,
            host,
            port,
            relay_password,
            room_name,
            format,
            max_players,
            password,
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

        let config = self_hosted_node::Config::for_hosted_room(
            relay_url,
            relay_password,
            room_name,
            format,
            max_players,
            password.filter(|value| !value.is_empty()),
        );

        let cancel: Arc<Notify> = Arc::new(Notify::new());
        let room_cancel = cancel.clone();
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<String>();
        let handle = tauri::async_runtime::spawn(async move {
            if let Err(error) = self_hosted_node::host_room(config, room_cancel, ready_tx).await {
                eprintln!("[forge_room] host exited: {error}");
            }
        });

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

        *forge.running.lock().map_err(|e| e.to_string())? = Some(RunningRoom { cancel, handle });
        Ok(room_id)
    }
}

#[tauri::command]
pub async fn stop_forge_host(forge: State<'_, ForgeRoomHost>) -> Result<(), String> {
    if let Some(room) = forge.running.lock().map_err(|e| e.to_string())?.take() {
        room.cancel.notify_one();
        room.handle.abort();
    }
    Ok(())
}
