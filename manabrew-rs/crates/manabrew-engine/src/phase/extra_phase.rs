//! ExtraPhase — stores an extra phase inserted into the turn.
//!
//! Mirrors Java's `ExtraPhase.java`.

use forge_foundation::PhaseType;

/// An extra phase entry — tracks what phase to insert and any delayed triggers.
/// Mirrors Java's `ExtraPhase` class.
#[derive(Debug, Clone)]
pub struct ExtraPhase {
    phase: PhaseType,
    delayed_triggers: Vec<String>,
}

impl ExtraPhase {
    pub fn new(phase: PhaseType) -> Self {
        ExtraPhase {
            phase,
            delayed_triggers: Vec::new(),
        }
    }

    pub fn get_phase(&self) -> PhaseType {
        self.phase
    }

    pub fn add_trigger(&mut self, del_trigger: String) {
        self.delayed_triggers.push(del_trigger);
    }

    pub fn get_delayed_triggers(&self) -> &[String] {
        &self.delayed_triggers
    }
}
