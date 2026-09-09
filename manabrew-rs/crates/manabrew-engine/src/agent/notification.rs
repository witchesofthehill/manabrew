use crate::agent::GameLogEvent;
use crate::agent::ManaCostAction;
use crate::ids::{CardId, PlayerId};
use forge_foundation::PhaseType;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanarDieFace {
    Planeswalk,
    Chaos,
    Blank,
}
impl PlanarDieFace {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "planeswalk" => Some(Self::Planeswalk),
            "chaos" => Some(Self::Chaos),
            "blank" => Some(Self::Blank),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub enum GameNotification {
    Event(GameLogEvent),
    CardPlayed {
        player: PlayerId,
        card_id: CardId,
        card_name: String,
        set_code: String,
    },
    TurnChanged {
        active_player: PlayerId,
        turn_number: u32,
    },
    PhaseChanged {
        phase: PhaseType,
    },
    PriorityChanged {
        player: PlayerId,
    },
    StateChanged,
    SnapshotCreated {
        checkpoint_id: u64,
        label: String,
    },
    ManaPaymentResolved {
        player: PlayerId,
        actions: Vec<ManaCostAction>,
    },
    ActivatedAbilityPaymentFailed {
        player: PlayerId,
        card_id: CardId,
        ability_index: usize,
    },
    /// Dice were rolled. Display-only — sent for UI animation/feedback.
    /// Mirrors Java's `PlayerController.notifyOfRoll`.
    DiceRolled {
        player: PlayerId,
        sides: i32,
        natural_results: Vec<i32>,
        final_results: Vec<i32>,
        ignored_rolls: Vec<i32>,
        source_card_id: Option<CardId>,
        source_card_name: Option<String>,
    },
    FirstPlayerRoll {
        sides: i32,
        rounds: Vec<Vec<(PlayerId, i32)>>,
        winner: PlayerId,
    },
    CoinFlipped {
        player: PlayerId,
        results: Vec<bool>,
        kept_result: bool,
        called_heads: Option<bool>,
        won: Option<bool>,
        source_card_id: CardId,
        source_card_name: Option<String>,
    },
    PlanarDieRolled {
        player: PlayerId,
        results: Vec<PlanarDieFace>,
        ignored_results: Vec<PlanarDieFace>,
        source_card_id: CardId,
        source_card_name: Option<String>,
    },
    GameOver,
}
