use serde::{Deserialize, Serialize};

use crate::ids::CardId;
use crate::player::{PlayerOutcome, PlayerState};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerStatistics {
    pub opening_hand_size: i32,
    pub times_mulliganed: i32,
    pub turns_played: i32,
    pub outcome: Option<PlayerOutcome>,
    #[serde(default)]
    pub cards_cast_this_turn: Vec<CardId>,
}

impl From<&PlayerState> for PlayerStatistics {
    fn from(player: &PlayerState) -> Self {
        Self {
            opening_hand_size: player.starting_hand_size,
            times_mulliganed: 0,
            turns_played: 0,
            outcome: player.outcome.clone(),
            cards_cast_this_turn: player.cards_cast_this_turn.clone(),
        }
    }
}

impl PlayerStatistics {
    pub fn notify_has_mulliganed(&mut self) {
        self.times_mulliganed += 1;
    }

    pub fn notify_opening_hand_size(&mut self, size: i32) {
        self.opening_hand_size = size;
    }

    pub fn set_outcome(&mut self, outcome: Option<PlayerOutcome>) {
        self.outcome = outcome;
    }

    pub fn record_spell_cast(&mut self, card_id: CardId) {
        self.cards_cast_this_turn.push(card_id);
    }

    pub fn clear_turn_cache(&mut self) {
        self.cards_cast_this_turn.clear();
    }

    pub fn next_turn(&mut self) {
        self.turns_played += 1;
        self.clear_turn_cache();
    }
}
