pub use crate::deck_dto::Deck;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const PROTOCOL_VERSION: u32 = 2;

#[cfg(test)]
const PROTOCOL_SCHEMA_FINGERPRINT: &str = "b8f0eb5cf679220a";

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "lobby/index.ts")]
pub struct PlayerDeckInfo {
    pub username: String,
    pub deck_name: String,
    pub deck: Deck,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub commander_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub avatar: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
#[allow(clippy::large_enum_variant)]
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

    EndGame {
        game_id: String,
    },

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
    pub set_code: String,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub room_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RoomStatus {
    Lobby,
    InGame,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export, export_to = "lobby/index.ts")]
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default, TS)]
#[ts(export, export_to = "lobby/index.ts")]
pub enum EngineKind {
    #[default]
    Manabrew,
    Forge,
    Ironsmith,
}

#[cfg(test)]
mod schema_fingerprint {
    use super::PROTOCOL_SCHEMA_FINGERPRINT;
    use crate::deck_dto::Deck;
    use crate::display::DisplayEvent;
    use crate::prompts::{PromptInput, PromptOutput};
    use crate::protocol::ResumeRoomRequest;
    use crate::transport::{AgentPrompt, ClientToServerMessage, DirectiveInput, StateUpdate};
    use std::path::{Path, PathBuf};
    use ts_rs::TS;

    fn collect_ts(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_ts(&path, out);
            } else if path.extension().is_some_and(|e| e == "ts") {
                out.push(path);
            }
        }
    }

    fn fnv1a(bytes: &[u8]) -> u64 {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for &byte in bytes {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        hash
    }

    fn rendered_schema() -> String {
        let dir = std::env::temp_dir().join(format!(
            "manabrew-protocol-fingerprint-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        PromptInput::export_all_to(&dir).unwrap();
        PromptOutput::export_all_to(&dir).unwrap();
        AgentPrompt::export_all_to(&dir).unwrap();
        StateUpdate::export_all_to(&dir).unwrap();
        DirectiveInput::export_all_to(&dir).unwrap();
        ClientToServerMessage::export_all_to(&dir).unwrap();
        DisplayEvent::export_all_to(&dir).unwrap();
        Deck::export_all_to(&dir).unwrap();
        ResumeRoomRequest::export_all_to(&dir).unwrap();

        let mut files = Vec::new();
        collect_ts(&dir, &mut files);
        files.sort();

        let mut schema = String::new();
        for path in &files {
            let rel = path
                .strip_prefix(&dir)
                .unwrap()
                .to_string_lossy()
                .into_owned();
            schema.push_str(&rel);
            schema.push('\n');
            schema.push_str(&std::fs::read_to_string(path).unwrap());
            schema.push('\n');
        }
        let _ = std::fs::remove_dir_all(&dir);
        schema
    }

    #[test]
    fn wire_schema_is_pinned() {
        let actual = format!("{:016x}", fnv1a(rendered_schema().as_bytes()));
        assert_eq!(
            actual, PROTOCOL_SCHEMA_FINGERPRINT,
            "protocol wire schema changed — bump PROTOCOL_VERSION and update PROTOCOL_SCHEMA_FINGERPRINT"
        );
    }
}
