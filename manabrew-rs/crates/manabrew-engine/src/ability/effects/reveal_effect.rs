use forge_foundation::ZoneType;

use super::{resolve_defined_player, resolve_numeric_svar, EffectContext};
use crate::agent::GameLogEvent;
use crate::parsing::keys;

/// Mirrors Java's `RevealEffect.java`.
///
/// `SP$ Reveal | Defined$ You | NumCards$ N`
/// The target player reveals cards from their hand.
/// In the engine, reveal is informational — we notify all agents.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `RevealEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(RevealEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let num = resolve_numeric_svar(ctx.game, sa, keys::NUM_CARDS, 1).max(0) as usize;

    let target = sa
        .target_chosen
        .target_player
        .or_else(|| {
            sa.defined()
                .and_then(|defined| resolve_defined_player(defined, sa.activating_player, ctx.game))
        })
        .unwrap_or(sa.activating_player);

    let hand = ctx.game.cards_in_zone(ZoneType::Hand, target).to_vec();
    if hand.is_empty() {
        return;
    }

    let count = num.min(hand.len());
    let revealed = &hand[hand.len() - count..];

    // Notify all agents of the revealed cards.
    for agent in ctx.agents.iter_mut() {
        for &id in revealed {
            let name = ctx.game.card(id).card_name.clone();
            agent.notify(crate::agent::notification::GameNotification::Event(
                GameLogEvent::rule(format!("Revealed: {}", name)).with_card(id),
            ));
        }
    }

    // Mirrors `game.getAction().reveal(revealed, p, ...)` in
    // RevealEffect.java:81-85 — broadcast a modal of the revealed cards to
    // every player so all parties can see what was revealed.
    let source_name = sa.source.map(|cid| ctx.game.card(cid).card_name.clone());
    let revealed_vec = revealed.to_vec();
    for agent in ctx.agents.iter_mut() {
        agent.reveal_cards(
            ctx.game,
            target,
            &revealed_vec,
            ZoneType::Hand,
            target,
            source_name.as_deref(),
        );
    }
}
