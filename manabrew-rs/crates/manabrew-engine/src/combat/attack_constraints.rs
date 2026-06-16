use std::collections::HashMap;

use super::attack_requirement::{self, AttackRequirement};
use super::attack_restriction::{self, AttackRestrictionType};
use super::global_attack_restrictions::GlobalAttackRestrictions;
use super::DefenderId;
use crate::card::Card;
use crate::ids::{CardId, PlayerId};

/// Constraints on which creatures can and must attack.
/// Mirrors Java's `AttackConstraints.java`.
///
/// Holds per-creature restrictions (can't attack conditions) and requirements
/// (must-attack conditions), plus global attack limits.
#[derive(Debug, Clone)]
pub struct AttackConstraints {
    pub possible_attackers: Vec<CardId>,
    pub possible_defenders: Vec<DefenderId>,
    pub global_restrictions: GlobalAttackRestrictions,
    pub restrictions: HashMap<CardId, AttackRestriction>,
    pub requirements: HashMap<CardId, AttackRequirement>,
}

/// Per-creature attack restriction state.
/// Mirrors Java's `AttackRestriction.java`.
#[derive(Debug, Clone)]
pub struct AttackRestriction {
    pub attacker: CardId,
    pub types: std::collections::HashSet<AttackRestrictionType>,
    pub cant_attack: bool,
    pub cant_attack_defenders: Vec<DefenderId>,
}

impl AttackRestriction {
    pub fn new(
        attacker: CardId,
        cards: &[Card],
        possible_defenders: &[DefenderId],
        game: &crate::game::GameState,
    ) -> Self {
        let card = &cards[attacker.index()];
        let types = attack_restriction::get_restrictions(card);

        // Check which defenders this creature can't attack
        let mut cant_attack_defenders = Vec::new();
        for &defender in possible_defenders {
            if !super::combat_util::can_attack_defender(game, attacker, defender) {
                cant_attack_defenders.push(defender);
            }
        }

        // Java parity: contradictory restrictions or can't-attack-any-defender = can't attack
        let cant_attack = types.contains(&AttackRestrictionType::Never)
            || (types.contains(&AttackRestrictionType::OnlyAlone)
                && (types.contains(&AttackRestrictionType::NeedGreaterPower)
                    || types.contains(&AttackRestrictionType::NeedBlackOrGreen)
                    || types.contains(&AttackRestrictionType::NotAlone)
                    || types.contains(&AttackRestrictionType::NeedTwoOthers)))
            || cant_attack_defenders.len() == possible_defenders.len();

        AttackRestriction {
            attacker,
            types,
            cant_attack,
            cant_attack_defenders,
        }
    }

    /// Can this creature attack the given defender?
    pub fn can_attack(&self, defender: DefenderId) -> bool {
        !self.cant_attack && !self.cant_attack_defenders.contains(&defender)
    }

    /// Can this creature attack the given defender with the given set of
    /// attackers? Checks both per-defender and per-attacker-set violations.
    pub fn can_attack_with(
        &self,
        defender: DefenderId,
        attackers: &[(CardId, DefenderId)],
        cards: &[Card],
    ) -> bool {
        if !self.can_attack(defender) {
            return false;
        }
        self.get_violations(attackers, cards).is_empty()
    }

    /// Get restriction type violations for the given set of attackers.
    pub fn get_violations(
        &self,
        attackers: &[(CardId, DefenderId)],
        cards: &[Card],
    ) -> std::collections::HashSet<AttackRestrictionType> {
        let mut violations = std::collections::HashSet::new();
        let n = attackers.len();

        if self.types.contains(&AttackRestrictionType::OnlyAlone) && n > 1 {
            violations.insert(AttackRestrictionType::OnlyAlone);
        }
        if self.types.contains(&AttackRestrictionType::NotAlone) && n <= 1 {
            violations.insert(AttackRestrictionType::NotAlone);
        }
        if self.types.contains(&AttackRestrictionType::NeedTwoOthers) && n <= 2 {
            violations.insert(AttackRestrictionType::NeedTwoOthers);
        }
        if self
            .types
            .contains(&AttackRestrictionType::NeedGreaterPower)
        {
            let my_power = cards[self.attacker.index()].power();
            let has_greater = attackers
                .iter()
                .any(|&(cid, _)| cid != self.attacker && cards[cid.index()].power() > my_power);
            if !has_greater {
                violations.insert(AttackRestrictionType::NeedGreaterPower);
            }
        }
        if self
            .types
            .contains(&AttackRestrictionType::NeedBlackOrGreen)
        {
            let has_bg = attackers.iter().any(|&(cid, _)| {
                cid != self.attacker && {
                    let c = &cards[cid.index()];
                    c.color.has_black() || c.color.has_green()
                }
            });
            if !has_bg {
                violations.insert(AttackRestrictionType::NeedBlackOrGreen);
            }
        }
        violations
    }

