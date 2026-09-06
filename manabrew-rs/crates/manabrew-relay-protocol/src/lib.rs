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
    /// Which data planes this peer speaks, most preferred first. A seat picks
    /// the room's plane from what the HOST advertises here, never from its own
    /// platform: a desktop seat in a browser-hosted room has to choose WebRTC
    /// rather than reach for its native endpoint and find nothing.
    ///
    /// Empty means [`TRANSPORT_KIND_IROH`], which is what every announcer
    /// before this field meant.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub kinds: Vec<String>,
}

impl TransportEndpoint {
    /// Whether this peer speaks a plane, with the pre-`kinds` default applied.
    pub fn speaks(&self, kind: &str) -> bool {
        if self.kinds.is_empty() {
            return kind == TRANSPORT_KIND_IROH;
        }
        self.kinds.iter().any(|k| k == kind)
    }
}

/// An ICE server for the browser data plane, shaped like the `RTCIceServer`
/// dictionary so it passes to `RTCPeerConnection` unchanged.
///
/// The relay hands these out for the same reason it hands out
/// `iroh_relay_url`: no client hardcodes one, and a self-hosted deployment
/// answers the question by configuring its relay rather than by shipping new
/// clients.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IceServer {
    pub urls: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential: Option<String>,
}

/// How one seat's game traffic travelled, reported by the room's engine host.
/// The relay's capture and replay cache only ever see what still goes through
/// the relay, so without this a capture file is silently incomplete.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SeatTransportReport {
    pub username: String,
    /// [`TRANSPORT_IROH_DIRECT`], [`TRANSPORT_IROH_RELAYED`] or
    /// [`TRANSPORT_WEBRTC`].
    pub transport: String,
}

/// One end's account of one attempt to reach a peer off the relay.
///
/// Every field past `peer` and `outcome` is the reporter's own measurement, so
/// the relay treats all of it as a claim: it bounds the numbers, caps the
/// strings, and records who said it rather than trusting what was said.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlaneQualityReport {
    /// The other end, as the relay attested that username to this session.
    pub peer: String,
    /// [`PLANE_OUTCOME_CONNECTED`], [`PLANE_OUTCOME_FAILED`] or
    /// [`PLANE_OUTCOME_TIMEOUT`]. Anything else is dropped.
    pub outcome: String,
    /// Which plane was attempted: [`TRANSPORT_WEBRTC`] or
    /// [`TRANSPORT_IROH_DIRECT`].
    pub plane: String,
    /// [`PLANE_PHASE_SETTLED`] once per attempt, when it reaches its outcome,
    /// or [`PLANE_PHASE_MEASURED`] for the later report that carries the round
    /// trip. Only the first is counted as an attempt: a connected peer reports
    /// twice and a failed one once, so counting both would inflate the connect
    /// rate this exists to measure.
    pub phase: String,
    /// First offer to open channel.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connect_ms: Option<u32>,
    /// Median round trip measured on the channel itself.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rtt_ms: Option<u32>,
    /// The same session's round trip to the relay, sampled by the reporter at
    /// the same time. Paired deliberately: an unpaired direct RTT cannot say
    /// whether it beat the path it replaced.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relay_rtt_ms: Option<u32>,
    /// The ICE pair that won, `local/remote`, or what was on offer when none
    /// did. `host/host` never left the LAN and proves no traversal.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_pair: Option<String>,
}

pub const PLANE_PHASE_SETTLED: &str = "settled";
pub const PLANE_PHASE_MEASURED: &str = "measured";

pub const PLANE_OUTCOME_CONNECTED: &str = "connected";
pub const PLANE_OUTCOME_FAILED: &str = "failed";
pub const PLANE_OUTCOME_TIMEOUT: &str = "timeout";

/// Outcomes the relay will record. An unknown one is dropped rather than
/// recorded, so a client cannot invent labels into the metric's cardinality.
pub const PLANE_OUTCOMES: &[&str] = &[
    PLANE_OUTCOME_CONNECTED,
    PLANE_OUTCOME_FAILED,
    PLANE_OUTCOME_TIMEOUT,
];

/// Longest `candidate_pair` the relay will record. Real values are like
/// `srflx/srflx`; this is room for that and not for a label attack.
pub const MAX_CANDIDATE_PAIR_BYTES: usize = 64;

/// Anything past this is a broken clock or a lie, and is dropped rather than
/// skewing an average. Ten minutes.
pub const MAX_PLANE_MS: u32 = 600_000;

pub const TRANSPORT_IROH_DIRECT: &str = "iroh-direct";
pub const TRANSPORT_IROH_RELAYED: &str = "iroh-relayed";
/// A browser pair on an `RTCDataChannel`. There is no TURN server, so a WebRTC
/// seat is direct or it is on the relay; there is no relayed variant.
pub const TRANSPORT_WEBRTC: &str = "webrtc";

