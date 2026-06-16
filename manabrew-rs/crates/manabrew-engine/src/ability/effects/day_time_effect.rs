//! DayTime effect — switch between Day and Night.
//!
//! Ported 1:1 from Java's `DayTimeEffect.java`.
//! Day/Night cycle: set the game to Day, Night, or Switch.

use super::EffectContext;
use crate::ability::ability_ir::DayTimeValue;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `DayTimeEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(DayTimeEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    match sa.ir.day_time_value {
        Some(DayTimeValue::Day) => {
            ctx.game.day_night_started = true;
            ctx.game.is_night = false;
        }
        Some(DayTimeValue::Night) => {
            ctx.game.day_night_started = true;
            ctx.game.is_night = true;
        }
        Some(DayTimeValue::Switch) => {
            ctx.game.day_night_started = true;
            ctx.game.is_night = !ctx.game.is_night;
        }
        None => {}
    }

    // Day/Night changes trigger DFC transformations — handled by the game loop's
    // state-based actions which check is_night against each DFC card.
}
