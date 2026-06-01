pub use crate::deck_dto::Deck;
use crate::game_log_event::GameLogEntryDto;
use crate::game_snapshot_event::GameSnapshotEventDto;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Typed envelope carried inside `ClientMessage::BroadcastState.state` /
/// `ServerMessage::StateUpdate.state`. One discriminator (`kind`) plus the
/// payload for that variant. Constructed and parsed in every layer that
/// touches the relay (engine, bot, host, web/Tauri UI) — anything that needs
/// to handcraft `json!({"kind": "..."})` belongs here instead.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StateEnvelope {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerDeckInfo {
    pub username: String,
    pub deck_name: String,
    pub deck: Deck,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commander_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    Authenticate {
        username: String,
        password: String,
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
    },

    JoinRoom {
        room_id: String,
        #[serde(default)]
        observe: bool,
    },

    LeaveRoom,

    SetReady {
        ready: bool,
    },

    SetDeckSelection {
        deck_name: String,
        deck: Deck,
        commander_name: Option<String>,
    },

    SetFormat {
        format: GameFormat,
    },

    StartGame {
        #[serde(default)]
        format: Option<GameFormat>,
    },

    EndGame,

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
    pub players: Vec<RoomPlayerInfo>,
    pub max_players: u8,
    pub format: GameFormat,
    pub status: RoomStatus,
    #[serde(default)]
    pub engine: EngineKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft_config: Option<DraftConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sealed_config: Option<SealedConfig>,
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
    Wasm,
    Java,
}
