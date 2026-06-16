//! ImmediateTrigger effect — fire a trigger immediately without waiting.
//!
//! Mirrors Java's `ImmediateTriggerEffect.resolve()` which registers
//! a delayed trigger that fires as soon as possible through normal
//! trigger processing.

use super::EffectContext;
use crate::trigger::DelayedTrigger;
use crate::trigger::TriggerType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ImmediateTriggerEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ImmediateTriggerEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    if let Some(remember_def) = sa.ir.remember_objects.as_deref() {
        if let Some(source_id) = sa.source {
            if remember_def.eq_ignore_ascii_case("Targeted") {
                if let Some(target) = sa.target_chosen.target_card {
                    ctx.game.card_mut(source_id).add_remembered_card(target);
                }
            }
        }
    }

    if let Some(execute_name) = sa.ir.execute.as_deref() {
        if let Some(source_id) = sa.source {
            let svar_text = ctx
                .game
                .card(source_id)
                .get_s_var(execute_name)
                .map(str::to_string);
            if svar_text.is_some() {
                let delayed = DelayedTrigger {
                    mode: TriggerType::Immediate,
                    trigger_mode: Box::new(crate::trigger::trigger_immediate::TriggerImmediate),
                    params: crate::parsing::Params::default(),
                    execute_svar: execute_name.to_string(),
                    controller: sa.activating_player,
                    source_card: source_id,
                    created_turn: ctx.game.turn.turn_number,
                    created_phase: ctx.game.turn.phase,
                    target_card: None,
                    remembered_amount: 0,
                    remembered_cards: Vec::new(),
                    remembered_players: Vec::new(),
                    remembered_lki_cards: Vec::new(),
                    sort_after_active: false,
                    trigger_order: None,
                };
                ctx.trigger_handler.register_delayed_trigger(delayed);
            }
        }
    }
}
