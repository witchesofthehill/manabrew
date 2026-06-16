use forge_foundation::ZoneType;

use super::{matches_valid_cards_for_sa, EffectContext};
use crate::ids::CardId;

/// `SP$ Detain` — detain target creature(s). Detained creatures can't attack,
/// block, or activate abilities until the controller's next turn.
///
/// Mirrors Java's `DetainEffect.java`.
///
/// # Card script examples
/// ```text
/// A:SP$ Detain | ValidTgts$ Creature
/// A:SP$ Detain | Defined$ Targeted
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `DetainEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(DetainEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    // Targeted mode
    if let Some(target) = sa.target_chosen.target_card {
        if ctx.game.card(target).zone == ZoneType::Battlefield {
            ctx.game.card_mut(target).set_detained(true);
        }
        return;
    }

    // Defined$ mode (e.g. DetainAll pattern)
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
                ctx.game.card_mut(cid).set_detained(true);
            }
        }
        return;
    }

    // Defined$ Self
    if let Some(source) = sa.source {
        if ctx.game.card(source).zone == ZoneType::Battlefield {
            ctx.game.card_mut(source).set_detained(true);
        }
    }
}