    pub fn get_types(&self) -> &std::collections::HashSet<AttackRestrictionType> {
        &self.types
    }
}

/// Internal helper: an attack candidate with priority from requirements.
#[derive(Debug, Clone)]
struct Attack {
    attacker: CardId,
    defender: DefenderId,
    requirements: i32,
}

impl AttackConstraints {
    /// Build constraints for a combat phase.
    /// `attacking_player` is the player declaring attacks.
    pub fn new(
        game: &crate::game::GameState,
        attacking_player: PlayerId,
        possible_defenders: &[DefenderId],
    ) -> Self {
        let possible_attackers: Vec<CardId> = game
            .creatures_on_battlefield(attacking_player)
            .into_iter()
            .collect();

        let global_restrictions = GlobalAttackRestrictions::get_global_restrictions(
            &game.cards,
            attacking_player,
            possible_defenders,
        );

        let mut restrictions = HashMap::new();
        let mut requirements = HashMap::new();

        for &attacker in &possible_attackers {
            restrictions.insert(
                attacker,
                AttackRestriction::new(attacker, &game.cards, possible_defenders, game),
            );
        }

        let reqs = attack_requirement::compute_attack_requirements_with_defenders(
            &game.cards,
            &possible_attackers,
            possible_defenders,
        );
        for req in reqs {
            requirements.insert(req.attacker, req);
        }

        AttackConstraints {
            possible_attackers,
            possible_defenders: possible_defenders.to_vec(),
            global_restrictions,
            restrictions,
            requirements,
        }
    }

    pub fn get_restrictions(&self) -> &HashMap<CardId, AttackRestriction> {
        &self.restrictions
    }

    pub fn get_global_restrictions(&self) -> &GlobalAttackRestrictions {
        &self.global_restrictions
    }

    pub fn get_requirements(&self) -> &HashMap<CardId, AttackRequirement> {
        &self.requirements
    }

