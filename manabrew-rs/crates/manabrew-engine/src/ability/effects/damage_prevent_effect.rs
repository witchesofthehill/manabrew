//! DamagePrevent effect — prevent the next N damage to a target.
//!
//! Ported from Java's `DamagePreventEffect.java`.
//! Prevent the next N damage that would be dealt to target creature/player.

use forge_foundation::ZoneType;

use super::EffectContext;
use crate::card::card_util;

/// End-of-turn revert for damage prevention. Mirrors the `GameCommand.run()` in Java
/// `DamagePreventEffect` that resets damage prevention shields when the effect expires.
///
/// Resets the `damage_prevention` counter on a card to zero.
pub fn run(game: &mut crate::game::GameState, card_id: crate::ids::CardId) {
    if game.card(card_id).zone == ZoneType::Battlefield {
        game.card_mut(card_id).damage_prevention = 0;
    }
}

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `DamagePreventEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(DamagePreventEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let amount = super::resolve_numeric_svar(ctx.game, sa, "Amount", 1).max(0);

    // Target a player
    if let Some(pid) = sa.target_chosen.target_player {
        ctx.game.player_add_damage_prevention(pid, amount);
        return;
    }

    // Target a creature
    let mut targets = sa.target_chosen.target_card.into_iter().collect::<Vec<_>>();
    targets.extend(card_util::get_radiance(ctx.game, sa).iter().copied());
    targets.sort_unstable_by_key(|cid| cid.0);
    targets.dedup();
    if !targets.is_empty() {
        for cid in targets {
            if ctx.game.card(cid).zone == ZoneType::Battlefield {
                ctx.game.card_mut(cid).damage_prevention += amount;
            }
        }
        return;
    }

    // Self or defined
    if let Some(def) = sa.defined() {
        if def.eq_ignore_ascii_case("You") || def.eq_ignore_ascii_case("Self") {
            let controller = sa.activating_player;
            ctx.game.player_add_damage_prevention(controller, amount);
        }
    }
}
