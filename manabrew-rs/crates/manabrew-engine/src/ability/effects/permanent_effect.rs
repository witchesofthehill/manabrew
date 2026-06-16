//! PermanentEffect — move spell to battlefield.
//!
//! Mirrors Java's `PermanentEffect.java`.
//! Handles moving a spell from the stack to the battlefield as a permanent.
//! This is the parent logic for both PermanentCreatureEffect and
//! PermanentNoncreatureEffect.

use forge_foundation::ZoneType;

use super::EffectContext;
use crate::parsing::keys;
use crate::spellability::SpellAbility;

/// Resolve a permanent entering the battlefield.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `PermanentEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(PermanentEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    resolve_permanent_common(ctx, sa);
}

/// Shared implementation for Permanent, PermanentCreature and PermanentNoncreature.
/// Both extend PermanentEffect in Java, which simply moves the host to play.
pub fn resolve_permanent_common(ctx: &mut EffectContext, sa: &SpellAbility) {
    let source = match sa.source {
        Some(s) => s,
        None => return,
    };

    let controller = sa.activating_player;

    // Check if it should enter tapped (sneak/dash)
    if sa.param_is_true(keys::SNEAK) || sa.param_is_true(keys::TAPPED) {
        ctx.game.card_mut(source).set_tapped(true);
    }

    // Move host card to battlefield.
    //
    // Java parity: PermanentEffect.resolve() calls game.getAction().moveToPlay
    // which moves the card AND fires the ChangesZone trigger as a single op.
    // In Rust the corresponding `emit_zone_trigger` lives at the spell
    // resolution site (game_loop/stack_resolution.rs after move_card_with_runtime),
    // so we must NOT emit here — doing so double-fires the ETB trigger
    // (e.g. Rottenmouth Viper enters → 2 PutCounter + 2 DBRepeat iterations).
    let old_zone = ctx.game.card(source).zone;
    if old_zone != ZoneType::Battlefield {
        ctx.game
            .move_card(source, ZoneType::Battlefield, controller);
    }
}
