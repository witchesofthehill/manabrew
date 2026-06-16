//! Planeswalk — move to a new plane (Planechase).
//! Ported from Java's PlaneswalkEffect: leaves current plane, moves to new one.
//! Planechase format support — fires trigger for plane change.

use super::EffectContext;
use crate::event::RunParams;
use crate::replacement::replacement_handler::{apply_replacements, ReplacementEvent};
use crate::replacement::ReplacementResult;
use crate::trigger::TriggerType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `PlaneswalkEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(PlaneswalkEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    // Run Planeswalk replacement effects before planeswalking.
    let mut event = ReplacementEvent::Planeswalk {
        player: sa.activating_player,
    };
    let result = apply_replacements(ctx.game, &mut event);
    if result == ReplacementResult::Skipped || result == ReplacementResult::Replaced {
        return;
    }

    // Fire Planeswalk trigger
    ctx.trigger_handler.run_trigger(
        TriggerType::Planeswalk,
        RunParams {
            player: Some(sa.activating_player),
            ..Default::default()
        },
        false,
    );
}
