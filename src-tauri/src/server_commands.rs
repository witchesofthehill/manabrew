use manabrew_server::protocol::GameFormat;
use tauri::{AppHandle, State};

use crate::forge_room::{start_forge_host, stop_forge_host};
use crate::multiplayer_controller::relay_response_value;
use crate::server_client::ServerClient;
use crate::{client_bot::ClientBotManager, forge_room::ForgeRoomHost};
use manabot::{AgentKind, BotConfig};
use manabrew_agent_interface::deck_dto::Deck;

fn send_server_message(client: &ServerClient, msg: serde_json::Value) -> Result<(), String> {
    client.send(&msg.to_string())
}

#[tauri::command]
pub async fn server_connect(
    app: AppHandle,
    client: State<'_, ServerClient>,
    host: String,
    port: u16,
    username: String,
    password: String,
) -> Result<(), String> {
    client.connect(app, host, port, username, password)
}

#[tauri::command]
pub async fn server_disconnect(
    client: State<'_, ServerClient>,
    bot_manager: State<'_, ClientBotManager>,
) -> Result<(), String> {
    bot_manager.stop_all();
    client.disconnect();
    Ok(())
}

#[tauri::command]
pub async fn server_spawn_ai_bot(
    client: State<'_, ServerClient>,
    bot_manager: State<'_, ClientBotManager>,
    room_id: String,
    room_password: Option<String>,
    username: String,
    deck_name: String,
    deck: Deck,
    commander_name: Option<String>,
    agent: Option<AgentKind>,
) -> Result<(), String> {
    let connection = client.connection_config()?;
    let scheme = if connection.port == 443 { "wss" } else { "ws" };
    let relay_url = format!("{}://{}:{}", scheme, connection.host, connection.port);
    bot_manager.spawn_bot(
        relay_url,
        BotConfig {
            username,
            password: connection.password,
            room_id,
            room_password,
            deck_name,
            deck,
            commander_name,
            agent: agent.unwrap_or_default(),
        },
    )
}

#[tauri::command]
pub async fn server_remove_ai_bot(
    bot_manager: State<'_, ClientBotManager>,
    username: String,
) -> Result<(), String> {
    if bot_manager.stop_bot(&username) {
        Ok(())
    } else {
        Err(format!("No bot found with username '{}'", username))
    }
}

#[tauri::command]
pub async fn server_list_rooms(client: State<'_, ServerClient>) -> Result<(), String> {
    send_server_message(&client, serde_json::json!({"type": "ListRooms"}))
}

#[tauri::command]
pub async fn server_list_players(client: State<'_, ServerClient>) -> Result<(), String> {
    send_server_message(&client, serde_json::json!({"type": "ListPlayers"}))
}

