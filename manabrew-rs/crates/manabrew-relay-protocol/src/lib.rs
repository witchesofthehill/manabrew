//! Relay wire protocol: the session handshake, lobby management and game
//! transport envelopes exchanged between clients and `manabrew-server`.
//! Engine and UI DTOs live in `manabrew-protocol`.
pub mod identity_token;
pub mod state_delta;

pub use manabrew_protocol::deck_dto::Deck;
pub use manabrew_protocol::game::{EngineKind, GameFormat};
pub use manabrew_protocol::telemetry::EnginePlayStats;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

// The wire-compat number IS the crate major: a breaking wire change must ship
// as a breaking (major) release of this crate, never as a separate constant.
pub const PROTOCOL_VERSION: u32 = major_of(env!("CARGO_PKG_VERSION_MAJOR"));

const fn major_of(major: &str) -> u32 {
    let bytes = major.as_bytes();
    let mut value = 0u32;
    let mut i = 0;
    while i < bytes.len() {
        value = value * 10 + (bytes[i] - b'0') as u32;
        i += 1;
    }
    value
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "lobby/index.ts")]
pub struct PlayerDeckInfo {
    pub username: String,
    pub deck_name: String,
    pub deck: Deck,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub published_deck_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub commander_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct IdentityProof {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "lobby/index.ts")]
pub enum ClientPlatform {
    Web,
    Pwa,
    Desktop,
    Mobile,
    #[default]
    Unknown,
}

impl ClientPlatform {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Web => "web",
            Self::Pwa => "pwa",
            Self::Desktop => "desktop",
            Self::Mobile => "mobile",
            Self::Unknown => "unknown",
        }
    }
}

/// A peer's addressing information for the direct data plane. Deliberately
/// stringly typed: this crate must not depend on iroh, so the same messages
/// carry a future non-iroh transport unchanged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransportEndpoint {
    pub endpoint_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relay_url: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub direct_addrs: Vec<String>,
}

/// How one seat's game traffic travelled, reported by the room's engine host.
/// The relay's capture and replay cache only ever see what still goes through
/// the relay, so without this a capture file is silently incomplete.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SeatTransportReport {
    pub username: String,
    /// One of [`TRANSPORT_RELAY`], [`TRANSPORT_IROH_DIRECT`] or
    /// [`TRANSPORT_IROH_RELAYED`].
    pub transport: String,
}

/// The relay carried it, which is the only case it can observe for itself.
pub const TRANSPORT_RELAY: &str = "relay";
pub const TRANSPORT_IROH_DIRECT: &str = "iroh-direct";
pub const TRANSPORT_IROH_RELAYED: &str = "iroh-relayed";

/// One room member's endpoint, as attested by the relay. `username` is the
/// relay's own view of the announcing session, never a client-supplied field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransportMember {
    pub username: String,
    pub endpoint: TransportEndpoint,
    #[serde(default)]
    pub host: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
#[allow(clippy::large_enum_variant)]
pub enum ClientMessage {
    Authenticate {
        /// Legacy name field, read only when `identity` carries no token.
        /// The session name is the `handle` claim of `identity.token`
        /// ([`identity_token`]); remove this field in the next major.
        #[serde(default)]
        username: String,
        password: String,
        #[serde(default)]
        service: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        identity: Option<IdentityProof>,
        #[serde(default)]
        client_platform: ClientPlatform,
        /// The client's app version (`APP_VERSION`), when it sends one. Absent
        /// means a build older than the one that started reporting it, which is
        /// how the relay decides what wire features that seat can handle.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        client_version: Option<String>,
    },

    Ping,

    ListRooms,

    ListPlayers,

    /// The session entered or left a game running on its own machine. `None`
    /// clears it. Such a game opens no room and sends no state, so the relay
    /// has no other way to know it is happening.
    SetLocalGame {
        #[serde(default)]
        kind: Option<LocalGameKind>,
    },

