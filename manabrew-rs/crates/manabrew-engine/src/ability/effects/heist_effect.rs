//! Heist effect — exile cards from opponent's library, may cast them.
//!
//! Ported from Java's `HeistEffect.java`.
//! Heist: Exile the top card of target opponent's library face-down.
//! You may look at and cast that card for as long as it remains exiled.

use forge_foundation::ZoneType;

use super::{emit_zone_trigger, EffectContext};

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `HeistEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(HeistEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;
    let num = super::resolve_numeric_svar(ctx.game, sa, "Num", 1).max(0) as usize;

    let target_player = sa
        .target_chosen
        .target_player
        .unwrap_or_else(|| ctx.game.opponent_of(controller));

    // Exile top N cards from target's library face-down
    for _ in 0..num {
        let lib = ctx
            .game
            .cards_in_zone(ZoneType::Library, target_player)
            .to_vec();
        let Some(&top) = lib.last() else { break };

        let old_zone = ctx.game.card(top).zone;
        ctx.game.card_mut(top).set_face_down(true);
        ctx.move_card(top, ZoneType::Exile, target_player);

        // Mark with exiled_by so controller can look at and cast it
        if let Some(sid) = sa.source {
            ctx.game.card_mut(top).set_exiled_by(Some(sid));
        }

        emit_zone_trigger(ctx.trigger_handler, top, old_zone, ZoneType::Exile);
    }
}
