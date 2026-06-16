use std::collections::HashMap;

use super::DefenderId;
use crate::card::Card;
use crate::ids::{CardId, PlayerId};
use crate::staticability::static_ability_must_attack;

/// Represents a requirement for a creature to attack.
/// Mirrors Java's `AttackRequirement.java`.
#[derive(Debug, Clone)]
pub struct AttackRequirement {
    /// The creature that must attack.
    pub attacker: CardId,
    /// True if the creature must attack any legal defender.
    pub must_attack_any: bool,
    /// If set, the creature must attack this specific defender (if able).
    pub must_attack_defender: Option<PlayerId>,
    /// The player that goaded this creature (it can't attack that player).
    pub goaded_by: Option<PlayerId>,
    /// Per-defender requirement counts: defender → number of reasons to attack it.
    /// Mirrors Java's `defenderSpecific` map.
    pub defender_specific: HashMap<DefenderId, i32>,
}

impl AttackRequirement {
    /// Mirrors Java's `hasRequirement()`.
    /// Returns true if this creature has any reason it must attack.
    pub fn has_requirement(&self) -> bool {
        self.defender_specific.values().any(|&v| v > 0) || self.must_attack_any
    }

    /// Mirrors Java's `countViolations()`.
    /// Count how many attack requirements are violated if this creature is
    /// attacking `defender` (or `None` if not attacking at all).
    pub fn count_violations(&self, defender: Option<DefenderId>) -> i32 {
        if !self.has_requirement() {
            return 0;
        }

        let total: i32 = self.defender_specific.values().sum();
        let is_attacking = defender.is_some();

        let credit = if is_attacking {
            defender
                .and_then(|d| self.defender_specific.get(&d).copied())
                .unwrap_or(0)
        } else {
            0
        };

        total - credit
    }

    /// Get sorted requirements: (defender, count) pairs sorted ascending.
    /// Mirrors Java's `getSortedRequirements()`.
    pub fn get_sorted_requirements(&self) -> Vec<(DefenderId, i32)> {
        let mut entries: Vec<(DefenderId, i32)> = self
            .defender_specific
            .iter()
            .map(|(&d, &c)| (d, c))
            .collect();
        entries.sort_by_key(|&(_, c)| c);
        entries
    }
}

/// Compute attack requirements for all available creatures.
/// Returns a list of requirements — creatures that must attack if able.
///
/// Sources of must-attack:
/// 1. Static abilities with `MustAttack` mode (existing `must_attack()` check)
/// 2. Goad: creature is goaded and must attack a player other than the goader
pub fn compute_attack_requirements(
    cards: &[Card],
    available: &[CardId],
    defending: PlayerId,
) -> Vec<AttackRequirement> {
    compute_attack_requirements_with_defenders(cards, available, &[DefenderId::Player(defending)])
}

/// Compute attack requirements with a full list of possible defenders.
pub fn compute_attack_requirements_with_defenders(
    cards: &[Card],
    available: &[CardId],
    possible_defenders: &[DefenderId],
) -> Vec<AttackRequirement> {
    let mut requirements = Vec::new();

    for &attacker_id in available {
        let card = &cards[attacker_id.index()];

        let must_from_static = static_ability_must_attack::must_attack(cards, card);
        let goaded = card.goaded_by;

        let must_attack_any = must_from_static || goaded.is_some();

        // Build defender_specific map: each defender gets credit for
        // generic "must attack anything" requirements.
        let mut n_attack_anything: i32 = 0;
        if goaded.is_some() {
            n_attack_anything += 1;
        }
        if must_from_static {
            n_attack_anything += 1;
        }

        let mut defender_specific = HashMap::new();
        for &defender in possible_defenders {
            defender_specific.insert(defender, n_attack_anything);
        }

        let goaded_by_player = goaded;
        let defending = possible_defenders
            .iter()
            .find_map(|d| d.as_player())
            .unwrap_or(PlayerId(0));
        let must_attack_defender = if goaded.is_some() && goaded != Some(defending) {
            Some(defending)
        } else {
            None
        };

        if must_attack_any || !defender_specific.is_empty() {
            requirements.push(AttackRequirement {
                attacker: attacker_id,
                must_attack_any,
                must_attack_defender,
                goaded_by: goaded_by_player,
                defender_specific,
            });
        }
    }

    requirements
}

/// Get all creature IDs that must attack (from requirements).
pub fn must_attack_ids(requirements: &[AttackRequirement]) -> Vec<CardId> {
    requirements
        .iter()
        .filter(|r| r.must_attack_any)
        .map(|r| r.attacker)
        .collect()
}
