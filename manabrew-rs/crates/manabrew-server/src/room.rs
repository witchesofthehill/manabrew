use std::collections::HashMap;
use std::time::Instant;

use crate::protocol::{
    DraftConfig, EngineKind, GameFormat, PlayerDeckInfo, RoomInfo, RoomPlayerInfo, RoomStatus,
    SealedConfig, TransportEndpoint, TransportMember,
};
use crate::replay::GameReplayCache;
use manabrew_protocol::deck_dto::Deck;

#[derive(Debug, Clone)]
pub struct RoomSlot {
    pub player_id: String,
    pub username: String,
    pub ready: bool,
    pub connected: bool,
    pub is_bot: bool,
    pub selected_deck_name: Option<String>,
    pub selected_deck: Option<Deck>,
    pub published_deck_id: Option<String>,
    pub selected_commander_name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RoomObserver {
    pub player_id: String,
    pub connected: bool,
}

#[derive(Debug)]
pub struct Room {
    pub room_id: String,
    pub room_name: String,
    pub protocol_version: u32,
    pub host_player_id: String,
    pub host_username: String,
    pub hosted: bool,
    pub official: bool,
    pub password: Option<String>,
    pub max_players: u8,
    pub format: GameFormat,
    pub engine: EngineKind,
    pub status: RoomStatus,
    pub players: Vec<RoomSlot>,
    pub observers: Vec<RoomObserver>,
    pub draft_config: Option<DraftConfig>,
    pub sealed_config: Option<SealedConfig>,
    pub reconnect_timeout_s: u32,
    pub replay: Option<GameReplayCache>,
    pub resume_token: String,
    pub humanless_since: Option<Instant>,
    /// Data-plane endpoints announced by members, keyed by player id. The relay
    /// is the only thing that binds one of these to a username.
    pub transports: HashMap<String, TransportEndpoint>,
}

impl Room {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        room_id: String,
        room_name: String,
        protocol_version: u32,
        host_player_id: String,
        host_username: String,
        max_players: u8,
        format: GameFormat,
        engine: EngineKind,
        host_plays: bool,
        draft_config: Option<DraftConfig>,
        sealed_config: Option<SealedConfig>,
        official: bool,
        password: Option<String>,
        reconnect_timeout_s: u32,
    ) -> Self {
        let max_players = max_players.clamp(2, 8);
        let (players, observers) = if host_plays {
            (
                vec![RoomSlot {
                    player_id: host_player_id.clone(),
                    username: host_username.clone(),
                    ready: false,
                    connected: true,
                    is_bot: false,
                    selected_deck_name: None,
                    selected_deck: None,
                    published_deck_id: None,
                    selected_commander_name: None,
                    avatar_url: None,
                }],
                vec![],
            )
        } else {
            (
                vec![],
                vec![RoomObserver {
                    player_id: host_player_id.clone(),
                    connected: true,
                }],
            )
        };
        Room {
            room_id,
            room_name,
            protocol_version,
            host_player_id: host_player_id.clone(),
            host_username,
            hosted: !host_plays,
            official,
            password,
            max_players,
            format,
            engine,
            status: RoomStatus::Lobby,
            players,
            observers,
            draft_config,
            sealed_config,
            reconnect_timeout_s,
            replay: None,
            resume_token: String::new(),
            humanless_since: None,
            transports: HashMap::new(),
        }
    }

    pub fn is_full(&self) -> bool {
        self.players.len() >= self.max_players as usize
    }

    pub fn is_empty(&self) -> bool {
        self.players.is_empty() && self.observers.is_empty()
    }

    pub fn is_limited_session(&self) -> bool {
        matches!(
            self.format,
            GameFormat::Any | GameFormat::Draft | GameFormat::Sealed
        ) && (self.draft_config.is_some() || self.sealed_config.is_some())
    }

    pub fn reset_lobby_settings(&mut self) {
        if self.draft_config.is_none() && self.sealed_config.is_none() {
            self.format = GameFormat::Any;
            self.max_players = 4;
        }
    }

    pub fn all_ready(&self) -> bool {
        let min_players = if self.is_limited_session() { 1 } else { 2 };
        let controller_id = self.controller_id();
        self.players.len() >= min_players
            && self
                .players
                .iter()
                .filter(|p| Some(p.player_id.as_str()) != controller_id)
                .all(|p| p.ready)
    }

