use super::token_effect_base::{TokenCreateResult, TokenEffectBase, TOKEN_EFFECT_BASE};
use super::EffectContext;
use crate::card::card_zone_table::CardZoneTable;
use crate::ids::PlayerId;
use crate::spellability::SpellAbility;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `TokenEffect` class extending `TokenEffectBase`.
#[manabrew_engine_macros::spell_effect(TokenEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    // Create token creature(s) on the battlefield.
    // Mirrors Java TokenEffect / TokenEffectBase.
    let amount: usize = sa
        .ir
        .token_amount
        .as_deref()
        .map(|raw| super::resolve_numeric_value(ctx.game, sa, raw, 1))
        .unwrap_or(1)
        .max(0) as usize;

    let token_owners = resolve_token_owners(ctx, sa);
    if token_owners.is_empty() {
        return;
    }

    let mut trigger_list = CardZoneTable::default();
    let scripts = TOKEN_EFFECT_BASE.token_scripts(sa);
    let result = if scripts.is_empty() {
        let mut all_created = TokenCreateResult::default();
        for owner in token_owners {
            let template = TOKEN_EFFECT_BASE.build_inline_token(sa, owner);
            let token_table = TOKEN_EFFECT_BASE.make_token_table_internal(owner, template, amount);
            let created =
                TOKEN_EFFECT_BASE.make_token_table(ctx, token_table, false, &mut trigger_list, sa);
            all_created.created.extend(created.created);
            all_created.combat_changed |= created.combat_changed;
        }
        all_created
    } else {
        TOKEN_EFFECT_BASE.make_token_table_from_scripts(
            ctx,
            &token_owners,
            &scripts,
            amount,
            false,
            &mut trigger_list,
            sa,
        )
    };

    if !result.created.is_empty() {
        trigger_list.trigger_changes_zone_all(ctx.trigger_handler, ctx.game, Some(sa));
    }
}

fn resolve_token_owners(ctx: &EffectContext, sa: &SpellAbility) -> Vec<PlayerId> {
    // Java parity (`SpellAbilityEffect.getDefinedPlayersOrTargeted("TokenOwner")`):
    // when an explicit `TokenOwner$` resolves to no players (e.g. `TargetedController`
    // with no chosen target), no tokens are created. Only fall back to the
    // activator when no `TokenOwner` is specified at all.
    if let Some(defined) = sa.token_owner() {
        return crate::ability::ability_utils::resolve_defined_players_with_sa(
            defined,
            sa,
            sa.activating_player,
            ctx.game,
        );
    }
    vec![sa.activating_player]
}