#[tauri::command]
pub async fn server_stop_room(
    client: State<'_, ServerClient>,
    forge: State<'_, ForgeRoomHost>,
) -> Result<(), String> {
    match stop_forge_host(forge).await {
        Ok(_) => Ok(()),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn server_create_room(
    client: State<'_, ServerClient>,
    forge: State<'_, ForgeRoomHost>,
    room_name: String,
    max_players: u8,
    format: GameFormat,
    hosted: Option<bool>,
    engine: Option<String>,
    draft_config: Option<serde_json::Value>,
    sealed_config: Option<serde_json::Value>,
    reconnect_timeout_s: Option<u32>,
    password: Option<String>,
) -> Result<Option<String>, String> {
    if engine == Some("Forge".to_string()) {
        match start_forge_host(client, forge, room_name, format, max_players, password).await {
            Ok(room_id) => Ok(Some(room_id)),
            Err(e) => return Err(e),
        }
    } else {
        match send_server_message(
            &client,
            serde_json::json!({
                "type": "CreateRoom",
                "room_name": room_name,
                "max_players": max_players,
                "format": format,
                "hosted": hosted.unwrap_or(false),
                "engine": engine.unwrap_or_else(|| "Manabrew".to_string()),
                "draft_config": draft_config,
                "sealed_config": sealed_config,
                "reconnect_timeout_s": reconnect_timeout_s,
                "password": password.filter(|value| !value.is_empty()),
            }),
        ) {
            Ok(_) => Ok(None),
            Err(e) => return Err(e),
        }
    }
}

#[tauri::command]
pub async fn server_join_room(
    client: State<'_, ServerClient>,
    room_id: String,
    observe: Option<bool>,
    password: Option<String>,
) -> Result<(), String> {
    send_server_message(
        &client,
        serde_json::json!({
            "type": "JoinRoom",
            "room_id": room_id,
            "observe": observe.unwrap_or(false),
            "password": password,
        }),
    )
}

#[tauri::command]
pub async fn server_leave_room(
    client: State<'_, ServerClient>,
    bot_manager: State<'_, ClientBotManager>,
) -> Result<(), String> {
    bot_manager.stop_all();
    send_server_message(&client, serde_json::json!({"type": "LeaveRoom"}))
}

#[tauri::command]
pub async fn server_set_ready(client: State<'_, ServerClient>, ready: bool) -> Result<(), String> {
    send_server_message(
        &client,
        serde_json::json!({
            "type": "SetReady",
            "ready": ready,
        }),
    )
}

#[tauri::command]
pub async fn server_set_deck_selection(
    client: State<'_, ServerClient>,
    deck_name: String,
    deck: Deck,
    commander_name: Option<String>,
) -> Result<(), String> {
    send_server_message(
        &client,
        serde_json::json!({
            "type": "SetDeckSelection",
            "deck_name": deck_name,
            "deck": deck,
            "commander_name": commander_name,
        }),
    )
}

#[tauri::command]
pub async fn server_set_format(
    client: State<'_, ServerClient>,
    format: String,
) -> Result<(), String> {
    send_server_message(
        &client,
        serde_json::json!({
            "type": "SetFormat",
            "format": format,
        }),
    )
}

#[tauri::command]
pub async fn server_set_max_players(
    client: State<'_, ServerClient>,
    max_players: u8,
) -> Result<(), String> {
    send_server_message(
        &client,
        serde_json::json!({
            "type": "SetMaxPlayers",
            "max_players": max_players,
        }),
    )
}

#[tauri::command]
pub async fn server_start_game(
    client: State<'_, ServerClient>,
    format: Option<String>,
) -> Result<(), String> {
    send_server_message(
        &client,
        serde_json::json!({"type": "StartGame", "format": format}),
    )
}

#[tauri::command]
pub async fn server_end_game(client: State<'_, ServerClient>) -> Result<(), String> {
    send_server_message(&client, serde_json::json!({"type": "EndGame"}))
}

#[tauri::command]
pub async fn server_request_resync(client: State<'_, ServerClient>) -> Result<(), String> {
    send_server_message(&client, serde_json::json!({"type": "RequestResync"}))
}

#[tauri::command]
pub async fn server_broadcast_state(
    client: State<'_, ServerClient>,
    state: serde_json::Value,
) -> Result<(), String> {
    send_server_message(
        &client,
        serde_json::json!({
            "type": "BroadcastState",
            "state": state,
        }),
    )
}

#[tauri::command]
pub async fn server_send_room_message(
    client: State<'_, ServerClient>,
    message: serde_json::Value,
) -> Result<(), String> {
    let envelope: manabrew_agent_interface::protocol::StateEnvelope =
        serde_json::from_value(message.clone())
            .map_err(|e| format!("Room message must be a valid StateEnvelope: {}", e))?;
    if !matches!(
        envelope,
        manabrew_agent_interface::protocol::StateEnvelope::RoomRelay { .. }
    ) {
        return Err("Room message must be a roomRelay envelope".to_string());
    }
    send_server_message(
        &client,
        serde_json::json!({
            "type": "BroadcastState",
            "state": message,
        }),
    )
}

/// Remote player sends their response back to the host via the server relay.
#[tauri::command]
pub async fn server_respond(
    client: State<'_, ServerClient>,
    player_slot: String,
    action: serde_json::Value,
) -> Result<(), String> {
    relay_response_value(&client, &player_slot, action)
}
