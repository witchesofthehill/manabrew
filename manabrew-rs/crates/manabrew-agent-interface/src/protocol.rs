use crate::game_log_event::GameLogEntryDto;
use crate::game_snapshot_event::GameSnapshotEventDto;
use serde::{Deserialize, Serialize};
use serde_json::Value;

// Wire types (ClientMessage, ServerMessage, RoomInfo, …) live in
// manabrew-relay-protocol; StateEnvelope stays here because it carries engine DTOs.
pub use manabrew_relay_protocol::*;

/// Typed envelope carried inside `ClientMessage::BroadcastState.state` /
/// `ServerMessage::StateUpdate.state`. One discriminator (`kind`) plus the
/// payload for that variant. Constructed and parsed in every layer that
/// touches the relay (engine, bot, host, web/Tauri UI) — anything that needs
/// to handcraft `json!({"kind": "..."})` belongs here instead.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StateEnvelope {
    State {
        #[serde(rename = "forPlayer", default, skip_serializing_if = "Option::is_none")]
        for_player: Option<String>,
        state: Value,
        /// Milliseconds the engine host spent between receiving the response
        /// that caused this state and sending it. Lets a receiver separate
        /// engine work from the hop to the engine host, which is otherwise
        /// impossible: only the relay stamps these envelopes, and comparing
        /// clocks across hosts is not something we want to rely on.
        #[serde(rename = "engineMs", default, skip_serializing_if = "Option::is_none")]
        engine_ms: Option<u32>,
        /// Set only when the sender also emits [`StateEnvelope::StateDelta`],
        /// so a receiver can tell whether a later patch applies to what it
        /// holds. Receivers never compute it: the sender is the only authority,
        /// which keeps Rust and TypeScript from having to agree on a hash.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fingerprint: Option<String>,
    },
    /// Patch turning the receiver's previous state into the current one, as
    /// produced by [`crate::state_delta::diff`]. `base` is the fingerprint of
    /// the state it applies to; a receiver holding a different one must ask for
    /// a full [`StateEnvelope::State`] rather than apply the patch.
    StateDelta {
        #[serde(rename = "forPlayer", default, skip_serializing_if = "Option::is_none")]
        for_player: Option<String>,
        base: String,
        fingerprint: String,
        patch: Value,
        #[serde(rename = "engineMs", default, skip_serializing_if = "Option::is_none")]
        engine_ms: Option<u32>,
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
        #[serde(rename = "engineMs", default, skip_serializing_if = "Option::is_none")]
        engine_ms: Option<u32>,
    },
    /// Player answers a prompt. `action` is `PlayerAction` for Rust; raw value
    Response {
        #[serde(rename = "fromPlayer")]
        from_player: String,
        #[serde(rename = "promptId", default)]
        prompt_id: u32,
        action: Value,
    },
    Directive {
        #[serde(rename = "fromPlayer")]
        from_player: String,
        directive: Value,
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
    Fatal {
        message: String,
    },
    /// Engine rejects a response (stale prompt, wrong player, unknown action).
    /// `error` is `ProtocolError`; recoverable unless the session is terminated.
    Error {
        #[serde(rename = "forPlayer")]
        for_player: String,
        error: Value,
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
        Self::for_agent_message_timed(for_player, message, None)
    }

    /// As [`Self::for_agent_message`], carrying how long the engine host took
    /// to produce this message.
    pub fn for_agent_message_timed(
        for_player: String,
        message: &crate::prompt::AgentMessage,
        engine_ms: Option<u32>,
    ) -> Self {
        use crate::prompt::AgentMessage;
        match message {
            AgentMessage::State(state) => StateEnvelope::State {
                for_player: Some(for_player),
                state: serde_json::to_value(state).unwrap_or(Value::Null),
                fingerprint: None,
                engine_ms,
            },
            AgentMessage::Display(event) => StateEnvelope::Display {
                event: serde_json::to_value(event).unwrap_or(Value::Null),
            },
            AgentMessage::Prompt(prompt) => StateEnvelope::Prompt {
                for_player,
                prompt: serde_json::to_value(prompt).unwrap_or(Value::Null),
                engine_ms,
            },
            AgentMessage::Error(error) => StateEnvelope::Error {
                for_player,
                error: serde_json::to_value(error).unwrap_or(Value::Null),
            },
        }
    }
}
