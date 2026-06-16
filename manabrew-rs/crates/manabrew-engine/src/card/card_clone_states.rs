//! Clone-state container (Java parity: `CardCloneStates`).

use std::collections::HashMap;

use crate::card::Card;
use crate::ids::CardId;

#[derive(Debug, Clone, Default)]
pub struct CardCloneStates {
    states: HashMap<String, Card>,
}

impl CardCloneStates {
    pub fn get(&mut self, key: &str) -> Option<&Card> {
        if self.states.contains_key(key) {
            return self.states.get(key);
        }

        if let Some(original) = self.states.get("Original").cloned() {
            self.states.insert(key.to_string(), original);
            return self.states.get(key);
        }
        None
    }

    pub fn add(&mut self, state_name: &str, state: Card) {
        self.states.insert(state_name.to_string(), state);
    }

    pub fn copy(&self, host: CardId, _lki: bool) -> CardCloneStates {
        let mut copied = self.clone();
        for state in copied.states.values_mut() {
            state.id = host;
        }
        copied
    }
}
