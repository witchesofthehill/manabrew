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
                // Taken by value, not borrowed and cloned: this is the whole
                // cached board, it is rebuilt once per seat per decision, and a
                // four-seat Commander room does that five times a decision.
                let previous = match slot {
                    Some(slot) => self.last_state_by_slot.remove(slot),
                    None => self.last_state.take(),
                };
                let Some(mut rebuilt) = previous else {
                    return;
                };
                let Some(patch) = envelope.get("patch") else {
                    self.restore_state(slot, rebuilt);
                    return;
                };
                if let Some(object) = rebuilt.as_object_mut() {
                    let base = object.remove("state").unwrap_or(Value::Null);
                    object.insert(
                        "state".to_string(),
                        manabrew_relay_protocol::state_delta::apply(&base, patch),
                    );
                    if let Some(fingerprint) = envelope.get("fingerprint") {
                        object.insert("fingerprint".to_string(), fingerprint.clone());
                    }
                }
                self.observe_outcome(&rebuilt);
                self.restore_state(slot, rebuilt);
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

    fn restore_state(&mut self, slot: Option<&str>, state: Value) {
        match slot {
            Some(slot) => {
                self.last_state_by_slot.insert(slot.to_string(), state);
            }
            None => self.last_state = Some(state),
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

    /// The whole board this seat should be holding, as folded by [`Self::observe`].
    /// Used to serve a seat whose client cannot apply the patch that just came
    /// through, so the relay hands it the state the patch would have produced.
    pub fn state_after(&self, envelope: &Value) -> Option<&Value> {
        match envelope.get("forPlayer").and_then(Value::as_str) {
            Some(slot) => self.last_state_by_slot.get(slot),
            None => self.last_state.as_ref(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use manabrew_relay_protocol::state_delta;
    use serde_json::json;

    fn cache() -> GameReplayCache {
        GameReplayCache::new("game-1".into(), vec!["alice".into()], Vec::new(), 40)
    }

    fn full(slot: &str, state: Value) -> Value {
        json!({
            "kind": "state",
            "forPlayer": slot,
            "fingerprint": state_delta::fingerprint(&state),
            "state": state,
        })
    }

    /// The envelope a node sends once `state_delta` is on: the real diff
    /// between the seat's last board and its next one.
    fn patch(slot: &str, previous: &Value, next: &Value) -> Value {
        json!({
            "kind": "stateDelta",
            "forPlayer": slot,
            "fingerprint": state_delta::fingerprint(next),
            "patch": state_delta::diff(previous, next).expect("the boards differ"),
        })
    }

    #[test]
    fn folds_a_patch_into_the_board_it_hands_back() {
        let before = json!({ "gameView": { "turn": 1, "phase": "MAIN1" } });
        let after = json!({ "gameView": { "turn": 2, "phase": "MAIN1" } });
        let mut replay = cache();
        replay.observe(&full("player0", before.clone()));
        let patch = patch("player0", &before, &after);
        replay.observe(&patch);

        let folded = replay.state_after(&patch).expect("a board for that seat");
        assert_eq!(folded["state"], after);
        assert_eq!(folded["fingerprint"], patch["fingerprint"]);
    }

    #[test]
    fn a_patch_for_a_seat_with_no_board_leaves_nothing_to_hand_back() {
        let mut replay = cache();
        let patch = patch(
            "player0",
            &json!({ "gameView": { "turn": 1 } }),
            &json!({ "gameView": { "turn": 2 } }),
        );
        replay.observe(&patch);
        assert!(replay.state_after(&patch).is_none());
    }

    #[test]
    fn seats_do_not_share_a_board() {
        let mut replay = cache();
        let mine = json!({ "gameView": { "hand": ["Swamp"] } });
        let theirs = json!({ "gameView": { "hand": [] } });
        replay.observe(&full("player0", mine.clone()));
        replay.observe(&full("player1", theirs.clone()));

        let patch = patch("player0", &mine, &json!({ "gameView": { "hand": [] } }));
        replay.observe(&patch);

        let other = replay
            .state_after(&json!({ "kind": "stateDelta", "forPlayer": "player1" }))
            .expect("player1 still has a board");
        assert_eq!(other["state"], theirs);
    }
}
