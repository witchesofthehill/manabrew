use super::{resolve_defined_player_with_sa, resolve_numeric_svar, EffectContext};
use crate::ability::ability_ir::EffectIr;
use crate::event::RunParams;
use crate::replacement::replacement_handler::{apply_replacements, ReplacementEvent};
use crate::replacement::ReplacementResult;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `LifeLoseEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(LifeLoseEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let amount = resolve_life_amount(ctx, sa);
    // Mirror Java getTargetPlayers(): targeted player first, then Defined, then activator.
    let target = sa
        .target_chosen
        .target_player
        .or_else(|| {
            sa.defined().and_then(|defined| {
                resolve_defined_player_with_sa(defined, sa, sa.activating_player, ctx.game)
            })
        })
        .unwrap_or(sa.activating_player);
    if crate::staticability::static_ability_cant_gain_lose_pay_life::cant_lose_life(
        ctx.game, target,
    ) {
        return;
    }

    // Run LifeReduced replacement effects before losing life.
    let mut event = ReplacementEvent::LifeReduced {
        player: target,
        amount,
        is_damage: false,
    };
    let result = apply_replacements(ctx.game, &mut event);
    if result == ReplacementResult::Skipped || result == ReplacementResult::Replaced {
        return;
    }
    let amount = if let ReplacementEvent::LifeReduced {
        amount: final_amount,
        ..
    } = event
    {
        final_amount
    } else {
        amount
    };
    if amount <= 0 {
        return;
    }

    ctx.game.player_lose_life(target, amount);

    // Set AFLifeLost SVar on source card so chained sub-abilities (e.g. GainLife) can read it.
    // Mirrors Java's `sa.setSVar("AFLifeLost", "Number$" + lifeLost)`.
    if let Some(source_id) = sa.source {
        ctx.game
            .card_mut(source_id)
            .svars
            .insert("AFLifeLost".to_string(), format!("Number${}", amount));
    }

    // Per-player `LifeLost` trigger.
    ctx.trigger_handler.run_trigger(
        TriggerType::LifeLost,
        RunParams {
            player: Some(target),
            life_amount: Some(amount),
            first_time: Some(ctx.game.player(target).life_lost_this_turn == amount),
            source_card: sa.source,
            source_sa: Some(sa.clone()),
            ..Default::default()
        },
        false,
    );

    // Java fires one aggregated `LifeLostAll` per effect; the Rust engine's
    // `LifeLose` only processes one target per call, so the aggregate map has
    // a single entry. Fire here so trigger-on-opponent-life-loss cards (e.g.
    // the Speed mechanic) see the event.
    ctx.trigger_handler.run_trigger(
        TriggerType::LifeLostAll,
        RunParams {
            player: Some(target),
            life_amount: Some(amount),
            source_card: sa.source,
            source_sa: Some(sa.clone()),
            ..Default::default()
        },
        false,
    );
}

fn resolve_life_amount(ctx: &EffectContext, sa: &SpellAbility) -> i32 {
    if let Some(EffectIr::LoseLife(ir)) = &sa.ir.effect {
        if let Some(amount) = &ir.amount {
            let resolved = amount.resolve_for_spell_ability(ctx.game, sa, 1);
            #[cfg(debug_assertions)]
            debug_assert_eq!(
                resolved,
                resolve_numeric_svar(ctx.game, sa, crate::parsing::keys::LIFE_AMOUNT, 1),
                "compiled LoseLife amount diverged from string params"
            );
            return resolved;
        }
    }

    resolve_numeric_svar(ctx.game, sa, crate::parsing::keys::LIFE_AMOUNT, 1)
}
