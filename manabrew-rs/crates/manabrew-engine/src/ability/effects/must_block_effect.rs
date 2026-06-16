use forge_foundation::ZoneType;

use super::{matches_valid_cards_for_sa, EffectContext};
use crate::ids::CardId;

/// End-of-turn revert for must-block. Mirrors the `GameCommand.run()` in Java
/// `MustBlockEffect` that clears the must-block flag when the effect expires.
pub fn run(game: &mut crate::game::GameState, card_id: crate::ids::CardId) {
    if game.card(card_id).zone == ZoneType::Battlefield {
        game.card_mut(card_id).set_must_block(false);
    }
}

/// `SP$ MustBlock` — target creature must block this turn if able.
///
/// Mirrors Java's `MustBlockEffect.java` (simplified — sets flag only;
/// full "must block specific attacker" support deferred).
///
/// # Card script examples
/// ```text
/// A:SP$ MustBlock | ValidTgts$ Creature
/// A:SP$ MustBlock | Defined$ Targeted
/// A:SP$ MustBlock | ValidCards$ Creature.OppCtrl
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `MustBlockEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(MustBlockEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    // Targeted mode
    if let Some(target) = sa.target_chosen.target_card {
        if ctx.game.card(target).zone == ZoneType::Battlefield {
            ctx.game.card_mut(target).set_must_block(true);
        }
        return;
    }

    // ValidCards$ mode (mass must-block)
    if let Some(valid_filter) = sa.ir.valid_cards_text.as_deref() {
        let valid_selector = sa.ir.valid_cards_selector.as_ref();
        let player_ids = ctx.game.player_order.clone();
        let mut targets: Vec<CardId> = Vec::new();
        for &pid in &player_ids {
            let zone_cards = ctx.game.cards_in_zone(ZoneType::Battlefield, pid).to_vec();
            for cid in zone_cards {
                if matches_valid_cards_for_sa(
                    ctx.game,
                    sa,
                    ctx.game.card(cid),
                    valid_selector,
                    valid_filter,
                ) {
                    targets.push(cid);
                }
            }
        }
        for cid in targets {
            if ctx.game.card(cid).zone == ZoneType::Battlefield {
                ctx.game.card_mut(cid).set_must_block(true);
            }
        }
        return;
    }

    // Defined$ Self
    if let Some(source) = sa.source {
        if ctx.game.card(source).zone == ZoneType::Battlefield {
            ctx.game.card_mut(source).set_must_block(true);
        }
    }
}