    pub fn add_player(
        &mut self,
        player_id: String,
        username: String,
        is_bot: bool,
    ) -> Result<(), String> {
        if self.is_full() {
            return Err("Room is full".into());
        }
        if self.status != RoomStatus::Lobby {
            return Err("Game already started".into());
        }
        if self.players.iter().any(|p| p.player_id == player_id) {
            return Err("Already in this room".into());
        }
        self.players.push(RoomSlot {
            player_id,
            username,
            ready: false,
            connected: true,
            is_bot,
            selected_deck_name: None,
            selected_deck: None,
            published_deck_id: None,
            selected_commander_name: None,
            avatar_url: None,
        });
        Ok(())
    }

    pub fn add_observer(&mut self, player_id: String, _username: String) -> Result<(), String> {
        if self.players.iter().any(|p| p.player_id == player_id)
            || self.observers.iter().any(|p| p.player_id == player_id)
        {
            return Err("Already in this room".into());
        }
        self.observers.push(RoomObserver {
            player_id,
            connected: true,
        });
        Ok(())
    }

    pub fn remove_player(&mut self, player_id: &str) -> Option<RoomSlot> {
        if let Some(idx) = self.players.iter().position(|p| p.player_id == player_id) {
            let slot = self.players.remove(idx);
            // If the host left, promote the first remaining player
            if self.host_player_id == player_id {
                if let Some(new_host) = self.players.first() {
                    self.host_player_id = new_host.player_id.clone();
                    self.host_username = new_host.username.clone();
                }
            }
            Some(slot)
        } else {
            None
        }
    }

    pub fn remove_observer(&mut self, player_id: &str) -> Option<RoomObserver> {
        self.observers
            .iter()
            .position(|p| p.player_id == player_id)
            .map(|idx| self.observers.remove(idx))
    }

    pub fn remove_participant(&mut self, player_id: &str) -> bool {
        self.transports.remove(player_id);
        self.remove_player(player_id).is_some() || self.remove_observer(player_id).is_some()
    }

    pub fn set_connected(&mut self, player_id: &str, connected: bool) {
        if let Some(slot) = self.players.iter_mut().find(|p| p.player_id == player_id) {
            slot.connected = connected;
            return;
        }
        if let Some(observer) = self.observers.iter_mut().find(|p| p.player_id == player_id) {
            observer.connected = connected;
        }
    }

    /// Forward-ported for future use when room cleanup logic is implemented.
    #[allow(dead_code)]
    pub fn all_disconnected(&self) -> bool {
        self.players.iter().all(|p| !p.connected) && self.observers.iter().all(|p| !p.connected)
    }

    pub fn has_connected_human(&self) -> bool {
        self.players.iter().any(|p| p.connected && !p.is_bot)
            || self
                .observers
                .iter()
                .any(|o| o.connected && !(self.hosted && o.player_id == self.host_player_id))
    }

    pub fn set_ready(&mut self, player_id: &str, ready: bool) -> Result<(), String> {
        if let Some(slot) = self.players.iter_mut().find(|p| p.player_id == player_id) {
            slot.ready = ready;
            Ok(())
        } else {
            Err("Player not in room".into())
        }
    }

    pub fn set_deck_selection(
        &mut self,
        player_id: &str,
        deck_name: String,
        deck: Deck,
        published_deck_id: Option<String>,
        commander_name: Option<String>,
        avatar_url: Option<String>,
    ) -> Result<(), String> {
        if let Some(slot) = self.players.iter_mut().find(|p| p.player_id == player_id) {
            slot.selected_deck_name = Some(deck_name);
            slot.selected_deck = Some(deck);
            slot.published_deck_id = published_deck_id;
            slot.selected_commander_name = commander_name;
            slot.avatar_url = avatar_url;
            slot.ready = false;
            Ok(())
        } else {
            Err("Player not in room".into())
        }
    }

    pub fn has_selected_deck(&self, player_id: &str) -> bool {
        self.players
            .iter()
            .find(|p| p.player_id == player_id)
            .map(|p| p.selected_deck.is_some() && p.selected_deck_name.is_some())
            .unwrap_or(false)
    }

