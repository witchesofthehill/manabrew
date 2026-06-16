//! ChaosEnsues — trigger chaos ability in Planechase.
//! Ported from Java's ChaosEnsuesEffect: fires the ChaosEnsues trigger
//! which causes all Planechase chaos abilities to trigger.

use super::EffectContext;
use crate::event::RunParams;
use crate::trigger::TriggerType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ChaosEnsuesEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ChaosEnsuesEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    // Fire the ChaosEnsues trigger — Planechase chaos abilities listen for this
    ctx.trigger_handler.run_trigger(
        TriggerType::ChaosEnsues,
        RunParams {
            player: Some(sa.activating_player),
            ..Default::default()
        },
        false,
    );
}
