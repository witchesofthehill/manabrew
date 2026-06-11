use std::sync::Mutex;

use futures_util::{SinkExt, StreamExt};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

use forge_agent_interface::protocol::StateEnvelope;
use forge_server::protocol::ServerMessage;

pub struct ServerClient {
    tx: Mutex<Option<mpsc::UnboundedSender<String>>>,
    task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    config: Mutex<Option<ServerConnectionConfig>>,
    pub connected: Mutex<bool>,
    pub username: Mutex<Option<String>>,
    pub player_id: Mutex<Option<String>>,
}

#[derive(Debug, Clone)]
pub struct ServerConnectionConfig {
    pub host: String,
    pub port: u16,
    pub password: String,
}

impl ServerClient {
    pub fn new() -> Self {
        ServerClient {
            tx: Mutex::new(None),
            task: Mutex::new(None),
            config: Mutex::new(None),
            connected: Mutex::new(false),
            username: Mutex::new(None),
            player_id: Mutex::new(None),
        }
    }

    pub fn send(&self, json: &str) -> Result<(), String> {
        let guard = self.tx.lock().map_err(|e| e.to_string())?;
        if let Some(tx) = guard.as_ref() {
            tx.send(json.to_string()).map_err(|e| e.to_string())
        } else {
            Err("Not connected".into())
        }
    }

    pub fn disconnect(&self) {
        // Abort the WS task first — this drops the WS stream and closes the TCP
        // connection, so the server sees the disconnect immediately.
        if let Ok(mut guard) = self.task.lock() {
            if let Some(handle) = guard.take() {
                handle.abort();
            }
        }
        if let Ok(mut guard) = self.tx.lock() {
            *guard = None;
        }
        if let Ok(mut guard) = self.connected.lock() {
            *guard = false;
        }
        if let Ok(mut guard) = self.username.lock() {
            *guard = None;
        }
        if let Ok(mut guard) = self.player_id.lock() {
            *guard = None;
        }
        if let Ok(mut guard) = self.config.lock() {
            *guard = None;
        }
    }

    pub fn connection_config(&self) -> Result<ServerConnectionConfig, String> {
        self.config
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or_else(|| "Not connected".to_string())
    }

    pub fn connect(
        &self,
        app: AppHandle,
        host: String,
        port: u16,
        username: String,
        password: String,
    ) -> Result<(), String> {
        self.disconnect();

        let (tx, rx) = mpsc::unbounded_channel::<String>();

        if let Ok(mut guard) = self.tx.lock() {
            *guard = Some(tx.clone());
        }
        if let Ok(mut guard) = self.username.lock() {
            *guard = Some(username.clone());
        }
        if let Ok(mut guard) = self.config.lock() {
            *guard = Some(ServerConnectionConfig {
                host: host.clone(),
                port,
                password: password.clone(),
            });
        }

        let scheme = if port == 443 { "wss" } else { "ws" };
        let url = format!("{}://{}:{}", scheme, host, port);

        let handle = tauri::async_runtime::spawn(async move {
            if let Err(e) = run_ws_client(app.clone(), url, username, password, tx, rx).await {
                let _ = app.emit(
                    "server:error",
                    serde_json::json!({"code": "connection_error", "message": e}),
                );
                let _ = app.emit("server:disconnected", serde_json::json!({}));
            }
        });

        if let Ok(mut guard) = self.task.lock() {
            *guard = Some(handle);
        }

        Ok(())
    }
}

async fn run_ws_client(
    app: AppHandle,
    url: String,
    username: String,
    password: String,
    _tx: mpsc::UnboundedSender<String>,
    mut rx: mpsc::UnboundedReceiver<String>,
) -> Result<(), String> {
    let (ws_stream, _) = tokio_tungstenite::connect_async(&url)
        .await
        .map_err(|e| format!("Failed to connect to {}: {}", url, e))?;

    let (mut sink, mut stream) = ws_stream.split();

    // Send Authenticate
    let auth_msg = serde_json::json!({
        "type": "Authenticate",
        "username": username,
        "password": password,
    });
    sink.send(Message::Text(auth_msg.to_string()))
        .await
        .map_err(|e| format!("Failed to send auth: {}", e))?;

    let app_read = app.clone();
    let app_write = app.clone();

    // Spawn write task: forwards outbound messages from channel to WS sink
    let write_task = tauri::async_runtime::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sink.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });

    // Read loop: parse server messages and emit Tauri events
    while let Some(frame) = stream.next().await {
        let frame = match frame {
            Ok(f) => f,
            Err(_) => break,
        };

        let text = match frame {
            Message::Text(t) => t,
            Message::Close(_) => break,
            _ => continue,
        };

        let server_msg: ServerMessage = match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(_) => continue,
        };

        emit_server_message(&app_read, &server_msg);
    }

    // Connection closed
    let _ = app_write.emit("server:disconnected", serde_json::json!({}));
    write_task.abort();

    Ok(())
}