    /// Get a set of legal attackers that minimizes requirement violations.
    /// Returns `(attack_map, violation_count)`.
    ///
    /// Mirrors Java's `getLegalAttackers()`. This is a simplified port that
    /// handles the most common cases (single-creature requirements, global
    /// limits). The full recursive constraint solver from Java is replaced
    /// with a greedy approach that works correctly for 2-player games.
    pub fn get_legal_attackers(&self, cards: &[Card]) -> (Vec<(CardId, DefenderId)>, i32) {
        let max = self
            .global_restrictions
            .get_max()
            .unwrap_or(i32::MAX)
            .min(self.possible_attackers.len() as i32);

        if max == 0 {
            return (Vec::new(), 0);
        }

        // Build sorted requirement list (highest priority first)
        let mut reqs = self.get_sorted_filtered_requirements(cards);

        // Remove creatures that can't possibly attack
        reqs.retain(|a| {
            let restriction = self.restrictions.get(&a.attacker);
            if let Some(r) = restriction {
                if r.cant_attack {
                    return false;
                }
                let types = &r.types;
                // Creatures with unfulfillable co-attacker requirements
                if (types.contains(&AttackRestrictionType::NeedTwoOthers) && max <= 2)
                    || (types.contains(&AttackRestrictionType::NotAlone) && max <= 1)
                    || (types.contains(&AttackRestrictionType::NeedBlackOrGreen) && max <= 1)
                    || (types.contains(&AttackRestrictionType::NeedGreaterPower) && max <= 1)
                {
                    return false;
                }
            }
            true
        });

        // Try "only alone" creatures first (they must attack solo)
        let mut best_result: Option<(Vec<(CardId, DefenderId)>, i32)> = None;

        for req in &reqs {
            if let Some(r) = self.restrictions.get(&req.attacker) {
                if r.types.contains(&AttackRestrictionType::OnlyAlone) && req.requirements > 0 {
                    let attack_map = vec![(req.attacker, req.defender)];
                    let violations = self.count_violations(&attack_map, cards);
                    if violations != -1 {
                        match &best_result {
                            None => best_result = Some((attack_map, violations)),
                            Some((_, best_v)) if violations < *best_v => {
                                best_result = Some((attack_map, violations));
                            }
                            _ => {}
                        }
                    }
                }
            }
        }

        // Remove only-alone attackers from normal pool
        reqs.retain(|a| {
            self.restrictions
                .get(&a.attacker)
                .is_none_or(|r| !r.types.contains(&AttackRestrictionType::OnlyAlone))
        });

        // Greedy: add creatures with requirements in priority order
        let mut attack_map: Vec<(CardId, DefenderId)> = Vec::new();
        let mut used: std::collections::HashSet<CardId> = std::collections::HashSet::new();
        let mut remaining_max = max;

        for req in &reqs {
            if remaining_max <= 0 {
                break;
            }
            if used.contains(&req.attacker) {
                continue;
            }
            if req.requirements == 0 {
                continue;
            }

            // Check per-defender limit
            if let Some(&def_max) = self
                .global_restrictions
                .get_defender_max()
                .get(&req.defender)
            {
                let count = attack_map
                    .iter()
                    .filter(|(_, d)| *d == req.defender)
                    .count() as i32;
                if count >= def_max {
                    continue;
                }
            }

            attack_map.push((req.attacker, req.defender));
            used.insert(req.attacker);
            remaining_max -= 1;
        }

        let greedy_violations = self.count_violations(&attack_map, cards);
        if greedy_violations != -1 {
            match &best_result {
                None => best_result = Some((attack_map.clone(), greedy_violations)),
                Some((_, best_v)) if greedy_violations < *best_v => {
                    best_result = Some((attack_map.clone(), greedy_violations));
                }
                _ => {}
            }
        }

        // Also try empty attack
        let empty_violations = self.count_violations(&[], cards);
        if empty_violations != -1 {
            match &best_result {
                None => best_result = Some((Vec::new(), empty_violations)),
                Some((_, best_v)) if empty_violations < *best_v => {
                    best_result = Some((Vec::new(), empty_violations));
                }
                _ => {}
            }
        }

        best_result.unwrap_or((Vec::new(), 0))
    }

    /// Count the number of requirement violations for a proposed attack set.
    /// Returns -1 if a restriction is violated (illegal attack).
    ///
    /// Mirrors Java's `countViolations()`.
    pub fn count_violations(&self, attackers: &[(CardId, DefenderId)], cards: &[Card]) -> i32 {
        if !self.global_restrictions.is_legal(attackers) {
            return -1;
        }

        // Check per-creature restrictions
        for &(attacker_id, defender) in attackers {
            if let Some(restriction) = self.restrictions.get(&attacker_id) {
                if !restriction.can_attack_with(defender, attackers, cards) {
                    return -1;
                }
            }
        }

        // Count requirement violations
        let mut violations = 0;
        for &possible_attacker in &self.possible_attackers {
            if let Some(requirement) = self.requirements.get(&possible_attacker) {
                let defender = attackers
                    .iter()
                    .find(|(a, _)| *a == possible_attacker)
                    .map(|(_, d)| *d);
                violations += requirement.count_violations(defender);
            }
        }

        violations
    }

    /// Build a sorted list of attack candidates from requirements.
    /// Higher-priority (more requirements) come first.
    fn get_sorted_filtered_requirements(&self, _cards: &[Card]) -> Vec<Attack> {
        let mut result = Vec::new();

        for (&attacker_id, req) in &self.requirements {
            let restriction = self.restrictions.get(&attacker_id);
            let sorted_reqs = req.get_sorted_requirements();

            for (defender, count) in sorted_reqs {
                let can_attack = restriction.is_none_or(|r| r.can_attack(defender));
                if can_attack {
                    result.push(Attack {
                        attacker: attacker_id,
                        defender,
                        requirements: count,
                    });
                }
            }
        }

        // Sort descending by requirements (highest priority first)
        result.sort_by(|a, b| b.requirements.cmp(&a.requirements));
        result
    }
}
