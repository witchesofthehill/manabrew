use super::EffectContext;
use crate::card::make_plotted_keyword;
use forge_foundation::ZoneType;

/// `AB$ Plot` — exile the source card from hand and mark it as plotted.
/// Plotted cards can later be cast from exile for free.
///
/// Mirrors Java's AbilityStatic resolve() for the Plot keyword
/// (CardFactoryUtil.java:3426-3437).
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `PlotEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(PlotEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let card_id = match sa.source {
        Some(id) => id,
        None => return,
    };
    let player = sa.activating_player;
    let card_name = ctx.game.card(card_id).card_name.clone();
    let turn = ctx.game.turn.turn_number;

    ctx.move_card(card_id, ZoneType::Exile, player);
    ctx.game
        .card_mut(card_id)
        .keywords
        .add(&make_plotted_keyword(turn));

    crate::agent::notify_all_agents(
        ctx.agents,
        crate::agent::GameLogEvent::action(format!("Plotted: {}", card_name))
            .with_player(player)
            .with_card(card_id),
    );
}
