use std::collections::HashSet;

use forge_foundation::ZoneType;

use crate::card::Card;
use crate::ids::CardId;
use crate::staticability::StaticMode;

pub use super::attack_restriction_type::AttackRestrictionType;

/// Parse attack restrictions from a creature's keywords.
/// Mirrors Java's `AttackRestriction.setRestrictions()` — matches exact keyword strings.
pub fn get_restrictions(card: &Card) -> HashSet<AttackRestrictionType> {
    let mut restrictions = HashSet::new();

    for kw in card
        .keywords
        .iter_strings()
        .chain(card.granted_keywords.iter_strings())
        .chain(card.pump_keywords.iter_strings())
    {
        // Java matches on exact keyword strings with "CARDNAME" prefix stripped.
        // We use contains() on lowercased text for flexibility.
        let kw_lower = kw.to_lowercase();

        if kw_lower.contains("can only attack alone") {
            restrictions.insert(AttackRestrictionType::OnlyAlone);
        }
        if kw_lower.contains("can't attack alone")
            || kw_lower.contains("can't attack or block alone")
        {
            restrictions.insert(AttackRestrictionType::NotAlone);
        }
        if kw_lower.contains("can't attack unless a creature with greater power also attacks") {
            restrictions.insert(AttackRestrictionType::NeedGreaterPower);
        }
        if kw_lower.contains("can't attack unless a black or green creature also attacks") {
            restrictions.insert(AttackRestrictionType::NeedBlackOrGreen);
        }
        if kw_lower.contains("can't attack unless at least two other creatures attack") {
            restrictions.insert(AttackRestrictionType::NeedTwoOthers);
        }
    }

    // Check static abilities for CantAttack with restriction subtypes
    for st_ab in &card.static_abilities {
        if st_ab.check_mode(&StaticMode::CantAttack) {
            if let Some(restriction) = st_ab.ir.restriction_text.as_deref() {
                match restriction {
                    "OnlyAlone" => {
                        restrictions.insert(AttackRestrictionType::OnlyAlone);
                    }
                    "NotAlone" => {
                        restrictions.insert(AttackRestrictionType::NotAlone);
                    }
                    "NeedGreaterPower" => {
                        restrictions.insert(AttackRestrictionType::NeedGreaterPower);
                    }
                    "NeedBlackOrGreen" => {
                        restrictions.insert(AttackRestrictionType::NeedBlackOrGreen);
                    }
                    "NeedTwoOthers" => {
                        restrictions.insert(AttackRestrictionType::NeedTwoOthers);
                    }
                    "Never" => {
                        restrictions.insert(AttackRestrictionType::Never);
                    }
                    _ => {}
                }
            }
        }
    }

    // Java parity: contradictory restrictions mean creature can never attack.
    // OnlyAlone + any of (NeedGreaterPower, NeedBlackOrGreen, NotAlone, NeedTwoOthers) = impossible.
    if restrictions.contains(&AttackRestrictionType::OnlyAlone)
        && (restrictions.contains(&AttackRestrictionType::NeedGreaterPower)
            || restrictions.contains(&AttackRestrictionType::NeedBlackOrGreen)
            || restrictions.contains(&AttackRestrictionType::NotAlone)
            || restrictions.contains(&AttackRestrictionType::NeedTwoOthers))
    {
        restrictions.insert(AttackRestrictionType::Never);
    }

    restrictions
}

/// Check if a creature can attack given its restrictions and the number of
/// other attackers. Mirrors Java's `AttackRestriction.canAttack()`.
pub fn can_attack(card: &Card, num_attackers: usize) -> bool {
    let restrictions = get_restrictions(card);

    if restrictions.contains(&AttackRestrictionType::Never) {
        return false;
    }
    if restrictions.contains(&AttackRestrictionType::OnlyAlone) && num_attackers > 1 {
        return false;
    }
    if restrictions.contains(&AttackRestrictionType::NotAlone) && num_attackers <= 1 {
        return false;
    }
    if restrictions.contains(&AttackRestrictionType::NeedTwoOthers) && num_attackers <= 2 {
        return false;
    }
    true
}

/// Validate chosen attackers against attack restrictions.
/// Returns a set of attacker IDs that are illegal and should be removed.
///
/// Mirrors Java's `AttackRestriction.getViolation()` — checks restrictions
/// against the set of all chosen attackers (not just battlefield state).
pub fn validate_attack_restrictions(attackers: &[CardId], cards: &[Card]) -> HashSet<CardId> {
    let mut illegal = HashSet::new();
    let num_attackers = attackers.len();

    for &attacker_id in attackers {
        let card = &cards[attacker_id.index()];
        if card.zone != ZoneType::Battlefield {
            illegal.insert(attacker_id);
            continue;
        }
        let restrictions = get_restrictions(card);

        // Never: can never attack
        if restrictions.contains(&AttackRestrictionType::Never) {
            illegal.insert(attacker_id);
            continue;
        }

        // OnlyAlone: can only attack if it's the sole attacker
        if restrictions.contains(&AttackRestrictionType::OnlyAlone) && num_attackers > 1 {
            illegal.insert(attacker_id);
            continue;
        }

        // NotAlone: can't attack alone
        if restrictions.contains(&AttackRestrictionType::NotAlone) && num_attackers <= 1 {
            illegal.insert(attacker_id);
            continue;
        }

        // NeedTwoOthers: needs at least two other attackers
        if restrictions.contains(&AttackRestrictionType::NeedTwoOthers)
            && (num_attackers as i32 - 1) < 2
        {
            illegal.insert(attacker_id);
            continue;
        }

        // NeedGreaterPower: another *attacking* creature must have greater power.
        // Java: checks attackers.keySet() with predicate hasGreaterPowerThan(attacker.getNetPower()).
        if restrictions.contains(&AttackRestrictionType::NeedGreaterPower) {
            let my_power = card.power();
            let has_greater = attackers.iter().any(|&other_id| {
                other_id != attacker_id && cards[other_id.index()].power() > my_power
            });
            if !has_greater {
                illegal.insert(attacker_id);
                continue;
            }
        }

        // NeedBlackOrGreen: another *attacking* creature must be black or green.
        if restrictions.contains(&AttackRestrictionType::NeedBlackOrGreen) {
            let has_bg = attackers.iter().any(|&other_id| {
                if other_id == attacker_id {
                    return false;
                }
                let other = &cards[other_id.index()];
                other.color.has_black() || other.color.has_green()
            });
            if !has_bg {
                illegal.insert(attacker_id);
                continue;
            }
        }
    }

    // Second pass: re-check after removing illegals (for NotAlone/NeedTwoOthers counts)
    let remaining: Vec<CardId> = attackers
        .iter()
        .copied()
        .filter(|id| !illegal.contains(id))
        .collect();
    let remaining_count = remaining.len();

    for &attacker_id in &remaining {
        let card = &cards[attacker_id.index()];
        let restrictions = get_restrictions(card);

        if restrictions.contains(&AttackRestrictionType::NotAlone) && remaining_count <= 1 {
            illegal.insert(attacker_id);
        }
        if restrictions.contains(&AttackRestrictionType::NeedTwoOthers)
            && (remaining_count as i32 - 1) < 2
        {
            illegal.insert(attacker_id);
        }
    }

    illegal
}