    pub fn player_decks(&self) -> Vec<PlayerDeckInfo> {
        self.players
            .iter()
            .filter_map(|p| {
                p.selected_deck.clone().map(|deck| PlayerDeckInfo {
                    username: p.username.clone(),
                    deck_name: p
                        .selected_deck_name
                        .clone()
                        .unwrap_or_else(|| "Unknown Deck".to_string()),
                    deck,
                    published_deck_id: p.published_deck_id.clone(),
                    commander_name: p.selected_commander_name.clone(),
                    avatar_url: p.avatar_url.clone(),
                })
            })
            .collect()
    }

    pub fn is_host(&self, player_id: &str) -> bool {
        self.host_player_id == player_id
    }

    /// The room controller is the first human (non-bot) player to take a seat.
    /// They drive the lobby (format, seats, bots, start) regardless of who holds
    /// the engine (`host`). Computed dynamically from current seats, so if the
    /// controlling human leaves, control passes to the next human — never to a
    /// bot. Falls back to the first seat only if every player is a bot.
    pub fn controller_id(&self) -> Option<&str> {
        self.players
            .iter()
            .find(|p| !p.is_bot)
            .or_else(|| self.players.first())
            .map(|p| p.player_id.as_str())
    }

    pub fn is_controller(&self, player_id: &str) -> bool {
        self.controller_id() == Some(player_id)
    }

    pub fn host_username(&self) -> String {
        self.host_username.clone()
    }

    pub fn host_is_player(&self) -> bool {
        self.players
            .iter()
            .any(|p| p.player_id == self.host_player_id)
    }

    pub fn host_connected(&self) -> bool {
        self.players
            .iter()
            .any(|p| p.player_id == self.host_player_id && p.connected)
            || self
                .observers
                .iter()
                .any(|p| p.player_id == self.host_player_id && p.connected)
    }

    pub fn player_usernames(&self) -> Vec<String> {
        self.players.iter().map(|p| p.username.clone()).collect()
    }

    /// Forward-ported for future use when full player ID tracking is needed.
    #[allow(dead_code)]
    pub fn player_ids(&self) -> Vec<String> {
        self.players.iter().map(|p| p.player_id.clone()).collect()
    }

    pub fn connected_player_ids(&self) -> Vec<String> {
        self.players
            .iter()
            .filter(|p| p.connected)
            .map(|p| p.player_id.clone())
            .chain(
                self.observers
                    .iter()
                    .filter(|p| p.connected)
                    .map(|p| p.player_id.clone()),
            )
            .collect()
    }

    pub fn to_room_info(&self) -> RoomInfo {
        RoomInfo {
            room_id: self.room_id.clone(),
            room_name: self.room_name.clone(),
            protocol_version: self.protocol_version,
            host: self.host_username(),
            hosted: self.hosted,
            official: self.official,
            password_protected: self.password.is_some(),
            players: self
                .players
                .iter()
                .map(|p| RoomPlayerInfo {
                    username: p.username.clone(),
                    ready: p.ready,
                    connected: p.connected,
                    is_bot: p.is_bot,
                    selected_deck_name: p.selected_deck_name.clone(),
                })
                .collect(),
            max_players: self.max_players,
            format: self.format.clone(),
            engine: self.engine,
            reconnect_timeout_s: self.reconnect_timeout_s,
            status: self.status.clone(),
            draft_config: self.draft_config.clone(),
            sealed_config: self.sealed_config.clone(),
        }
    }
}

/// Bounds on what one member may put in the roster, because every other peer
/// feeds it to iroh to dial.
const MAX_DIRECT_ADDRS: usize = 16;
const MAX_ADDR_LEN: usize = 64;

impl Room {
    fn participant_username(&self, player_id: &str) -> Option<String> {
        if let Some(slot) = self.players.iter().find(|p| p.player_id == player_id) {
            return Some(slot.username.clone());
        }
        (self.host_player_id == player_id).then(|| self.host_username.clone())
    }

