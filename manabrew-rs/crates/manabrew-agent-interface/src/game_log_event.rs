use manabrew_engine::agent::{GameLogEvent, GameLogKind};
use manabrew_engine::ids::{CardId, PlayerId};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// Structured log entry sent from the engine thread to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameLogEntryDto {
    pub entry_type: GameLogEntryTypeDto,
    pub message: String,
    pub timestamp_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub card_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_card_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_card_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GameLogEntryTypeDto {
    Info,
    Action,
    Stack,
    Priority,
    Rule,
    Warning,
}

impl GameLogEntryDto {
    pub fn from_message(message: &str) -> Self {
        Self {
            entry_type: GameLogEntryTypeDto::Info,
            message: message.to_string(),
            timestamp_ms: now_timestamp_ms(),
            player_id: None,
            card_id: None,
            source_card_id: None,
            target_card_id: None,
        }
    }

    pub fn from_event(event: GameLogEvent) -> Self {
        Self {
            entry_type: map_kind(event.kind),
            message: event.message,
            timestamp_ms: now_timestamp_ms(),
            player_id: event.player.map(player_id_str),
            card_id: event
                .card
                .or(event.source_card)
                .or(event.target_card)
                .map(card_id_str),
            source_card_id: event.source_card.map(card_id_str),
            target_card_id: event.target_card.map(card_id_str),
        }
    }
}

fn now_timestamp_ms() -> u64 {
    #[cfg(not(target_arch = "wasm32"))]
    {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }
    #[cfg(target_arch = "wasm32")]
    {
        0 // Timestamps are display-only; WASM doesn't need real time here
    }
}

fn map_kind(kind: GameLogKind) -> GameLogEntryTypeDto {
    match kind {
        GameLogKind::Info => GameLogEntryTypeDto::Info,
        GameLogKind::Action => GameLogEntryTypeDto::Action,
        GameLogKind::Stack => GameLogEntryTypeDto::Stack,
        GameLogKind::Priority => GameLogEntryTypeDto::Priority,
        GameLogKind::Rule => GameLogEntryTypeDto::Rule,
        GameLogKind::Warning => GameLogEntryTypeDto::Warning,
    }
}

fn player_id_str(id: PlayerId) -> String {
    format!("player-{}", id.0)
}

fn card_id_str(id: CardId) -> String {
    format!("card-{}", id.0)
}
