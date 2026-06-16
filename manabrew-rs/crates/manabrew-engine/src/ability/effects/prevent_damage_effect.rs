use forge_foundation::ZoneType;

use super::EffectContext;
use crate::ability::ability_ir::DefinedRef;

/// `SP$ PreventDamage` — prevent the next N damage that would be dealt to
/// a target creature or player this turn.
///
/// Mirrors Java's `PreventDamageEffect.java`.
/// - `Amount$` — number of damage to prevent (default 1).
/// - `Defined$` — who gets the shield (Self, Targeted, ParentTarget, You).
///
/// # Card script examples
/// ```text
/// A:SP$ PreventDamage | Defined$ Self | Amount$ 3
/// A:SP$ PreventDamage | Defined$ Targeted | Amount$ X
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `PreventDamageEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(PreventDamageEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let amount = sa
        .ir
        .amount
        .as_deref()
        .map(|raw| super::resolve_numeric_value(ctx.game, sa, raw, 1))
        .unwrap_or(1);
    if amount <= 0 {
        return;
    }

    // Try targeted creature first
    if let Some(target) = sa.target_chosen.target_card {
        if ctx.game.card(target).zone == ZoneType::Battlefield {
            ctx.game.card_mut(target).damage_prevention += amount;
        }
        return;
    }

    // Try targeted player
    if let Some(pid) = sa.target_chosen.target_player {
        ctx.game.player_add_damage_prevention(pid, amount);
        return;
    }

    // Defined$ resolution
    match sa
        .ir
        .defined
        .as_ref()
        .and_then(|defined| defined.refs.first())
    {
        Some(DefinedRef::SelfCard) => {
            if let Some(source) = sa.source {
                if ctx.game.card(source).zone == ZoneType::Battlefield {
                    ctx.game.card_mut(source).damage_prevention += amount;
                }
            }
        }
        Some(DefinedRef::ParentTarget) => {
            if let Some(parent_target) = ctx.parent_target_card {
                if ctx.game.card(parent_target).zone == ZoneType::Battlefield {
                    ctx.game.card_mut(parent_target).damage_prevention += amount;
                }
            }
        }
        Some(DefinedRef::You) => {
            let controller = sa.activating_player;
            ctx.game.player_add_damage_prevention(controller, amount);
        }
        Some(DefinedRef::Opponent) => {
            let opp = ctx.game.opponent_of(sa.activating_player);
            ctx.game.player_add_damage_prevention(opp, amount);
        }
        _ => {
            // Default: prevent damage to self (source card)
            if let Some(source) = sa.source {
                if ctx.game.card(source).zone == ZoneType::Battlefield {
                    ctx.game.card_mut(source).damage_prevention += amount;
                }
            }
        }
    }
}
