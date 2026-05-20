use crate::agent::GameLogEvent;
use crate::agent::ManaCostAction;
use crate::ids::{CardId, PlayerId};
use forge_foundation::PhaseType;

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
        /// Natural (pre-modifier) values, one per kept die.
        natural_results: Vec<i32>,
        /// Final values after modifiers/exchanges, one per kept die.
        final_results: Vec<i32>,
        /// Rolls dropped before modification (ignore-lowest, choose-to-ignore).
        ignored_rolls: Vec<i32>,
        /// Display name of the card that triggered the roll, if any.
        source_card_name: Option<String>,
    },
    /// Each player rolled a die at the start of the game; the highest
    /// roller goes first. Sent once with every player's final roll so
    /// the UI can animate them side-by-side.
    FirstPlayerRoll {
        sides: i32,
        /// One entry per player in `player_order`, paired with their roll.
        rolls: Vec<(PlayerId, i32)>,
        /// The player who won the roll-off (after any tiebreaks).
        winner: PlayerId,
    },
    GameOver,
}
