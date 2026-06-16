use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::network::{decode_relay_response, wrap_broadcast_state};
use crate::server_client::ServerClient;
use manabrew_agent_interface::game_log_event::GameLogEntryDto;
use manabrew_agent_interface::game_snapshot_event::GameSnapshotEventDto;
use manabrew_agent_interface::ids_codec::player_slot;
use manabrew_agent_interface::prompt::{AgentMessage, AgentPrompt, PlayerAction};
use manabrew_agent_interface::protocol::StateEnvelope;

pub fn spawn_engine_prompt_forwarder(
    app: AppHandle,
    latest_prompt: Arc<Mutex<Option<AgentPrompt>>>,
    latest_prompt_payload: Arc<Mutex<Option<Value>>>,
    rx: mpsc::Receiver<AgentMessage>,
) {
    thread::spawn(move || {
        eprintln!("[prompt_fwd] Engine message forwarder started");
        while let Ok(message) = rx.recv() {
            match message {
                AgentMessage::State(state) => {
                    let _ = app.emit("game:state", &state);
                }
                AgentMessage::Display(event) => {
                    let _ = app.emit("game:display", &event);
                }
                AgentMessage::Prompt(prompt) => {
                    if let Ok(mut lp) = latest_prompt.lock() {
                        *lp = Some(prompt.clone());
                    }
                    if let Ok(mut lp) = latest_prompt_payload.lock() {
                        *lp = serde_json::to_value(&prompt).ok();
                    }
                    let _ = app.emit("game:prompt", &prompt);
                }
            }
        }
        eprintln!("[prompt_fwd] Engine message forwarder ended");
    });
}

pub fn spawn_notify_forwarder(
    app: AppHandle,
    rx: mpsc::Receiver<GameLogEntryDto>,
    relay_from_player: Option<String>,
) {
    thread::spawn(move || {
        let window = app.get_webview_window("main");
        while let Ok(msg) = rx.recv() {
            let _ = if let Some(ref w) = window {
                w.emit("game:log", &msg)
            } else {
                app.emit("game:log", &msg)
            };
            if let Some(from_player) = relay_from_player.as_ref() {
                let envelope = StateEnvelope::Log {
                    from_player: from_player.clone(),
                    entry: msg,
                };
                let state = match serde_json::to_value(envelope) {
                    Ok(v) => v,
                    Err(e) => {
                        eprintln!("[log_fwd] Failed to encode log envelope: {}", e);
                        continue;
                    }
                };
                let payload = wrap_broadcast_state(state);
                if let Some(client) = app.try_state::<ServerClient>() {
                    let _ = client.send(&payload);
                }
            }
        }
    });
}

pub fn spawn_snapshot_forwarder(
    app: AppHandle,
    rx: mpsc::Receiver<GameSnapshotEventDto>,
    relay_from_player: Option<String>,
) {
    thread::spawn(move || {
        let window = app.get_webview_window("main");
        while let Ok(msg) = rx.recv() {
            let _ = if let Some(ref w) = window {
                w.emit("game:snapshot", &msg)
            } else {
                app.emit("game:snapshot", &msg)
            };
            if let Some(from_player) = relay_from_player.as_ref() {
                let envelope = StateEnvelope::Snapshot {
                    from_player: from_player.clone(),
                    entry: msg,
                };
                let state = match serde_json::to_value(envelope) {
                    Ok(v) => v,
                    Err(e) => {
                        eprintln!("[snapshot_fwd] Failed to encode snapshot envelope: {}", e);
                        continue;
                    }
                };
                let payload = wrap_broadcast_state(state);
                if let Some(client) = app.try_state::<ServerClient>() {
                    let _ = client.send(&payload);
                }
            }
        }
    });
}

pub fn spawn_remote_prompt_forwarder(app: AppHandle, rx: mpsc::Receiver<(usize, AgentMessage)>) {
    thread::spawn(move || {
        eprintln!("[remote_fwd] Remote message forwarder started");
        // State/Display carry no `forPlayer` and are identical for every player;
        // the engine's per-agent fan-out emits N consecutive identical copies.
        // Broadcast each once.
        let mut last_state: Option<Value> = None;
        let mut last_display: Option<Value> = None;
        while let Ok((player_index, message)) = rx.recv() {
            let envelope = StateEnvelope::for_agent_message(player_slot(player_index), &message);
            let state = match serde_json::to_value(envelope) {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("[remote_fwd] Failed to encode envelope: {}", e);
                    continue;
                }
            };
            match &message {
                AgentMessage::State(_) if last_state.as_ref() == Some(&state) => continue,
                AgentMessage::State(_) => last_state = Some(state.clone()),
                AgentMessage::Display(_) if last_display.as_ref() == Some(&state) => continue,
                AgentMessage::Display(_) => last_display = Some(state.clone()),
                AgentMessage::Prompt(_) => {}
            }
            let msg = wrap_broadcast_state(state);
            if let Some(client) = app.try_state::<ServerClient>() {
                let _ = client.send(&msg);
            }
        }
        eprintln!("[remote_fwd] Remote message forwarder ended");
    });
}

pub fn relay_response(
    client: &ServerClient,
    player_slot: &str,
    action: PlayerAction,
) -> Result<(), String> {
    let action_value = serde_json::to_value(action).map_err(|e| e.to_string())?;
    relay_response_value(client, player_slot, action_value)
}

pub fn relay_response_value(
    client: &ServerClient,
    player_slot: &str,
    action: serde_json::Value,
) -> Result<(), String> {
    let envelope = StateEnvelope::Response {
        from_player: player_slot.to_string(),
        action,
    };
    let state = serde_json::to_value(envelope).map_err(|e| e.to_string())?;
    let msg = wrap_broadcast_state(state);
    client.send(&msg)
}

pub fn parse_remote_response(state: &serde_json::Value) -> Result<(usize, PlayerAction), String> {
    decode_relay_response(state)
}
