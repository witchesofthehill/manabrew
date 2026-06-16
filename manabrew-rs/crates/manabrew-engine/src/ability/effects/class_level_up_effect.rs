//! ClassLevelUp effect — increase a Class enchantment's level.
//!
//! Ported 1:1 from Java's `ClassLevelUpEffect.java`.
//! Level up: Increment the Class enchantment's level, activating the
//! next tier of static abilities and triggers.

use super::EffectContext;
use crate::event::RunParams;
use crate::staticability::layer::apply_continuous_effects;
use crate::trigger::TriggerType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ClassLevelUpEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ClassLevelUpEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let Some(host_id) = sa.source else { return };

    let current_level = ctx.game.card(host_id).class_level;
    if let Some(required) = sa
        .restriction
        .variables
        .class_level_operator()
        .zip(sa.restriction.variables.class_level())
    {
        let (operator, operand) = required;
        let expr = format!("{operator}{operand}");
        if !crate::parsing::compare::compare_expr(current_level, &expr) {
            return;
        }
    }
    let new_level = current_level + 1;

    ctx.game.card_mut(host_id).set_class_level(new_level);

    // Class level gates are implemented as continuous/static text changes.
    // Rebuild those before re-registering triggers so newly unlocked
    // ClassLevelGained / end-step abilities actually exist on the card.
    apply_continuous_effects(ctx.game);
    ctx.trigger_handler.unregister_active_triggers(host_id);
    ctx.trigger_handler
        .register_active_trigger(ctx.game, host_id);
    ctx.trigger_handler.run_trigger(
        TriggerType::ClassLevelGained,
        RunParams {
            card: Some(host_id),
            class_level: Some(new_level),
            ..Default::default()
        },
        false,
    );
}
