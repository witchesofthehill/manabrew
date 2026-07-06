use std::collections::HashMap;
use std::time::Instant;

use serde_json::Value;

use crate::protocol::PlayerDeckInfo;
use crate::room::RoomSlot;

const PLAYER_SLOT_PREFIX: &str = "player-";
const MAX_FATAL_MESSAGE_CHARS: usize = 500;

#[derive(Debug, Default)]
pub struct ObservedOutcome {
    pub game_over: bool,
    pub winner_slot: Option<String>,
    pub conceded_slots: Vec<String>,
    pub fatal_message: Option<String>,
}

#[derive(Debug)]
pub struct GameReplayCache {
    pub game_id: String,
    pub started_at: Instant,
    pub player_order: Vec<String>,
    pub player_decks: Vec<PlayerDeckInfo>,
    pub starting_life: i32,
    pub last_state: Option<Value>,
    pub pending_prompts: HashMap<String, Value>,
    pub queued_responses: HashMap<String, Vec<Value>>,
    pub outcome: ObservedOutcome,
}

impl GameReplayCache {
    pub fn new(
        game_id: String,
        player_order: Vec<String>,
        player_decks: Vec<PlayerDeckInfo>,
        starting_life: i32,
    ) -> Self {
        GameReplayCache {
            game_id,
            started_at: Instant::now(),
            player_order,
            player_decks,
            starting_life,
            last_state: None,
            pending_prompts: HashMap::new(),
            queued_responses: HashMap::new(),
            outcome: ObservedOutcome::default(),
        }
    }

    pub fn observe(&mut self, envelope: &Value, players: &[RoomSlot]) {
        match envelope.get("kind").and_then(Value::as_str) {
            Some("state") => {
                self.observe_outcome(envelope);
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
            Some("fatal") => {
                if let Some(message) = envelope.get("message").and_then(Value::as_str) {
                    self.outcome.fatal_message =
                        Some(message.chars().take(MAX_FATAL_MESSAGE_CHARS).collect());
                }
            }
            _ => {}
        }
    }

    fn observe_outcome(&mut self, envelope: &Value) {
        let Some(state) = envelope.get("state") else {
            return;
        };
        if state.get("gameOver").and_then(Value::as_bool) != Some(true) {
            return;
        }
        self.outcome.game_over = true;
        self.outcome.winner_slot = state
            .get("winnerId")
            .and_then(Value::as_str)
            .map(str::to_string);
        if let Some(conceded) = state.get("concededPlayerIds").and_then(Value::as_array) {
            self.outcome.conceded_slots = conceded
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect();
        }
    }

    pub fn slot_for(&self, username: &str) -> Option<String> {
        self.player_order
            .iter()
            .position(|name| name == username)
            .map(|index| format!("{PLAYER_SLOT_PREFIX}{index}"))
    }

    pub fn username_for_slot(&self, slot: &str) -> Option<String> {
        slot.strip_prefix(PLAYER_SLOT_PREFIX)
            .and_then(|index| index.parse::<usize>().ok())
            .and_then(|index| self.player_order.get(index).cloned())
    }

    pub fn take_queued_responses(&mut self, username: &str) -> Vec<Value> {
        self.queued_responses.remove(username).unwrap_or_default()
    }
}
