use super::EffectContext;
use crate::ids::CardId;
use crate::parsing::keys;
use crate::replacement::replacement_handler::{apply_replacements, ReplacementEvent};
use crate::replacement::ReplacementResult;
use crate::spellability::SpellAbilityMode;

/// Mirrors Java's `SetStateEffect.java`.
///
/// `DB$ SetState | Defined$ Self | Mode$ Transform`
///
/// Optionally gated by:
///   `ConditionDefined$ Remembered | ConditionPresent$ Card.Instant,Card.Sorcery | ConditionCompare$ EQ1`
///
/// If the condition passes, transforms the source DFC card to its other face.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `SetStateEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(SetStateEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let mode = sa.ir.mode.as_ref();

    let source_id = match sa.source {
        Some(id) => id,
        None => return,
    };

    match mode {
        Some(SpellAbilityMode::Transform) => {
            // Evaluate optional condition.
            if let Some(cond_defined) = sa.ir.condition_defined.as_ref() {
                if cond_defined.refs.first().is_some_and(|defined| {
                    matches!(defined, crate::ability::ability_ir::DefinedRef::Remembered)
                }) {
                    let cond_present = sa.ir.condition_present.clone().unwrap_or_default();
                    let cond_compare = sa.ir.condition_compare.clone().unwrap_or_default();

                    let remembered: Vec<CardId> = ctx.game.card(source_id).remembered_cards.clone();
                    let match_count = remembered
                        .iter()
                        .filter(|&&cid| matches_type_filter(ctx, cid, &cond_present))
                        .count();

                    if !evaluate_compare(&cond_compare, match_count) {
                        return; // Condition not met.
                    }
                }
            }

            // Run Transform replacement effects before transforming.
            let mut transform_event = ReplacementEvent::Transform { card: source_id };
            let transform_result = apply_replacements(ctx.game, &mut transform_event);
            if transform_result == ReplacementResult::Skipped
                || transform_result == ReplacementResult::Replaced
            {
                return;
            }

            // Perform the transform.
            ctx.game.card_mut(source_id).transform();

            // Fire Transformed trigger
            ctx.trigger_handler.run_trigger(
                crate::trigger::TriggerType::Transformed,
                crate::event::RunParams {
                    card: Some(source_id),
                    ..Default::default()
                },
                false,
            );

            // Re-scan active triggers so the new face's trigger list takes effect.
            ctx.trigger_handler.reset_active_triggers(ctx.game);
        }
        Some(SpellAbilityMode::Flip) => {
            // Toggle the flipped state.
            let card = ctx.game.card_mut(source_id);
            card.set_flipped(!card.flipped);
        }
        Some(SpellAbilityMode::TurnFaceUp) => {
            // Run TurnFaceUp replacement effects before turning face up.
            let mut faceup_event = ReplacementEvent::TurnFaceUp { card: source_id };
            let faceup_result = apply_replacements(ctx.game, &mut faceup_event);
            if faceup_result == ReplacementResult::Skipped
                || faceup_result == ReplacementResult::Replaced
            {
                return;
            }

            let card = ctx.game.card_mut(source_id);
            if card.face_down {
                card.set_face_down(false);
                // Restore original P/T by clearing the face-down overrides
                card.set_static_set_pt(None, None);

                // Remove the synthetic morph turn-face-up ability
                card.activated_abilities
                    .retain(|ab| !ab.ability_text.contains("Mode$ TurnFaceUp"));

                // Megamorph: add a +1/+1 counter when turning face-up
                if sa.param_is_true(keys::MEGA) {
                    card.add_counter(&crate::card::CounterType::P1P1, 1);
                }

                // Fire TurnFaceUp trigger
                ctx.trigger_handler.run_trigger(
                    crate::trigger::TriggerType::TurnFaceUp,
                    crate::event::RunParams {
                        card: Some(source_id),
                        ..Default::default()
                    },
                    false,
                );

                // Re-scan active triggers for the revealed card
                ctx.trigger_handler.reset_active_triggers(ctx.game);
            }
        }
        Some(SpellAbilityMode::TurnFaceDown) => {
            let card = ctx.game.card_mut(source_id);
            if !card.face_down {
                card.set_face_down(true);
            }
        }
        _ => {
            let err = crate::ability::IllegalAbilityException::new(format!(
                "Unknown SetState mode: {:?}",
                mode.map(ToString::to_string)
            ));
            eprintln!("{}", err);
        }
    }
}

/// Check if a card matches a comma-separated type filter (OR semantics).
/// E.g. `"Card.Instant,Card.Sorcery"` → true if the card is an Instant or Sorcery.
fn matches_type_filter(ctx: &EffectContext, card_id: CardId, filter: &str) -> bool {
    if filter.is_empty() {
        return true;
    }
    for part in filter.split(',') {
        let type_name = part.trim().strip_prefix("Card.").unwrap_or(part.trim());
        let card = ctx.game.card(card_id);
        if card
            .type_line
            .core_types
            .iter()
            .any(|t| t.name().eq_ignore_ascii_case(type_name))
        {
            return true;
        }
    }
    false
}

/// Evaluate a `ConditionCompare` expression (e.g. `"EQ1"`, `"GT0"`) against a count.
fn evaluate_compare(compare: &str, count: usize) -> bool {
    if compare.len() < 3 {
        return true;
    }
    let op = &compare[..2];
    let num: usize = compare[2..].parse().unwrap_or(0);
    match op {
        "EQ" => count == num,
        "GT" => count > num,
        "GE" => count >= num,
        "LT" => count < num,
        "LE" => count <= num,
        "NE" => count != num,
        _ => true,
    }
}
