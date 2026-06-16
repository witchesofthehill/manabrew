//! ExtraTurn — stores information about extra turns.
//!
//! Mirrors Java's `ExtraTurn.java`.

use crate::ids::PlayerId;

/// An extra turn entry — tracks who gets the turn and any modifications.
/// Mirrors Java's `ExtraTurn` class.
#[derive(Debug, Clone)]
pub struct ExtraTurn {
    pub player: PlayerId,
    /// If true, the untap step is skipped during this extra turn.
    pub skip_untap: bool,
    /// Delayed triggers to register when this extra turn begins.
    delayed_triggers: Vec<String>,
    /// If true, the player can't set schemes in motion this turn (Archenemy).
    pub cant_set_schemes_in_motion: bool,
}

impl ExtraTurn {
    pub fn new(player: PlayerId) -> Self {
        ExtraTurn {
            player,
            skip_untap: false,
            delayed_triggers: Vec::new(),
            cant_set_schemes_in_motion: false,
        }
    }

    pub fn get_player(&self) -> PlayerId {
        self.player
    }

    pub fn set_player(&mut self, player: PlayerId) {
        self.player = player;
    }

    pub fn add_trigger(&mut self, del_trigger: String) {
        self.delayed_triggers.push(del_trigger);
    }

    pub fn get_delayed_triggers(&self) -> &[String] {
        &self.delayed_triggers
    }

    pub fn is_skip_untap(&self) -> bool {
        self.skip_untap
    }

    pub fn set_skip_untap(&mut self, skip: bool) {
        self.skip_untap = skip;
    }

    pub fn is_cant_set_schemes_in_motion(&self) -> bool {
        self.cant_set_schemes_in_motion
    }

    pub fn set_cant_set_schemes_in_motion(&mut self, cant: bool) {
        self.cant_set_schemes_in_motion = cant;
    }
}