fn emit_server_message(app: &AppHandle, msg: &ServerMessage) {
    if let ServerMessage::StateUpdate { from_player, state } = msg {
        if let Ok(envelope) = serde_json::from_value::<StateEnvelope>(state.clone()) {
            match envelope {
                StateEnvelope::Response { .. } => {
                    let gm: tauri::State<'_, crate::game_manager::GameManager> =
                        app.state::<crate::game_manager::GameManager>();
                    gm.route_remote_response(state);
                    return;
                }
                StateEnvelope::RoomRelay { .. } => {
                    let _ = app.emit(
                        "server:room_message",
                        serde_json::json!({ "from_player": from_player, "state": state }),
                    );
                }
                StateEnvelope::State { .. } => {
                    let _ = app.emit("game:remote_state", state);
                    return;
                }
                StateEnvelope::Display { .. } => {
                    let _ = app.emit("game:remote_display", state);
                    return;
                }
                StateEnvelope::Prompt { .. } => {
                    let _ = app.emit("game:remote_prompt", state);
                    return;
                }
                StateEnvelope::Log { entry, .. } => {
                    let _ = app.emit("game:log", &entry);
                    return;
                }
                StateEnvelope::Snapshot { entry, .. } => {
                    let _ = app.emit("game:snapshot", &entry);
                    return;
                }
            }
        }
    }

    if let ServerMessage::Error { code, message } = msg {
        if code == "not_in_room" {
            if let Some(gm) = app.try_state::<crate::game_manager::GameManager>() {
                if let Err(e) = gm.end_game() {
                    eprintln!("[server] failed to end game after not_in_room: {}", e);
                }
            }
            let _ = app.emit(
                "game:forced_end",
                serde_json::json!({
                    "reason": "not_in_room",
                    "message": message,
                }),
            );
        }
    }

    let (event, payload) = match msg {
        ServerMessage::AuthResult {
            success,
            player_id,
            reconnected,
            error,
        } => (
            "server:auth_result",
            serde_json::json!({
                "success": success,
                "player_id": player_id,
                "reconnected": reconnected,
                "error": error,
            }),
        ),
        ServerMessage::RoomList { rooms } => {
            ("server:room_list", serde_json::json!({ "rooms": rooms }))
        }
        ServerMessage::PlayerList { players } => (
            "server:player_list",
            serde_json::json!({ "players": players }),
        ),
        ServerMessage::RoomCreated { room_id, room_name } => (
            "server:room_created",
            serde_json::json!({ "room_id": room_id, "room_name": room_name }),
        ),
        ServerMessage::PlayerJoined { room_id, username } => (
            "server:player_joined",
            serde_json::json!({ "room_id": room_id, "username": username }),
        ),
        ServerMessage::PlayerLeft { room_id, username } => (
            "server:player_left",
            serde_json::json!({ "room_id": room_id, "username": username }),
        ),
        ServerMessage::PlayerConnected { username } => (
            "server:player_connected",
            serde_json::json!({ "username": username }),
        ),
        ServerMessage::PlayerDisconnected { username } => (
            "server:player_disconnected",
            serde_json::json!({ "username": username }),
        ),
        ServerMessage::ReadyStateChanged { username, ready } => (
            "server:ready_changed",
            serde_json::json!({ "username": username, "ready": ready }),
        ),
        ServerMessage::RoomUpdate { room } => {
            ("server:room_update", serde_json::json!({ "room": room }))
        }
        ServerMessage::GameStarted {
            room_id,
            player_order,
            player_decks,
            starting_life,
        } => (
            "server:game_started",
            serde_json::json!({
                "room_id": room_id,
                "player_order": player_order,
                "player_decks": player_decks,
                "starting_life": starting_life,
            }),
        ),
        ServerMessage::StateUpdate { from_player, state } => (
            "server:state_update",
            serde_json::json!({ "from_player": from_player, "state": state }),
        ),
        ServerMessage::TurnChanged {
            from_player,
            new_active_player,
            turn_number,
        } => (
            "server:turn_changed",
            serde_json::json!({ "from_player": from_player, "new_active_player": new_active_player, "turn_number": turn_number }),
        ),
        ServerMessage::GameAborted { room_id } => (
            "server:game_aborted",
            serde_json::json!({ "room_id": room_id }),
        ),
        ServerMessage::Error { code, message } => (
            "server:error",
            serde_json::json!({ "code": code, "message": message }),
        ),
        ServerMessage::ServerShuttingDown { reconnect_in_s } => (
            "server:reconnecting",
            serde_json::json!({
                "phase": "reconnecting",
                "reason": "server-shutdown",
                "delayMs": reconnect_in_s * 1000,
                "attempt": 1,
            }),
        ),
    };

    let _ = app.emit(event, payload);
}
