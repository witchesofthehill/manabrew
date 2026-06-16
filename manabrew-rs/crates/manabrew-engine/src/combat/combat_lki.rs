use super::DefenderId;
use crate::ids::CardId;

/// Last-known-information snapshot for a creature that left combat.
/// Mirrors Java's `CombatLki.java`.
#[derive(Debug, Clone)]
pub struct CombatLki {
    pub is_attacker: bool,
    pub defender: Option<DefenderId>,
    pub blocked_attackers: Vec<CardId>,
}

impl CombatLki {
    /// Returns the first related band's defender (Java: `getFirstBand()`).
    /// In our flat model this is just the defender field.
    pub fn get_first_defender(&self) -> Option<DefenderId> {
        self.defender
    }
}