    CreateRoom {
        room_name: String,
        max_players: u8,
        format: GameFormat,
        #[serde(default)]
        protocol_version: u32,
        #[serde(default)]
        hosted: bool,
        #[serde(default)]
        engine: EngineKind,
        #[serde(default)]
        draft_config: Option<DraftConfig>,
        #[serde(default)]
        sealed_config: Option<SealedConfig>,
        #[serde(default)]
        official_key: Option<String>,
        #[serde(default)]
        password: Option<String>,
        #[serde(default)]
        reconnect_timeout_s: Option<u32>,
    },

    JoinRoom {
        room_id: String,
        #[serde(default)]
        observe: bool,
        #[serde(default)]
        as_bot: bool,
        #[serde(default)]
        password: Option<String>,
    },

    ResumeRoom(ResumeRoomRequest),

    LeaveRoom,

    SetReady {
        ready: bool,
    },

    SetDeckSelection {
        deck_name: String,
        deck: Deck,
        #[serde(default)]
        published_deck_id: Option<String>,
        commander_name: Option<String>,
        #[serde(default)]
        avatar_url: Option<String>,
    },

    SetFormat {
        format: GameFormat,
    },

    SetMaxPlayers {
        max_players: u8,
    },

    StartGame {
        #[serde(default)]
        format: Option<GameFormat>,
    },

    EndGame {
        game_id: String,
    },

    ReportEngineStats {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        game_id: Option<String>,
        stats: EnginePlayStats,
    },

    RequestResync,

    BroadcastState {
        state: serde_json::Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        /// A null value will broadcast to the whole room
        target_player: Option<String>,
    },

    TurnChange {
        new_active_player: String,
        turn_number: u32,
    },

    /// Publishes (or, with `None`, withdraws) this session's data-plane
    /// endpoint for the room it is in.
    AnnounceTransport {
        #[serde(default)]
        endpoint: Option<TransportEndpoint>,
    },

