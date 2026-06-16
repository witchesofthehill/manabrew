use serde::{Deserialize, Serialize};

/// Reasons a player can lose the game.
/// Mirrors Java `forge.game.player.GameLossReason`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GameLossReason {
    LifeReachedZero,
    Poisoned,
    CommanderDamage,
    Milled,
    OpponentWon,
    SpellEffect,
    IntentionalDraw,
}

impl GameLossReason {
    pub fn smart_value_of(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "lifereachedzero" | "life" | "zero" => Some(Self::LifeReachedZero),
            "poisoned" | "poison" => Some(Self::Poisoned),
            "commanderdamage" | "commander" => Some(Self::CommanderDamage),
            "milled" | "mill" => Some(Self::Milled),
            "opponentwon" => Some(Self::OpponentWon),
            "spelleffect" | "spell" => Some(Self::SpellEffect),
            "intentionaldraw" | "draw" => Some(Self::IntentionalDraw),
            _ => None,
        }
    }
}
