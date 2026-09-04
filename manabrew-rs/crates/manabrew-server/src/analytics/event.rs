use serde::Serialize;
use serde_json::Value;

use crate::protocol::{EngineKind, GameFormat, SeatTransportReport};

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
    pub published_deck_id: Option<String>,
    pub deck_fingerprint: Option<String>,
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
    ClientConnected {
        ts: String,
        username: String,
        platform: String,
        /// The client's reported app version. `None` means a build from before
        /// clients reported one, which is the only handle we have on how much
        /// of the player base is running a stale install.
        #[serde(skip_serializing_if = "Option::is_none")]
        version: Option<String>,
        reconnected: bool,
    },
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
    /// Which seats left the relay's data plane for this game. Emitted from the
    /// host's own report: the relay cannot observe traffic it does not carry.
    TransportUsed {
        ts: String,
        room_id: String,
        game_id: String,
        host: String,
        seats: Vec<SeatTransportReport>,
    },
    /// One end's account of one attempt to reach a peer off the relay, kept
    /// whether or not it worked.
    ///
    /// [`AnalyticsEvent::TransportUsed`] is the host's list of seats that
    /// succeeded. This is the other half: the attempts, including the ones
    /// that failed and left the seat on the relay saying nothing. A connect
    /// rate needs both.
    PlaneQuality {
        ts: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        room_id: Option<String>,
        /// The reporter, named from the relay's own record of the session.
        username: String,
        /// The other end, as the reporter named it.
        peer: String,
        plane: String,
        outcome: String,
        /// `settled` or `measured`; a connected peer reports both.
        phase: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        connect_ms: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        rtt_ms: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        relay_rtt_ms: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        candidate_pair: Option<String>,
    },
    EngineStats {
        ts: String,
        /// The room the seat was in when the report landed, which at game over
        /// is often none: the report outlives the seat's membership. Nothing
        /// downstream reads it, so it stays a breadcrumb rather than a key.
        #[serde(skip_serializing_if = "Option::is_none")]
        room_id: Option<String>,
        username: String,
        report_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        game_id: Option<String>,
        engine: String,
        client_version: String,
        platform: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        format: Option<String>,
        seats: u32,
        multiplayer: bool,
        duration_s: u32,
        end_reason: String,
        decisions: u32,
        turnaround_p50: u32,
        turnaround_p90: u32,
        turnaround_max: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        engine_p50: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        engine_p90: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        engine_max: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        engine_same_p50: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        engine_same_p90: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        engine_same_max: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        engine_cross_p50: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        engine_cross_p90: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        engine_cross_max: Option<u32>,
        think_hidden: u32,
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
    /// Set only on envelopes a player sent, where `from` is that player and the
    /// figure is theirs. Lets a decision be read against the link it crossed
    /// rather than against a fleet-wide average.
    #[serde(rename = "clientRttMs", skip_serializing_if = "Option::is_none")]
    pub client_rtt_ms: Option<u32>,
}
