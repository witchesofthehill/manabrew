use dashmap::DashMap;
use std::time::Instant;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

use crate::analytics::AnalyticsHandle;
use crate::deck_play_events::DeckPlayEventHandle;
use crate::identity::{IdentityVerifier, SessionIdentity};
use crate::room::Room;

pub struct ConnectedPlayer {
    pub player_id: String,
    pub username: String,
    pub room_id: Option<String>,
    pub sender: mpsc::UnboundedSender<Message>,
    pub connected: bool,
    pub generation: u64,
    pub last_seen: Instant,
    pub disconnected_at: Option<Instant>,
    pub is_service: bool,
    pub identity: Vec<SessionIdentity>,
}

pub struct UsernameSession {
    pub player_id: String,
    pub room_id: Option<String>,
    pub generation: u64,
    pub connected: bool,
    pub sender_closed: bool,
    pub identity: Vec<SessionIdentity>,
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
        }
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
