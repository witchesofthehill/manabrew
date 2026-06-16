use super::{resolve_defined_player_with_sa, resolve_numeric_svar, EffectContext};
use crate::ability::ability_ir::EffectIr;
use crate::event::RunParams;
use crate::replacement::replacement_handler::{apply_replacements, ReplacementEvent};
use crate::replacement::ReplacementResult;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `LifeGainEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(LifeGainEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let amount = resolve_life_amount(ctx, sa);
    let target = sa
        .defined()
        .and_then(|defined| {
            resolve_defined_player_with_sa(defined, sa, sa.activating_player, ctx.game)
        })
        .unwrap_or(sa.activating_player);
    if crate::staticability::static_ability_cant_gain_lose_pay_life::cant_gain_life(
        ctx.game, target,
    ) {
        return;
    }
    // Run GainLife replacement effects (e.g. double life gain).
    let mut event = ReplacementEvent::GainLife {
        player: target,
        amount,
    };
    let result = apply_replacements(ctx.game, &mut event);
    let amount = if let ReplacementEvent::GainLife {
        amount: final_amount,
        ..
    } = event
    {
        final_amount
    } else {
        amount
    };
    if result == ReplacementResult::Skipped || amount <= 0 {
        return;
    }
    ctx.game.player_gain_life(target, amount);

    // Fire LifeGained trigger
    ctx.trigger_handler.run_trigger(
        TriggerType::LifeGained,
        RunParams {
            player: Some(target),
            life_amount: Some(amount),
            first_time: Some(ctx.game.player(target).life_gained_this_turn == amount),
            source_card: sa.source,
            source_sa: Some(sa.clone()),
            ..Default::default()
        },
        false,
    );
}

fn resolve_life_amount(ctx: &EffectContext, sa: &SpellAbility) -> i32 {
    if let Some(EffectIr::GainLife(ir)) = &sa.ir.effect {
        if let Some(amount) = &ir.amount {
            let resolved = amount.resolve_for_spell_ability(ctx.game, sa, 1);
            #[cfg(debug_assertions)]
            debug_assert_eq!(
                resolved,
                resolve_numeric_svar(ctx.game, sa, crate::parsing::keys::LIFE_AMOUNT, 1),
                "compiled GainLife amount diverged from string params"
            );
            return resolved;
        }
    }

    resolve_numeric_svar(ctx.game, sa, crate::parsing::keys::LIFE_AMOUNT, 1)
}
