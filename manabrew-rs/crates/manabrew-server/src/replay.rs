use std::collections::HashMap;

use serde_json::Value;

use crate::protocol::PlayerDeckInfo;
use crate::room::RoomSlot;

#[derive(Debug, Default)]
pub struct GameReplayCache {
    pub player_order: Vec<String>,
    pub player_decks: Vec<PlayerDeckInfo>,
    pub starting_life: i32,
    pub last_state: Option<Value>,
    pub pending_prompts: HashMap<String, Value>,
    pub queued_responses: HashMap<String, Vec<Value>>,
}

impl GameReplayCache {
    pub fn new(
        player_order: Vec<String>,
        player_decks: Vec<PlayerDeckInfo>,
        starting_life: i32,
    ) -> Self {
        GameReplayCache {
            player_order,
            player_decks,
            starting_life,
            ..Default::default()
        }
    }

    pub fn observe(&mut self, envelope: &Value, players: &[RoomSlot]) {
        match envelope.get("kind").and_then(Value::as_str) {
            Some("state") => {
                self.last_state = Some(envelope.clone());
            }
            Some("prompt") => {
                if let Some(slot) = envelope.get("forPlayer").and_then(Value::as_str) {
                    self.pending_prompts
                        .insert(slot.to_string(), envelope.clone());
                }
            }
            Some("response") => {
                if let Some(slot) = envelope.get("fromPlayer").and_then(Value::as_str) {
                    self.pending_prompts.remove(slot);
                }
                for player in players.iter().filter(|p| !p.connected) {
                    self.queued_responses
                        .entry(player.username.clone())
                        .or_default()
                        .push(envelope.clone());
                }
            }
            _ => {}
        }
    }

    pub fn slot_for(&self, username: &str) -> Option<String> {
        self.player_order
            .iter()
            .position(|name| name == username)
            .map(|index| format!("player-{index}"))
    }

    pub fn take_queued_responses(&mut self, username: &str) -> Vec<Value> {
        self.queued_responses.remove(username).unwrap_or_default()
    }
}
