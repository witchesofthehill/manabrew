use dashmap::DashMap;
use std::time::Instant;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

use crate::analytics::AnalyticsHandle;
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
}

pub struct ServerState {
    pub players: DashMap<String, ConnectedPlayer>,
    pub rooms: DashMap<String, Room>,
    pub server_key: String,
    pub max_rooms: usize,
    pub official_key: Option<String>,
    pub analytics: AnalyticsHandle,
}

impl ServerState {
    pub fn new(
        server_key: String,
        max_rooms: usize,
        official_key: Option<String>,
        analytics: AnalyticsHandle,
    ) -> Self {
        ServerState {
            players: DashMap::new(),
            rooms: DashMap::new(),
            server_key,
            max_rooms,
            official_key,
            analytics,
        }
    }

    pub fn username_taken_by_connected(&self, username: &str) -> bool {
        self.players
            .iter()
            .any(|entry| entry.value().username == username && entry.value().connected)
    }

    pub fn find_disconnected_by_username(
        &self,
        username: &str,
    ) -> Option<(String, Option<String>, u64)> {
        self.players
            .iter()
            .find(|entry| entry.value().username == username && !entry.value().connected)
            .map(|entry| {
                (
                    entry.value().player_id.clone(),
                    entry.value().room_id.clone(),
                    entry.value().generation,
                )
            })
    }

    pub fn find_connected_by_username(&self, username: &str) -> Option<(String, u64, bool)> {
        self.players
            .iter()
            .find(|entry| entry.value().username == username && entry.value().connected)
            .map(|entry| {
                (
                    entry.value().player_id.clone(),
                    entry.value().generation,
                    entry.value().sender.is_closed(),
                )
            })
    }
}
