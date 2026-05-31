use forge_foundation::ZoneType;

use super::{emit_zone_trigger, EffectContext};
use crate::event::RunParams;
use crate::replacement::replacement_handler::{apply_replacements, ReplacementEvent};
use crate::replacement::ReplacementResult;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

/// Build/configure the spell ability after construction.
/// Mirrors Java's `CounterEffect.buildSpellAbility(SpellAbility)`.
///
/// Counter effects target spells or abilities on the stack when they use
/// targeting, matching Java's `TargetRestrictions.setZone(ZoneType.Stack)`.
pub fn build_spell_ability(sa: &mut crate::spellability::SpellAbility) {
    if sa.uses_targeting() {
        if let Some(ref mut tr) = sa.target_restrictions {
            tr.tgt_zone = vec![ZoneType::Stack];
        }
    }
}

/// Check if the "would be destroyed" condition is met for a conditional counter.
/// Mirrors Java's `CounterEffect.checkForConditionWouldDestroy(...)`.
///
/// Some counter effects have conditions like "Counter target spell if it would
/// destroy a permanent you control" (e.g. Rebuff the Wicked). This checks
/// whether the targeted spell would cause destruction.
pub fn check_for_condition_would_destroy(
    game: &crate::game::GameState,
    sa: &SpellAbility,
    target_stack_id: u32,
) -> bool {
    let entry = match game.stack.find_by_id(target_stack_id) {
        Some(e) => e,
        None => return false,
    };

    let targeted_sa = &entry.spell_ability;
    let controller = sa.activating_player;

    // Check if the targeted spell is a Destroy effect aimed at our permanents
    if let Some(api) = targeted_sa.api {
        match api {
            crate::ability::api_type::ApiType::Destroy
            | crate::ability::api_type::ApiType::DestroyAll => {
                // Check if any of our permanents would be affected
                if let Some(target_card) = targeted_sa.target_chosen.target_card {
                    return game.card(target_card).controller == controller;
                }
                // For DestroyAll, check the ValidCards filter
                if let Some(valid) = targeted_sa.ir.valid_cards_selector.as_ref() {
                    let our_permanents =
                        game.cards_in_zone(forge_foundation::ZoneType::Battlefield, controller);
                    return our_permanents.iter().any(|&cid| {
                        crate::ability::ability_utils::matches_valid_cards_selector_opt(
                            Some(valid),
                            game.card(cid),
                            targeted_sa.activating_player,
                        )
                    });
                }
                return true; // Assume it would destroy something
            }
            _ => {}
        }
    }

    false
}

/// SP$ Counter — remove a targeted spell from the stack and put it into
/// its owner's graveyard (or exile, per Destination$ if present).
///
/// Supports `UnlessCost$` — if present, the targeted spell's controller is
/// prompted to pay; if they accept, the spell is NOT countered.
/// Mirrors Java's `CounterEffect.resolve()`.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `CounterEffect` class extending `SpellAbilityEffect`.
#[forge_engine_macros::spell_effect(CounterEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let entry_id = match counter_target_stack_entry_id(ctx, sa) {
        Some(id) => id,
        None => return, // no target chosen
    };

    // Determine destination (default: graveyard).
    let dest_zone = sa.ir.destination_zone.unwrap_or(ZoneType::Graveyard);

    // Check if the spell has a "can't be countered" replacement effect.
    // Find the source card of the targeted stack entry.
    if let Some(entry) = ctx.game.stack.find_by_id(entry_id) {
        if let Some(source_card) = entry.spell_ability.source {
            if sa.ir.remember_for_counter {
                if let Some(source_id) = sa.source {
                    ctx.game
                        .card_mut(source_id)
                        .add_remembered_card(source_card);
                }
            }
            if sa.ir.remember_countered_cmc {
                let cmc = ctx.game.card(source_card).mana_cost.cmc();
                if let Some(source_id) = sa.source {
                    ctx.game.card_mut(source_id).add_remembered_cmc(cmc);
                }
            }
            let mut event = ReplacementEvent::Counter { card: source_card };
            let result = apply_replacements(ctx.game, &mut event);
            if result == ReplacementResult::Replaced {
                return;
            }
        }
    }

    // Remove from stack
    if let Some(entry) = ctx.game.stack.remove_by_id(entry_id) {
        let countered_sa = &entry.spell_ability;
        if let Some(source_card) = countered_sa.source {
            // Only move if the card is still "virtual" (on the stack, zone = None is fine)
            // — it was removed from hand when cast; move it to dest zone now.
            let owner = ctx.game.card(source_card).owner;

            // Remember parameters if needed
            if sa.ir.remember_countered {
                ctx.game
                    .card_mut(sa.source.unwrap())
                    .add_remembered_card(source_card);
            }

            if !countered_sa.is_activated && !countered_sa.is_trigger {
                ctx.move_card(source_card, dest_zone, owner);
                emit_zone_trigger(ctx.trigger_handler, source_card, ZoneType::Stack, dest_zone);
            }

            // Fire Countered trigger
            ctx.trigger_handler.run_trigger(
                TriggerType::Countered,
                RunParams {
                    card: Some(source_card),
                    spell_ability: Some(countered_sa.clone()),
                    cause: Some(sa.clone()),
                    ..Default::default()
                },
                false,
            );
        }
    }
}

fn counter_target_stack_entry_id(ctx: &EffectContext, sa: &SpellAbility) -> Option<u32> {
    if let Some(id) = sa.target_chosen.target_stack_entry {
        return Some(id);
    }

    let defined = sa.defined()?;
    let defined_spells =
        crate::ability::ability_utils::get_defined_spell_abilities(defined, sa, ctx.game);
    let mut candidate_sources: Vec<crate::ids::CardId> = defined_spells
        .iter()
        .filter_map(|defined_sa| defined_sa.source)
        .collect();
    if defined == "TriggeredSpellAbility" || defined == "TriggeredSourceSA" {
        if let Some(source) = sa
            .trigger_objects
            .get(&crate::ability::AbilityKey::Source)
            .and_then(|value| value.parse::<u32>().ok())
            .map(crate::ids::CardId)
        {
            if !candidate_sources.contains(&source) {
                candidate_sources.push(source);
            }
        }
    }

    for defined_sa in defined_spells {
        if let Some(source) = defined_sa.source {
            let stack_entries: Vec<_> = ctx.game.stack.iter().collect();
            for entry in stack_entries.iter().rev() {
                if entry.spell_ability.source == Some(source)
                    && entry.spell_ability.ability_text == defined_sa.ability_text
                {
                    return Some(entry.id);
                }
            }
            for entry in stack_entries.iter().rev() {
                if entry.spell_ability.source == Some(source) {
                    return Some(entry.id);
                }
            }
        }
    }
    for source in candidate_sources {
        let stack_entries: Vec<_> = ctx.game.stack.iter().collect();
        for entry in stack_entries.iter().rev() {
            if entry.spell_ability.source == Some(source) {
                return Some(entry.id);
            }
        }
    }

    None
}
