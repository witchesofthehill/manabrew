//! AI logic for equipment attachment decisions.
//!
//! Mirrors Java `forge/forge-ai/src/main/java/forge/ai/ability/AttachAi.java`.
//! Determines whether the AI should offer an equip ability or skip it.

use forge_foundation::ZoneType;

use crate::card::Card;
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};

use super::creature_evaluator;

/// Default threshold for re-equipping: the new creature must score at least
/// this many points better than the currently equipped creature.
///
/// Mirrors Java `AiProps.MOVE_EQUIPMENT_CREATURE_EVAL_THRESHOLD` (default 40).
const MOVE_EQUIPMENT_CREATURE_EVAL_THRESHOLD: i32 = 40;

/// Returns `true` if the equip ability on `equipment_id` should be skipped
/// (i.e., the AI would not play it because re-equipping is not worthwhile).
///
/// Mirrors Java `AttachAi.attachToCardAIPreferences()` lines 1348-1394:
/// - Don't equip the same creature again
/// - Don't move equipment if the current creature is still useful and no
///   significantly better target exists
/// - Don't move equipment if it was already moved this turn
///
/// Returns `false` (don't skip) when:
/// - Equipment is not currently attached (needs equipping)
/// - Equipment is attached to opponent's creature (need to re-equip)
/// - There's a significantly better creature to equip to
pub fn should_skip_equip(game: &GameState, equipment_id: CardId, player: PlayerId) -> bool {
    let equipment = game.card(equipment_id);

    // If equipment is not currently attached, always offer equip
    let equipped_to = match equipment.attached_to {
        Some(id) => id,
        None => return false,
    };

    let equipped_creature = game.card(equipped_to);

    // If equipped creature is not on the battlefield, don't skip (need to re-equip)
    if equipped_creature.zone != ZoneType::Battlefield {
        return false;
    }

    // If equipped to opponent's creature, don't skip (want to re-equip to own)
    if equipped_creature.controller != player {
        return false;
    }

    // If equipment was already moved this turn, skip to avoid ping-ponging.
    // Mirrors Java `AiCardMemory.isRememberedCard(ATTACHED_THIS_TURN)`.
    if equipment.attached_this_turn {
        return true;
    }

    // Evaluate the currently equipped creature
    let current_eval = creature_evaluator::evaluate_creature(equipped_creature);
    let current_is_useless = creature_evaluator::is_useless_creature(equipped_creature);

    // If current creature is useless, allow re-equip (don't skip)
    if current_is_useless {
        return false;
    }

    // Check if any valid target creature is significantly better.
    // Mirrors Java: `evaluateCreature(new) - evaluateCreature(old) >= threshold`
    let battlefield = game.cards_in_zone(ZoneType::Battlefield, player);
    let has_better_target = battlefield.iter().any(|&cid| {
        if cid == equipped_to {
            return false; // Don't compare to self
        }
        let candidate = game.card(cid);
        if !candidate.is_creature() {
            return false;
        }
        if candidate.zone != ZoneType::Battlefield {
            return false;
        }
        let candidate_eval = creature_evaluator::evaluate_creature(candidate);
        candidate_eval - current_eval >= MOVE_EQUIPMENT_CREATURE_EVAL_THRESHOLD
    });

    // If no significantly better target, skip equip
    !has_better_target
}

/// Check if an activated ability is an equip/attach ability.
///
/// Identifies equip abilities by checking if the ability text contains
/// "Attach" as the API type and the source card is an Equipment.
pub fn is_equip_ability(card: &Card, ability_text: &str) -> bool {
    if !card.type_line.has_subtype("Equipment") {
        return false;
    }
    // Check for AB$ Attach (equip activated ability)
    ability_text.contains("AB$ Attach")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn threshold_is_positive() {
        assert!(MOVE_EQUIPMENT_CREATURE_EVAL_THRESHOLD > 0);
    }
}
