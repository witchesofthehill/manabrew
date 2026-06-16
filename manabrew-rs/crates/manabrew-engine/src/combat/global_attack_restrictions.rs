use std::collections::HashMap;

use super::DefenderId;
use crate::card::Card;
use crate::ids::{CardId, PlayerId};
use crate::staticability::static_ability_attack_restrict;

/// Global restrictions on how many creatures can attack, either overall or
/// per-defender. Mirrors Java's `GlobalAttackRestrictions.java`.
#[derive(Debug, Clone)]
pub struct GlobalAttackRestrictions {
    /// Maximum total attackers allowed (None = unlimited).
    pub max: Option<i32>,
    /// Per-defender maximum attackers (defender → max).
    pub defender_max: HashMap<DefenderId, i32>,
}

impl GlobalAttackRestrictions {
    /// Check if a proposed set of attackers is legal under global restrictions.
    /// `attackers` maps attacker CardId → DefenderId.
    pub fn is_legal(&self, attackers: &[(CardId, DefenderId)]) -> bool {
        if let Some(max) = self.max {
            if attackers.len() as i32 > max {
                return false;
            }
        }

        // Check per-defender limits
        for (&defender, &def_max) in &self.defender_max {
            let count = attackers.iter().filter(|(_, d)| *d == defender).count() as i32;
            if count > def_max {
                return false;
            }
        }
        true
    }

    /// Build global attack restrictions from static abilities on the
    /// battlefield. Mirrors Java's
    /// `GlobalAttackRestrictions.getGlobalRestrictions()`.
    pub fn get_global_restrictions(
        cards: &[Card],
        attacking_player: PlayerId,
        possible_defenders: &[DefenderId],
    ) -> Self {
        let mut max = static_ability_attack_restrict::global_attack_restrict(cards);

        let mut defender_max = HashMap::new();
        for &defender in possible_defenders {
            if let DefenderId::Player(pid) = defender {
                if let Some(def_max) =
                    static_ability_attack_restrict::attack_restrict_num_for_defender(cards, pid)
                {
                    defender_max.insert(defender, def_max);
                }
            }
        }

        // If every defender has a limit, the global max is the sum of those
        // limits (capped by any existing global restriction).
        if !defender_max.is_empty() && defender_max.len() == possible_defenders.len() {
            let sum: i32 = defender_max.values().sum();
            max = Some(max.map_or(sum, |m| m.min(sum)));
        }

        // Suppress unused variable warning — attacking_player is kept for
        // signature parity with Java's getGlobalRestrictions(Player, FCollectionView<GameEntity>).
        let _ = attacking_player;

        GlobalAttackRestrictions { max, defender_max }
    }

    pub fn get_max(&self) -> Option<i32> {
        self.max
    }

    pub fn get_defender_max(&self) -> &HashMap<DefenderId, i32> {
        &self.defender_max
    }
}
