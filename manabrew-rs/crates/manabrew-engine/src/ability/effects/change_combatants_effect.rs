//! ChangeCombatants effect — modify combat participants.
//!
//! Ported from Java's `ChangeCombatantsEffect.java`.
//! Add or remove creatures from combat.

use forge_foundation::ZoneType;

use super::EffectContext;
use crate::ability::api_type::ApiType;
use crate::parsing::keys;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ChangeCombatantsEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ChangeCombatantsEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let targets: Vec<crate::ids::CardId> = if sa.uses_targeting() {
        sa.target_chosen.target_card.into_iter().collect()
    } else {
        sa.source.into_iter().collect()
    };

    for card_id in targets {
        if ctx.game.card(card_id).zone != ZoneType::Battlefield {
            continue;
        }
        if sa.ir.optional_present {
            let card_name = ctx.game.card(card_id).card_name.clone();
            let accepted = ctx.agents[sa.activating_player.index()].confirm_action(
                sa.activating_player,
                Some("ChangeCombatants"),
                &format!("Reselect the defender of {card_name}?"),
                &[],
                Some(card_id),
                Some(ApiType::ChangeCombatants),
            );
            if !accepted {
                continue;
            }
        }

        let original_defender = ctx
            .combat
            .as_deref()
            .and_then(|combat| {
                combat
                    .attackers
                    .iter()
                    .find(|(attacker, _)| *attacker == card_id)
            })
            .map(|(_, defender)| *defender);

        if sa.param_is_true(keys::REMOVE_FROM_COMBAT) {
            if let Some(combat) = ctx.combat.as_deref_mut() {
                combat.remove_from_combat(card_id, ctx.game);
            } else {
                ctx.game.card_mut(card_id).clear_attacking_player();
            }
        }
        if super::add_to_combat(ctx, sa, card_id, keys::ATTACKING) {
            let new_defender_player = ctx
                .combat
                .as_deref()
                .and_then(|combat| {
                    combat
                        .attackers
                        .iter()
                        .find(|(attacker, _)| *attacker == card_id)
                })
                .map(|(_, defender)| defender.controlling_player(ctx.game));

            for entry in ctx.game.stack.iter_mut() {
                if !entry.spell_ability.is_trigger {
                    continue;
                }
                if entry.spell_ability.source != Some(card_id) {
                    continue;
                }
                if !entry
                    .spell_ability
                    .trigger_objects
                    .contains_key(&crate::ability::AbilityKey::Attacker)
                {
                    continue;
                }

                if let Some(original) = original_defender {
                    match original {
                        crate::combat::DefenderId::Player(pid) => {
                            entry.set_triggering_object(
                                crate::ability::AbilityKey::OriginalDefender,
                                &pid.0.to_string(),
                            );
                        }
                        crate::combat::DefenderId::Permanent(cid) => {
                            entry.set_triggering_object(
                                crate::ability::AbilityKey::OriginalDefender,
                                &cid.0.to_string(),
                            );
                        }
                    }
                }
                if let Some(defending_player) = new_defender_player {
                    entry.update_triggering_object(
                        "DefendingPlayer",
                        &defending_player.0.to_string(),
                    );
                }
            }
        }
    }
}
