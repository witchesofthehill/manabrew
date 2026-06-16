//! SetInMotion — set a scheme in motion (Archenemy).
//! Ported from Java's SetInMotionEffect: activates the top scheme card
//! from the scheme deck.

use forge_foundation::ZoneType;

use super::EffectContext;
use crate::event::RunParams;
use crate::replacement::replacement_handler::{apply_replacements, ReplacementEvent};
use crate::replacement::ReplacementResult;
use crate::trigger::TriggerType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `SetInMotionEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(SetInMotionEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;

    // Run SetInMotion replacement effects before setting in motion.
    let mut event = ReplacementEvent::SetInMotion { player: controller };
    let result = apply_replacements(ctx.game, &mut event);
    if result == ReplacementResult::Skipped || result == ReplacementResult::Replaced {
        return;
    }

    let repeats = super::resolve_numeric_svar(ctx.game, sa, "RepeatNum", 1).max(1);

    for _ in 0..repeats {
        // Find top card of scheme deck (stored in Command zone with scheme type)
        let scheme = ctx
            .game
            .cards
            .iter()
            .find(|c| {
                c.owner == controller
                    && c.zone == ZoneType::Command
                    && c.type_line
                        .subtypes
                        .iter()
                        .any(|s| s.eq_ignore_ascii_case("Scheme"))
            })
            .map(|c| c.id);

        if let Some(scheme_id) = scheme {
            // Fire SetInMotion trigger
            ctx.trigger_handler.run_trigger(
                TriggerType::SetInMotion,
                RunParams {
                    card: Some(scheme_id),
                    player: Some(controller),
                    ..Default::default()
                },
                false,
            );
        }
    }
}
