use forge_foundation::ZoneType;

use super::{resolve_defined_player, EffectContext};
use crate::agent::GameLogEvent;

/// Mirrors Java's `RevealHandEffect.java`.
///
/// `SP$ RevealHand | Defined$ Player`
/// The target player reveals their entire hand to all other players.
/// In the engine this is informational — we notify all agents.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `RevealHandEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(RevealHandEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let target = sa
        .target_chosen
        .target_player
        .or_else(|| {
            sa.defined()
                .and_then(|d| resolve_defined_player(d, sa.activating_player, ctx.game))
        })
        .unwrap_or(sa.activating_player);

    if sa.ir.optional {
        let source_name = sa.source.map(|cid| ctx.game.card(cid).card_name.as_str());
        let accepted = ctx.agents[target.index()].confirm_action(
            target,
            None,
            "Do you want to reveal your hand?",
            &[],
            sa.source,
            Some(crate::ability::api_type::ApiType::RevealHand),
        );
        if !accepted {
            return;
        }
    }

    let hand = ctx.game.cards_in_zone(ZoneType::Hand, target).to_vec();

    let names: Vec<String> = hand
        .iter()
        .map(|&id| ctx.game.card(id).card_name.clone())
        .collect();
    let msg = format!(
        "Player {} reveals their hand: [{}]",
        target.0,
        names.join(", ")
    );
    for agent in ctx.agents.iter_mut() {
        agent.notify(crate::agent::notification::GameNotification::Event(
            GameLogEvent::rule(msg.clone()).with_player(target),
        ));
    }

    // Mirrors `host.getGame().getAction().reveal(hand, p)` in
    // RevealHandEffect.java:54 — broadcast a modal of the full hand to every
    // player so the reveal is publicly visible, not just a log entry.
    if !hand.is_empty() {
        let source_name = sa.source.map(|cid| ctx.game.card(cid).card_name.clone());
        for agent in ctx.agents.iter_mut() {
            agent.reveal_cards(
                ctx.game,
                target,
                &hand,
                ZoneType::Hand,
                target,
                source_name.as_deref(),
            );
        }
    }
}
