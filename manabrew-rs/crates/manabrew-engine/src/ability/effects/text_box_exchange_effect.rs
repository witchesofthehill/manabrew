//! TextBoxExchange effect — swap text boxes of two cards.
//!
//! Ported from Java's `TextBoxExchangeEffect.java`.

use super::EffectContext;
use forge_foundation::ZoneType;

/// End-of-turn revert for text box exchange. Mirrors the `GameCommand.run()`
/// in Java `TextBoxExchangeEffect` that restores the original abilities text
/// on both cards when the effect duration expires.
///
/// Takes two card IDs and their original abilities lists to restore.
pub fn run(
    ctx: &mut EffectContext,
    card1: crate::ids::CardId,
    card2: crate::ids::CardId,
    abilities1: Vec<String>,
    abilities2: Vec<String>,
) {
    // Restore original abilities
    if ctx.game.card(card1).zone == ZoneType::Battlefield {
        ctx.game.card_mut(card1).set_abilities(abilities1);
        ctx.trigger_handler.register_active_trigger(ctx.game, card1);
    }
    if ctx.game.card(card2).zone == ZoneType::Battlefield {
        ctx.game.card_mut(card2).set_abilities(abilities2);
        ctx.trigger_handler.register_active_trigger(ctx.game, card2);
    }
}

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `TextBoxExchangeEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(TextBoxExchangeEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let source = sa.source;
    let target = sa.target_chosen.target_card;

    let (Some(card1), Some(card2)) = (source, target) else {
        return;
    };
    if ctx.game.card(card1).zone != ZoneType::Battlefield {
        return;
    }
    if ctx.game.card(card2).zone != ZoneType::Battlefield {
        return;
    }

    // Swap abilities text
    let abilities1 = ctx.game.card(card1).abilities.clone();
    let abilities2 = ctx.game.card(card2).abilities.clone();
    ctx.game.card_mut(card1).set_abilities(abilities2);
    ctx.game.card_mut(card2).set_abilities(abilities1);

    // Re-register triggers
    ctx.trigger_handler.register_active_trigger(ctx.game, card1);
    ctx.trigger_handler.register_active_trigger(ctx.game, card2);
}
