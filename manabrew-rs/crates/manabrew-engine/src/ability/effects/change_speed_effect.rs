//! ChangeSpeed — modifies a player's speed.
//! Ported from Java's ChangeSpeedEffect.

use super::EffectContext;
use crate::spellability::SpellAbilityMode;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ChangeSpeedEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ChangeSpeedEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let mode = sa.ir.mode.as_ref().unwrap_or(&SpellAbilityMode::Increase);
    let players = if let Some(defined) = sa.defined() {
        crate::ability::ability_utils::resolve_defined_players_with_sa(
            defined,
            sa,
            sa.activating_player,
            ctx.game,
        )
    } else if let Some(target) = sa.target_chosen.target_player {
        vec![target]
    } else {
        vec![sa.activating_player]
    };

    for player in players {
        if !ctx.game.player(player).is_alive() {
            continue;
        }
        if matches!(mode, SpellAbilityMode::Decrease) {
            ctx.game
                .decrease_player_speed(player, Some(ctx.trigger_handler));
        } else {
            ctx.game
                .increase_player_speed(player, Some(ctx.trigger_handler));
        }
    }
}