/// Names for [`TransportEndpoint::kinds`].
pub const TRANSPORT_KIND_IROH: &str = "iroh";
pub const TRANSPORT_KIND_WEBRTC: &str = "webrtc";

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
    /// Tells the relay which transport each seat's traffic took for this game,
    /// so its capture records what it is about to miss. Analytics only, like
    /// [`ClientMessage::ReportEngineStats`].
    ReportTransport {
        game_id: String,
        seats: Vec<SeatTransportReport>,
    },

    /// Publishes (or, with `None`, withdraws) this session's data-plane
    /// endpoint for the room it is in.
    AnnounceTransport {
        #[serde(default)]
        endpoint: Option<TransportEndpoint>,
    },

    /// Carries one peer's opaque signalling blob to another member of the same
    /// room, named by username. WebRTC needs an offer, an answer and ICE
    /// candidates to cross before any channel exists, and the relay is the
    /// only path both ends already have.
    ///
    /// The relay does not read `payload`. It routes on `to`, stamps the sender
    /// from its own record of the session, and forwards
    /// [`ServerMessage::PeerSignal`]. Addressing by username, not by peer
    /// type, is what lets a desktop seat use this path too.
    SignalPeer {
        to: String,
        payload: serde_json::Value,
    },

    /// Reports how one direct-plane attempt turned out, whether or not it
    /// worked. Analytics only, like [`ClientMessage::ReportTransport`].
    ///
    /// [`ClientMessage::ReportTransport`] cannot answer this. It is sent by the
    /// host at game start and names only the seats that succeeded, so the
    /// attempts that failed reach nobody: a seat that cannot punch through
    /// stays on the relay and says nothing about having tried. Without the
    /// failures there is no denominator, and a connect rate is exactly the
    /// number that decides whether production gets ICE servers.
    ///
    /// The measuring end sends this, which is the seat, not the host. The relay
    /// stamps the sender from its own record and does not read the numbers
    /// beyond bounding them.
    ReportPlaneQuality {
        report: PlaneQualityReport,
    },

    SendChat {
        scope: ChatScope,
        text: String,
    },

    InviteToRoom {
        username: String,
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
        /// Where this relay serves card art, when it serves any. A self-hosted
        /// box holding the images is the reason to run one, and the client
        /// cannot guess the port. Absent means fall back to the CDN.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        art_base_url: Option<String>,
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
    /// The room's data-plane roster. Sent only to room members. Absent
    /// `iroh_relay_url` means the peers take iroh's own relay defaults.
    RoomTransport {
        room_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        iroh_relay_url: Option<String>,
        /// STUN, and TURN where one is configured, for the WebRTC plane.
        ///
        /// Empty is not a neutral default. Without a STUN server a browser
        /// gathers only host candidates, which Chromium then replaces with
        /// mDNS names, so the plane can reach a peer on the same network at
        /// best and usually not even that. A seat on the same network already
        /// has one local hop through the embedded relay, so an empty list
        /// leaves the browser plane with no case it wins.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        ice_servers: Vec<IceServer>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        host: Option<TransportMember>,
        members: Vec<TransportMember>,
    },

    /// A signalling blob from another member of the room. `from` is the
    /// relay's own view of the sending session, never a client-supplied
    /// field, which is the same attestation `RoomTransport` gives the roster.
    PeerSignal {
        from: String,
        payload: serde_json::Value,
    },

    ChatMessage(ChatMessage),

    ChatHistory {
        scope: ChatScope,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        room_id: Option<String>,
        messages: Vec<ChatMessage>,
    },

    RoomInvite {
        from: String,
        room: RoomInfo,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        password: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChatScope {
    Lobby,
    Room,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub scope: ChatScope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub room_id: Option<String>,
    pub from: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub qualification: Option<String>,
    pub text: String,
    pub sent_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seal: Option<String>,
}

pub const CHAT_MESSAGE_MAX_CHARS: usize = 500;
pub const CHAT_HISTORY_MAX_MESSAGES: usize = 100;
pub const CHAT_HISTORY_MAX_AGE_MS: u64 = 24 * 60 * 60 * 1000;
pub const CHAT_MIN_INTERVAL_MS: u64 = 400;

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
    /// Opaque to clients: the session's IP sealed together with its handle,
    /// which only the hub can open. Carried verbatim into chat reports.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seal: Option<String>,
}

/// Names [`ClientMessage::SetLocalGame`] in `AuthResult::features`.
pub const FEATURE_LOCAL_GAME: &str = "local_game";
/// Names [`ClientMessage::SendChat`] in `AuthResult::features`.
pub const FEATURE_CHAT: &str = "chat";
/// Names [`ClientMessage::InviteToRoom`] in `AuthResult::features`.
pub const FEATURE_ROOM_INVITES: &str = "room_invites";

/// Names [`ClientMessage::AnnounceTransport`] and [`ServerMessage::RoomTransport`]
/// in `AuthResult::features`. A relay without it never sends a roster, so a
/// client stays on the relay data plane.
pub const FEATURE_ROOM_TRANSPORT: &str = "room_transport";

/// Names [`ClientMessage::SignalPeer`] and [`ServerMessage::PeerSignal`] in
/// `AuthResult::features`. A relay without it drops signalling, so a client
/// never starts a negotiation that cannot finish.
pub const FEATURE_PEER_SIGNAL: &str = "peer_signal";

/// The relay accepts [`ClientMessage::ReportPlaneQuality`]. A client that
/// does not see this stays quiet rather than sending a message an older
/// relay would reject as a parse error.
pub const FEATURE_PLANE_QUALITY: &str = "plane_quality";

pub const FEATURES: &[&str] = &[
    FEATURE_LOCAL_GAME,
    FEATURE_ROOM_TRANSPORT,
    FEATURE_PEER_SIGNAL,
    FEATURE_PLANE_QUALITY,
    FEATURE_CHAT,
    FEATURE_ROOM_INVITES,
];

/// The largest signalling blob the relay will forward. An SDP offer with a
/// full candidate list is a few kB; this is room for that and no room for
/// using the control plane as a data plane.
pub const MAX_SIGNAL_BYTES: usize = 16 * 1024;

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
