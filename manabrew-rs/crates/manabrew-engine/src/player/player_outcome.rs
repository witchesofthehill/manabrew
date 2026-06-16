use serde::{Deserialize, Serialize};

use crate::player::GameLossReason;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PlayerOutcome {
    Win,
    Draw,
    AltWin {
        source_name: Option<String>,
    },
    Loss {
        reason: GameLossReason,
        spell_name: Option<String>,
    },
    Conceded,
}

impl PlayerOutcome {
    pub fn win() -> Self {
        Self::Win
    }

    pub fn draw() -> Self {
        Self::Draw
    }

    pub fn alt_win(source_name: Option<String>) -> Self {
        Self::AltWin { source_name }
    }

    pub fn loss(reason: GameLossReason, spell_name: Option<String>) -> Self {
        Self::Loss { reason, spell_name }
    }

    pub fn concede() -> Self {
        Self::Conceded
    }

    pub fn has_won(&self) -> bool {
        matches!(self, Self::Win | Self::AltWin { .. })
    }

    pub fn has_lost(&self) -> bool {
        matches!(self, Self::Loss { .. } | Self::Conceded)
    }
}