    /// Records a member's endpoint, or withdraws it with `None`. False means
    /// the announcement was refused and the caller should leave the announcer
    /// on the relay.
    pub fn set_transport(&mut self, player_id: &str, endpoint: Option<TransportEndpoint>) -> bool {
        let participant = self.players.iter().any(|p| p.player_id == player_id)
            || self.observers.iter().any(|p| p.player_id == player_id);
        if !participant {
            return false;
        }
        let Some(mut endpoint) = endpoint else {
            self.transports.remove(player_id);
            return true;
        };
        // An endpoint id is what a host checks a seat's `Hello` against, so a
        // second claim on one is a way to lock its owner out. First claim in
        // the room holds it.
        let taken = self.transports.iter().any(|(other, existing)| {
            other != player_id && existing.endpoint_id == endpoint.endpoint_id
        });
        if taken {
            return false;
        }
        endpoint
            .direct_addrs
            .retain(|addr| addr.len() <= MAX_ADDR_LEN);
        endpoint.direct_addrs.truncate(MAX_DIRECT_ADDRS);
        self.transports.insert(player_id.to_string(), endpoint);
        true
    }

    /// The roster clients are allowed to believe. Every username is the relay's
    /// own record for that session, never a client-supplied field, which is what
    /// makes an endpoint id attributable to a player.
    pub fn transport_members(&self) -> Vec<TransportMember> {
        let mut members: Vec<TransportMember> = self
            .transports
            .iter()
            .filter_map(|(player_id, endpoint)| {
                self.participant_username(player_id)
                    .map(|username| TransportMember {
                        username,
                        endpoint: endpoint.clone(),
                        host: player_id == &self.host_player_id,
                    })
            })
            .collect();
        members.sort_by(|a, b| a.username.cmp(&b.username));
        members
    }

    pub fn transport_host(&self) -> Option<TransportMember> {
        self.transport_members().into_iter().find(|m| m.host)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn room(host_plays: bool) -> Room {
        Room::new(
            "r".into(),
            "room".into(),
            manabrew_relay_protocol::PROTOCOL_VERSION,
            "host".into(),
            "host".into(),
            4,
            GameFormat::Commander,
            EngineKind::Forge,
            host_plays,
            None,
            None,
            false,
            None,
            60,
        )
    }

    #[test]
    fn first_user_is_controller_in_hosted_room() {
        let mut r = room(false);
        assert!(r.is_host("host"));
        assert!(!r.is_controller("host"));
        r.add_player("human".into(), "human".into(), false).unwrap();
        assert!(r.is_controller("human"));
        r.add_player("bot".into(), "bot".into(), true).unwrap();
        assert!(!r.is_controller("bot"));
    }

    fn endpoint(id: &str) -> TransportEndpoint {
        TransportEndpoint {
            endpoint_id: id.into(),
            relay_url: None,
            direct_addrs: vec![],
        }
    }

    #[test]
    fn only_members_announce_and_nobody_takes_another_endpoint() {
        let mut r = room(false);
        r.add_player("human".into(), "human".into(), false).unwrap();
        r.add_player("squatter".into(), "squatter".into(), false)
            .unwrap();

        assert!(r.set_transport("human", Some(endpoint("ep-human"))));
        assert!(!r.set_transport("stranger", Some(endpoint("ep-stranger"))));
        // Taking it would tell the owner their own endpoint is attested for
        // somebody else, and nothing would say why.
        assert!(!r.set_transport("squatter", Some(endpoint("ep-human"))));
        assert_eq!(r.transports["human"].endpoint_id, "ep-human");

        r.set_transport("host", Some(endpoint("ep-host")));
        assert_eq!(r.transport_host().unwrap().username, "host");
        assert_eq!(r.transport_members().len(), 2);

        r.remove_participant("human");
        assert!(!r.transports.contains_key("human"));
    }

    #[test]
    fn an_announcement_cannot_flood_the_address_book() {
        let mut r = room(false);
        r.add_player("human".into(), "human".into(), false).unwrap();
        let mut flood = endpoint("ep-human");
        flood.direct_addrs = (0..64).map(|i| format!("10.0.0.{i}:1234")).collect();
        flood.direct_addrs.push("x".repeat(MAX_ADDR_LEN + 1));

        assert!(r.set_transport("human", Some(flood)));
        let stored = &r.transports["human"].direct_addrs;
        assert_eq!(stored.len(), MAX_DIRECT_ADDRS);
        assert!(stored.iter().all(|addr| addr.len() <= MAX_ADDR_LEN));
    }
}
