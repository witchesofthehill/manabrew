use crate::game_log_event::GameLogEntryDto;
use crate::game_snapshot_event::GameSnapshotEventDto;
use serde::{Deserialize, Serialize};
use serde_json::Value;

// Wire types (ClientMessage, ServerMessage, RoomInfo, Deck, …) live in
// forge-protocol; StateEnvelope stays here because it carries engine DTOs.
pub use forge_protocol::protocol::*;

/// Typed envelope carried inside `ClientMessage::BroadcastState.state` /
/// `ServerMessage::StateUpdate.state`. One discriminator (`kind`) plus the
/// payload for that variant. Constructed and parsed in every layer that
/// touches the relay (engine, bot, host, web/Tauri UI) — anything that needs
/// to handcraft `json!({"kind": "..."})` belongs here instead.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StateEnvelope {
    State {
        state: Value,
    },
    Display {
        event: Value,
    },
    /// Engine asks a player for a decision. `prompt` is `AgentPrompt` for the
    /// Rust engine; the Java bridge emits a different shape, so the payload is
    /// kept as raw `Value` here and parsed by the receiver.
    Prompt {
        #[serde(rename = "forPlayer")]
        for_player: String,
        prompt: Value,
    },
    /// Player answers a prompt. `action` is `PlayerAction` for Rust; raw value
    /// for the Java bridge.
    Response {
        #[serde(rename = "fromPlayer")]
        from_player: String,
        action: Value,
    },
    /// Engine log entry broadcast to observers.
    Log {
        #[serde(rename = "fromPlayer")]
        from_player: String,
        entry: GameLogEntryDto,
    },
    /// Engine snapshot broadcast to observers.
    Snapshot {
        #[serde(rename = "fromPlayer")]
        from_player: String,
        entry: GameSnapshotEventDto,
    },
    /// Out-of-band message tunneled through the relay (manual tabletop launch,
    /// self-hosted-node control plane, heartbeats, …). The relay never
    /// interprets the `payload`.
    RoomRelay {
        protocol: String,
        version: u32,
        #[serde(rename = "messageId")]
        message_id: String,
        #[serde(
            rename = "fromPlayer",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        from_player: Option<String>,
        #[serde(
            rename = "targetPlayer",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        target_player: Option<String>,
        #[serde(rename = "roomId", default, skip_serializing_if = "Option::is_none")]
        room_id: Option<String>,
        payload: Value,
    },
}

impl StateEnvelope {
    pub fn for_agent_message(for_player: String, message: &crate::prompt::AgentMessage) -> Self {
        use crate::prompt::AgentMessage;
        match message {
            AgentMessage::State(state) => StateEnvelope::State {
                state: serde_json::to_value(state).unwrap_or(Value::Null),
            },
            AgentMessage::Display(event) => StateEnvelope::Display {
                event: serde_json::to_value(event).unwrap_or(Value::Null),
            },
            AgentMessage::Prompt(prompt) => StateEnvelope::Prompt {
                for_player,
                prompt: serde_json::to_value(prompt).unwrap_or(Value::Null),
            },
        }
    }
}
