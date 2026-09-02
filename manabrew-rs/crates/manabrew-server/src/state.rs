use dashmap::DashMap;
use std::time::Instant;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

use crate::analytics::AnalyticsHandle;
use crate::client_build::ClientBuild;
use crate::deck_play_events::DeckPlayEventHandle;
use crate::identity::{IdentityVerifier, SessionIdentity};
use crate::protocol::identity_token::GUEST_SUBJECT_PREFIX;
use crate::protocol::LocalGameKind;
use crate::room::Room;

pub struct ConnectedPlayer {
    pub player_id: String,
    pub username: String,
    pub room_id: Option<String>,
    pub sender: mpsc::UnboundedSender<Message>,
    /// Most recent heartbeat round trip for this connection. The aggregate
    /// histogram cannot answer whether one slow decision sat behind one bad
    /// link, because it drops the association at the moment it records.
    pub last_client_rtt_ms: Option<u32>,
    pub connected: bool,
    pub generation: u64,
    pub last_seen: Instant,
    pub disconnected_at: Option<Instant>,
    pub is_service: bool,
    pub identity: Vec<SessionIdentity>,
    pub name_verified: bool,
    pub qualification: Option<String>,
    pub avatar_url: Option<String>,
    /// What the client reported at authentication. Read when deciding which
    /// wire features this seat can be sent.
    pub client: ClientBuild,
    /// Playing on their own machine, reported by the client. Only meaningful
    /// while `connected`: a dropped socket stops asserting anything.
    pub local_game: Option<LocalGameKind>,
}

impl ConnectedPlayer {
    pub fn verified(&self) -> bool {
        self.name_verified
            && self.identity.iter().any(|identity| {
                matches!(identity, SessionIdentity::Account(sub) if !sub.starts_with(GUEST_SUBJECT_PREFIX))
            })
    }
}

pub struct UsernameSession {
    pub player_id: String,
    pub room_id: Option<String>,
    pub generation: u64,
    pub connected: bool,
    pub sender_closed: bool,
    pub identity: Vec<SessionIdentity>,
    pub name_verified: bool,
}

impl From<&ConnectedPlayer> for UsernameSession {
    fn from(player: &ConnectedPlayer) -> Self {
        UsernameSession {
            player_id: player.player_id.clone(),
            room_id: player.room_id.clone(),
            generation: player.generation,
            connected: player.connected,
            sender_closed: player.sender.is_closed(),
            identity: player.identity.clone(),
            name_verified: player.name_verified,
        }
    }
}

pub struct ServerState {
    pub players: DashMap<String, ConnectedPlayer>,
    pub rooms: DashMap<String, Room>,
    pub server_key: String,
    pub max_rooms: usize,
    pub official_key: Option<String>,
    pub analytics: AnalyticsHandle,
    pub deck_play_events: DeckPlayEventHandle,
    pub identity: IdentityVerifier,
    /// See `ServerConfig::direct_transport`. Fails closed.
    pub direct_transport: bool,
    pub iroh_relay_url: Option<String>,
    /// Handed to the browser plane in every roster. See
    /// `ServerConfig::ice_servers`.
    pub ice_servers: Vec<crate::protocol::IceServer>,
}

impl ServerState {
    pub fn new(
        server_key: String,
        max_rooms: usize,
        official_key: Option<String>,
        analytics: AnalyticsHandle,
        deck_play_events: DeckPlayEventHandle,
        hub_jwks_url: Option<String>,
    ) -> Self {
        ServerState {
            players: DashMap::new(),
            rooms: DashMap::new(),
            server_key,
            max_rooms,
            official_key,
            analytics,
            deck_play_events,
            identity: IdentityVerifier::new(hub_jwks_url),
            direct_transport: false,
            iroh_relay_url: None,
            ice_servers: Vec::new(),
        }
    }

    pub fn with_direct_transport(
        mut self,
        enabled: bool,
        relay_url: Option<String>,
        ice_servers: Vec<crate::protocol::IceServer>,
    ) -> Self {
        self.direct_transport = enabled;
        self.iroh_relay_url = relay_url;
        self.ice_servers = ice_servers;
        self
    }

    pub fn session_by_username(&self, username: &str) -> Option<UsernameSession> {
        let mut connected = None;
        for entry in self.players.iter() {
            let player = entry.value();
            if player.username != username {
                continue;
            }
            if !player.connected {
                return Some(UsernameSession::from(player));
            }
            connected.get_or_insert_with(|| UsernameSession::from(player));
        }
        connected
    }
}
