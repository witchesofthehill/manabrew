use super::{resolve_defined_players, EffectContext};
use crate::agent::BinaryChoiceKind;
use crate::ids::PlayerId;

/// `SP$ ChooseEvenOdd` — chosen player picks odd or even.
///
/// Mirrors Java `ChooseEvenOddEffect.java`.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ChooseEvenOddEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ChooseEvenOddEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let Some(source_id) = sa.source else { return };
    let source_name = ctx.game.card(source_id).card_name.clone();

    let players: Vec<PlayerId> = if let Some(pid) = sa.target_chosen.target_player {
        vec![pid]
    } else if let Some(defined) = sa.defined() {
        resolve_defined_players(defined, sa.activating_player, ctx.game)
    } else {
        vec![sa.activating_player]
    };

    for pid in players {
        if !ctx.game.player(pid).is_alive() {
            continue;
        }
        let odd = ctx.agents[pid.index()].choose_binary(
            pid,
            "Odd or even?",
            BinaryChoiceKind::OddsOrEvens,
            None,
            Some(source_id),
            sa.api,
        );
        ctx.game
            .card_mut(source_id)
            .set_s_var("ChosenEvenOdd", if odd { "Odd" } else { "Even" });
    }
}
