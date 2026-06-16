use forge_foundation::ZoneType;

use super::{matches_valid_cards_selector_opt, EffectContext};
use crate::ids::CardId;

/// End-of-turn revert for goad. Mirrors the `GameCommand.run()` in Java
/// `GoadEffect` that removes the goaded-by marker when the effect expires.
pub fn run(game: &mut crate::game::GameState, card_id: crate::ids::CardId) {
    if game.card(card_id).zone == ZoneType::Battlefield {
        game.card_mut(card_id).set_goaded_by(None);
    }
}

/// `SP$ Goad` — goad target creature(s). Goaded creatures must attack each
/// combat if able, and can't attack the player who goaded them.
///
/// Mirrors Java's `GoadEffect.java`.
///
/// # Card script examples
/// ```text
/// A:SP$ Goad | ValidTgts$ Creature.OppCtrl
/// A:SP$ Goad | ValidCards$ Creature.OppCtrl
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `GoadEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(GoadEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;

    // Targeted mode
    if let Some(target) = sa.target_chosen.target_card {
        if ctx.game.card(target).zone == ZoneType::Battlefield {
            ctx.game.card_mut(target).set_goaded_by(Some(controller));
        }
        return;
    }

    // Mass goad: ValidCards$ filter
    if let Some(valid_filter) = sa.ir.valid_cards_selector.as_ref() {
        let player_ids = ctx.game.player_order.clone();
        let mut targets: Vec<CardId> = Vec::new();
        for &pid in &player_ids {
            let zone_cards = ctx.game.cards_in_zone(ZoneType::Battlefield, pid).to_vec();
            for cid in zone_cards {
                if matches_valid_cards_selector_opt(
                    Some(valid_filter),
                    ctx.game.card(cid),
                    sa.activating_player,
                ) {
                    targets.push(cid);
                }
            }
        }
        for cid in targets {
            if ctx.game.card(cid).zone == ZoneType::Battlefield {
                ctx.game.card_mut(cid).set_goaded_by(Some(controller));
            }
        }
        return;
    }

    // Defined$ Self fallback
    if let Some(source) = sa.source {
        if ctx.game.card(source).zone == ZoneType::Battlefield {
            ctx.game.card_mut(source).set_goaded_by(Some(controller));
        }
    }
}
