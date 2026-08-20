use std::collections::HashMap;
use std::time::Instant;

use serde_json::Value;

use crate::protocol::PlayerDeckInfo;
const PLAYER_SLOT_PREFIX: &str = "player-";
const MAX_FATAL_MESSAGE_CHARS: usize = 500;

#[derive(Debug, Clone)]
pub struct QueuedEngineInput {
    pub from_player: String,
    pub state: Value,
}

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
    pub last_state_by_slot: HashMap<String, Value>,
    pub pending_prompts: HashMap<String, Value>,
    pub queued_inputs: HashMap<String, Vec<QueuedEngineInput>>,
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
            last_state_by_slot: HashMap::new(),
            pending_prompts: HashMap::new(),
            queued_inputs: HashMap::new(),
            outcome: ObservedOutcome::default(),
        }
    }

    pub fn observe(&mut self, envelope: &Value) {
        match envelope.get("kind").and_then(Value::as_str) {
            Some("state") => {
                self.observe_outcome(envelope);
                match envelope.get("forPlayer").and_then(Value::as_str) {
                    Some(slot) => {
                        self.last_state_by_slot
                            .insert(slot.to_string(), envelope.clone());
                    }
                    None => self.last_state = Some(envelope.clone()),
                }
            }
            // Patches must be folded into the cached state, not stored raw: a
            // resyncing client needs a whole board, and the outcome watcher
            // reads gameOver out of it.
            Some("stateDelta") => {
                let slot = envelope.get("forPlayer").and_then(Value::as_str);
                let previous = match slot {
                    Some(slot) => self.last_state_by_slot.get(slot),
                    None => self.last_state.as_ref(),
                };
                let Some(previous) = previous else {
                    return;
                };
                let Some(patch) = envelope.get("patch") else {
                    return;
                };
                let base = previous.get("state").cloned().unwrap_or(Value::Null);
                let mut rebuilt = previous.clone();
                if let Some(object) = rebuilt.as_object_mut() {
                    object.insert(
                        "state".to_string(),
                        manabrew_relay_protocol::state_delta::apply(&base, patch),
                    );
                    if let Some(fingerprint) = envelope.get("fingerprint") {
                        object.insert("fingerprint".to_string(), fingerprint.clone());
                    }
                }
                self.observe_outcome(&rebuilt);
                match slot {
                    Some(slot) => {
                        self.last_state_by_slot.insert(slot.to_string(), rebuilt);
                    }
                    None => self.last_state = Some(rebuilt),
                }
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
        let Some(game_view) = envelope
            .get("state")
            .and_then(|state| state.get("gameView"))
        else {
            return;
        };
        if game_view.get("gameOver").and_then(Value::as_bool) != Some(true) {
            return;
        }
        self.outcome.game_over = true;
        self.outcome.winner_slot = game_view
            .get("winnerId")
            .and_then(Value::as_str)
            .map(str::to_string);
        if let Some(players) = game_view.get("players").and_then(Value::as_array) {
            self.outcome.conceded_slots = players
                .iter()
                .filter(|player| player.get("status").and_then(Value::as_str) == Some("conceded"))
                .filter_map(|player| player.get("id").and_then(Value::as_str))
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

    pub fn queue_input(&mut self, host_username: &str, from_player: &str, state: Value) {
        self.queued_inputs
            .entry(host_username.to_string())
            .or_default()
            .push(QueuedEngineInput {
                from_player: from_player.to_string(),
                state,
            });
    }

    pub fn queued_inputs_for(&self, username: &str) -> Vec<QueuedEngineInput> {
        self.queued_inputs
            .get(username)
            .cloned()
            .unwrap_or_default()
    }

    pub fn acknowledge_inputs(&mut self, host_username: &str) {
        self.queued_inputs.remove(host_username);
    }
}
