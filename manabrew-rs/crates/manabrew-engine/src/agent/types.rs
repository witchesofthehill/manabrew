use serde::{Deserialize, Serialize};

use crate::ids::{CardId, PlayerId};
use crate::spellability::AlternativeCost;

/// A game entity that can be a player or a card (permanent).
/// Used by effects like Proliferate that operate on mixed entity lists.
/// Mirrors Java's `GameEntity` hierarchy used in `chooseEntitiesForEffect`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GameEntity {
    Player(PlayerId),
    Card(CardId),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayOption {
    pub card_id: CardId,
    pub mode: PlayCardMode,
    /// Disambiguates between multiple instances of the same alternative cost
    /// keyword on the same card (e.g. intrinsic `Evoke {2}{U}` at index 0
    /// versus granted `Evoke {4}` at index 1 when Ashling's static ability
    /// adds a second Evoke cost). Zero for all other modes.
    #[serde(default)]
    pub alt_cost_index: u8,
}

impl PlayOption {
    pub fn normal(card_id: CardId) -> Self {
        Self {
            card_id,
            mode: PlayCardMode::Normal,
            alt_cost_index: 0,
        }
    }

    pub fn with_mode(card_id: CardId, mode: PlayCardMode) -> Self {
        Self {
            card_id,
            mode,
            alt_cost_index: 0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlayCardMode {
    Normal,
    BackFaceLand,
    /// Cast the right split face of a Room card from hand.
    RoomRightSplit,
    Alternative(AlternativeCost),
    /// Alternative cost granted by `Mode$ AlternativeCost` static abilities.
    StaticAlternative,
    ForetellExile,
    /// Unlock a Room door on a permanent already on the battlefield.
    /// Mirrors Java's `StaticAbilityApiBased` for `ST$ UnlockDoor` which falls
    /// through to the `CastSpell` branch in the harness (not `ActivateAbility`).
    UnlockDoor,
}

/// A target choice that can be a player, a card, or nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TargetChoice {
    Player(PlayerId),
    Card(CardId),
    None,
}

/// The action a player takes during a main phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MainPhaseAction {
    /// Pass priority / end main phase.
    Pass,
    /// Play a card from hand / graveyard / exile / command with a specific cast mode.
    Play(PlayOption),
    /// Tap an untapped land on the battlefield to add its mana to the pool.
    /// Optional ability index selects a specific mana ability (dual lands).
    ActivateMana(CardId, Option<usize>),
    /// Untap a tapped land and remove its mana from the pool (undo tap).
    UntapMana(CardId),
    /// Activate an ability on a permanent. (source card, ability index)
    ActivateAbility(CardId, usize),
}

#[derive(Debug, Clone)]
pub struct ActivatableAction {
    pub card_id: CardId,
    pub ability_index: usize,
    pub description: String,
    pub cost: Option<String>,
    pub is_mana_ability: bool,
    pub produced_colors: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct PriorityActionSpace {
    pub playable: Vec<PlayOption>,
    /// Card ids tappable for mana (engine validation of `ActivateMana`).
    pub tappable_lands: Vec<CardId>,
    pub untappable_lands: Vec<CardId>,
    pub activatable: Vec<ActivatableAction>,
    pub mana_abilities: Vec<ActivatableAction>,
}

impl PriorityActionSpace {
    pub fn is_empty(&self) -> bool {
        self.playable.is_empty()
            && self.tappable_lands.is_empty()
            && self.untappable_lands.is_empty()
            && self.activatable.is_empty()
    }
}

/// The action a player takes when asked to pay an attack cost (Propaganda, Ghostly Prison).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CombatCostAction {
    /// Tap an untapped land to add mana to the pool.
    TapLand(CardId),
    /// Untap a tapped land and remove its mana from the pool (undo).
    UntapLand(CardId),
    /// Pay the cost from the mana pool.
    Pay,
    /// Decline to pay — remove this attacker.
    Decline,
}

/// The action a player takes when interactively paying a mana cost for a spell.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ManaCostAction {
    TapForMana {
        card_id: CardId,
        mana_ability_index: Option<usize>,
        express_choice: Option<u16>,
    },
    Untap(CardId),
    /// Confirm payment from the mana pool. When `auto` is true, the engine
    /// should complete the payment session using engine auto-pay.
    Pay {
        auto: bool,
    },
    /// Payment was attempted but could not be completed.
    AttemptedAndFailed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManaAbilityOption {
    pub card_id: CardId,
    pub ability_index: usize,
    pub description: String,
}

/// Java-parity binary choice kinds (`PlayerController.BinaryChoiceType`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinaryChoiceKind {
    HeadsOrTails,
    TapOrUntap,
    PlayOrDraw,
    OddsOrEvens,
    UntapOrLeaveTapped,
    LeftOrRight,
    AddOrRemove,
    IncreaseOrDecrease,
}

impl BinaryChoiceKind {
    /// Canonical button labels for each binary choice kind.
    pub fn labels(self) -> (&'static str, &'static str) {
        match self {
            BinaryChoiceKind::HeadsOrTails => ("Heads", "Tails"),
            BinaryChoiceKind::TapOrUntap => ("Tap", "Untap"),
            BinaryChoiceKind::PlayOrDraw => ("Play", "Draw"),
            BinaryChoiceKind::OddsOrEvens => ("Odds", "Evens"),
            BinaryChoiceKind::UntapOrLeaveTapped => ("Untap", "Leave tapped"),
            BinaryChoiceKind::LeftOrRight => ("Left", "Right"),
            BinaryChoiceKind::AddOrRemove => ("Add", "Remove"),
            BinaryChoiceKind::IncreaseOrDecrease => ("Increase", "Decrease"),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            BinaryChoiceKind::HeadsOrTails => "HeadsOrTails",
            BinaryChoiceKind::TapOrUntap => "TapOrUntap",
            BinaryChoiceKind::PlayOrDraw => "PlayOrDraw",
            BinaryChoiceKind::OddsOrEvens => "OddsOrEvens",
            BinaryChoiceKind::UntapOrLeaveTapped => "UntapOrLeaveTapped",
            BinaryChoiceKind::LeftOrRight => "LeftOrRight",
            BinaryChoiceKind::AddOrRemove => "AddOrRemove",
            BinaryChoiceKind::IncreaseOrDecrease => "IncreaseOrDecrease",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RollSwapChoice {
    Power,
    Toughness,
}
