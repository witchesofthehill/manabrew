pub use crate::deck_dto::Deck;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerDeckInfo {
    pub username: String,
    pub deck_name: String,
    pub deck: Deck,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commander_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    Authenticate {
        username: String,
        password: String,
        #[serde(default)]
        service: bool,
    },

    Ping,

    ListRooms,

    ListPlayers,

    CreateRoom {
        room_name: String,
        max_players: u8,
        format: GameFormat,
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

    LeaveRoom,

    SetReady {
        ready: bool,
    },

    SetDeckSelection {
        deck_name: String,
        deck: Deck,
        commander_name: Option<String>,
        #[serde(default)]
        avatar: Option<String>,
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

    EndGame,

    RequestResync,

    BroadcastState {
        state: serde_json::Value,
    },

    TurnChange {
        new_active_player: String,
        turn_number: u32,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    AuthResult {
        success: bool,
        player_id: Option<String>,
        reconnected: Option<bool>,
        error: Option<String>,
    },

    RoomList {
        rooms: Vec<RoomInfo>,
    },

    PlayerList {
        players: Vec<PlayerInfo>,
    },

    RoomCreated {
        room_id: String,
        room_name: String,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomInfo {
    pub room_id: String,
    pub room_name: String,
    pub host: String,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SealedConfig {
    pub set_code: String,
    pub num_boosters: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_seed: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DraftConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub set_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cube_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cube_name: Option<String>,
    pub rounds: u8,
    pub picks_per_pass: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub room_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RoomStatus {
    Lobby,
    InGame,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum GameFormat {
    Any,
    Standard,
    Pioneer,
    Modern,
    Legacy,
    Vintage,
    Pauper,
    Commander,
    Brawl,
    Oathbreaker,
    Draft,
    Sealed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum EngineKind {
    #[default]
    Manabrew,
    Forge,
}