    /// Tells the relay which transport each seat's traffic will take for this
    /// game, so its capture records what it is about to miss. Analytics only,
    /// like [`ClientMessage::ReportEngineStats`].
    ReportTransport {
        game_id: String,
        seats: Vec<SeatTransportReport>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    Pong,

    AuthResult {
        success: bool,
        player_id: Option<String>,
        reconnected: Option<bool>,
        error: Option<String>,
        /// Wire features this relay understands, so a newer client can stay
        /// quiet instead of sending a message an older one would reject with
        /// a parse error. Absent from relays built before the list existed.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        features: Vec<String>,
    },

    SessionTakenOver,

    RoomList {
        rooms: Vec<RoomInfo>,
    },

    PlayerList {
        players: Vec<PlayerInfo>,
    },

    RoomCreated {
        room_id: String,
        room_name: String,
        room: RoomInfo,
        #[serde(default)]
        resume_token: Option<String>,
    },

    RoomResumed {
        room: RoomInfo,
    },

    PlayerJoined {
        room_id: String,
        username: String,
    },

    PlayerLeft {
        room_id: String,
        username: String,
    },

    PlayerConnected {
        username: String,
    },

    PlayerDisconnected {
        username: String,
    },

    ReadyStateChanged {
        username: String,
        ready: bool,
    },

    RoomUpdate {
        room: RoomInfo,
    },

    GameStarted {
        room_id: String,
        game_id: String,
        player_order: Vec<String>,
        player_decks: Vec<PlayerDeckInfo>,
        starting_life: i32,
    },

    StateUpdate {
        from_player: String,
        state: serde_json::Value,
    },

    TurnChanged {
        from_player: String,
        new_active_player: String,
        turn_number: u32,
    },

    GameAborted {
        room_id: String,
    },

    Error {
        code: String,
        message: String,
    },

    ServerShuttingDown {
        reconnect_in_s: u32,
    },

    /// The room's data-plane roster. Sent only to room members. `topic_secret`
    /// is hex and is what makes the room's gossip topic id underivable from the
    /// room id alone.
    RoomTransport {
        room_id: String,
        topic_secret: String,
        /// The iroh relay this deployment operates. Absent means direct-only:
        /// clients must never fall back to a public relay.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        iroh_relay_url: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        host: Option<TransportMember>,
        members: Vec<TransportMember>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "lobby/index.ts")]
pub struct ResumeRoomRequest {
    pub room_id: String,
    pub resume_token: String,
    pub room_name: String,
    pub max_players: u8,
    pub format: GameFormat,
    #[serde(default)]
    pub hosted: bool,
    #[serde(default)]
    pub engine: EngineKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub official_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reconnect_timeout_s: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub draft_config: Option<DraftConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sealed_config: Option<SealedConfig>,
    pub player_order: Vec<String>,
    pub player_decks: Vec<PlayerDeckInfo>,
    pub starting_life: i32,
    #[serde(default)]
    pub bot_players: Vec<String>,
    pub game_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomInfo {
    pub room_id: String,
    pub room_name: String,
    pub host: String,
    #[serde(default)]
    pub protocol_version: u32,
    #[serde(default)]
    pub hosted: bool,
    #[serde(default)]
    pub official: bool,
    #[serde(default)]
    pub password_protected: bool,
    pub players: Vec<RoomPlayerInfo>,
    pub max_players: u8,
    pub format: GameFormat,
    pub status: RoomStatus,
    #[serde(default)]
    pub engine: EngineKind,
    #[serde(default = "default_reconnect_timeout_s")]
    pub reconnect_timeout_s: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft_config: Option<DraftConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sealed_config: Option<SealedConfig>,
}

pub const DEFAULT_RECONNECT_TIMEOUT_S: u32 = 60;

fn default_reconnect_timeout_s() -> u32 {
    DEFAULT_RECONNECT_TIMEOUT_S
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export, export_to = "lobby/index.ts")]
pub struct SealedConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub set_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cube_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cube_name: Option<String>,
    #[serde(default)]
    pub singleton: bool,
    pub num_boosters: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub base_seed: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export, export_to = "lobby/index.ts")]
pub struct DraftConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub set_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cube_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cube_name: Option<String>,
    pub rounds: u8,
    pub picks_per_pass: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub seed: Option<u64>,
    pub fill_with_bots: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomPlayerInfo {
    pub username: String,
    pub ready: bool,
    pub connected: bool,
    #[serde(default)]
    pub is_bot: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_deck_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerInfo {
    pub username: String,
    pub player_id: String,
    pub connected: bool,
    #[serde(default)]
    pub verified: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub qualification: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub room_id: Option<String>,
    /// In a game on their own machine rather than in a relay room. Never set
    /// at the same time as `room_id`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_game: Option<LocalGameKind>,
}

/// Names [`ClientMessage::SetLocalGame`] in `AuthResult::features`.
pub const FEATURE_LOCAL_GAME: &str = "local_game";

/// Names [`ClientMessage::AnnounceTransport`] and [`ServerMessage::RoomTransport`]
/// in `AuthResult::features`. A relay without it never sends a roster, so a
/// client must stay on the relay data plane.
pub const FEATURE_ROOM_TRANSPORT: &str = "room_transport";

pub const FEATURES: &[&str] = &[FEATURE_LOCAL_GAME, FEATURE_ROOM_TRANSPORT];

/// A game running on the player's own machine, which the relay never sees.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LocalGameKind {
    /// Play vs AI.
    Singleplayer,
}

impl LocalGameKind {
    /// So the exporter can publish a zero for an unplayed kind rather than
    /// leaving its series stale at the last value it had.
    pub const ALL: &'static [Self] = &[Self::Singleplayer];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Singleplayer => "singleplayer",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RoomStatus {
    Lobby,
    InGame,
}
