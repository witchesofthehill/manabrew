use serde::Serialize;
use serde_json::Value;

use crate::protocol::{EngineKind, GameFormat};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GameEndReason {
    GameOver,
    EngineFatal,
    HostEnded,
    ReconnectTimeout,
    HostLost,
    StaleExpired,
    Abandoned,
}

impl GameEndReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::GameOver => "game_over",
            Self::EngineFatal => "engine_fatal",
            Self::HostEnded => "host_ended",
            Self::ReconnectTimeout => "reconnect_timeout",
            Self::HostLost => "host_lost",
            Self::StaleExpired => "stale_expired",
            Self::Abandoned => "abandoned",
        }
    }
}

#[derive(Debug, Serialize)]
pub struct SeatInfo {
    pub username: String,
    pub is_bot: bool,
    pub deck_name: Option<String>,
    pub commander: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CardEntry {
    pub name: String,
    pub set_code: String,
    pub count: u32,
}

#[derive(Debug, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum AnalyticsEvent {
    GameStarted {
        ts: String,
        game_id: String,
        room_id: String,
        format: GameFormat,
        engine: EngineKind,
        hosted: bool,
        official: bool,
        starting_life: i32,
        players: Vec<SeatInfo>,
    },
    GameEnded {
        ts: String,
        game_id: String,
        room_id: String,
        reason: GameEndReason,
        duration_s: f64,
        game_over: bool,
        winner: Option<String>,
        conceded: Vec<String>,
        fatal_message: Option<String>,
    },
    DeckSelected {
        ts: String,
        room_id: String,
        username: String,
        is_bot: bool,
        deck_name: String,
        commander: Option<String>,
        cards: Vec<CardEntry>,
        sideboard_count: usize,
    },
    SeatJoined {
        ts: String,
        room_id: String,
        username: String,
        is_bot: bool,
        observer: bool,
    },
    SeatLeft {
        ts: String,
        room_id: String,
        username: String,
    },
}

#[derive(Serialize)]
pub struct CaptureLine<'a> {
    pub ts: String,
    pub from: &'a str,
    pub envelope: &'a Value,
}
