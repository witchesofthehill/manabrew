use forge_foundation::ZoneType;

use super::EffectContext;
use crate::ability::ability_ir::DefinedRef;
use crate::card::card_damage_map::DamageTarget;
use crate::event::RunParams;
use crate::trigger::TriggerType;

/// SP$/DB$ Fight — two creatures deal damage to each other equal to their power.
///
/// When `Defined$ ParentTarget` is set (the common pattern for DB$ Fight used by
/// cards like Prey Upon), the first fighter is the parent SA's chosen target card
/// (`ctx.parent_target_card`) and this SA's `target_chosen.target_card` is the
/// second fighter. For a direct SP$ Fight without Defined$, `sa.source` is used
/// as the first fighter.
///
/// Mirrors Java's `FightEffect.resolve()`.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `FightEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(FightEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let use_damage_map = ctx.game.pending_damage_map.is_some() || sa.ir.damage_map;
    if sa.ir.damage_map {
        ctx.game.ensure_pending_damage_maps();
    }

    // The explicitly targeted card is always the "other" fighter (opponent's creature).
    let target = match sa.target_chosen.target_card {
        Some(c) => c,
        None => return,
    };

    // Determine the "source" fighter based on Defined$ ParentTarget vs direct source.
    // Prey Upon: `DB$ Fight | Defined$ ParentTarget` — controlled creature from parent SA.
    let is_defined_parent = matches!(sa.defined_ref(), Some(DefinedRef::ParentTarget));
    let source = if is_defined_parent {
        match ctx.parent_target_card {
            Some(c) => c,
            None => return,
        }
    } else {
        // Direct SP$ Fight: the source card itself should be a creature (rare pattern).
        match sa.source {
            Some(s) => s,
            None => return,
        }
    };

    // Both must be creatures on the battlefield
    if ctx.game.card(source).zone != ZoneType::Battlefield
        || !ctx.game.card(source).is_creature()
        || ctx.game.card(target).zone != ZoneType::Battlefield
        || !ctx.game.card(target).is_creature()
    {
        return;
    }

    if sa.ir.optional {
        let decider = sa
            .source
            .map(|cid| ctx.game.card(cid).controller)
            .unwrap_or(sa.activating_player);
        ctx.agents[decider.index()].snapshot_state(ctx.game, ctx.mana_pools);
        if !ctx.agents[decider.index()].confirm_action(
            decider,
            Some("Fight"),
            "Would you like those creatures to fight?",
            &[],
            None,
            None,
        ) {
            return;
        }
    }

    let source_power = ctx.game.card(source).power();
    let target_power = ctx.game.card(target).power();

    // Track damage sources for DamagedBy trigger filters
    if !ctx
        .game
        .card(target)
        .damage_sources_this_turn
        .contains(&source)
    {
        ctx.game
            .card_mut(target)
            .damage_sources_this_turn
            .push(source);
    }
    if !ctx
        .game
        .card(source)
        .damage_sources_this_turn
        .contains(&target)
    {
        ctx.game
            .card_mut(source)
            .damage_sources_this_turn
            .push(target);
    }
    // Deal damage simultaneously
    if use_damage_map {
        if let Some(map) = ctx.game.pending_damage_map.as_mut() {
            map.put(source, DamageTarget::Card(target), source_power);
            map.put(target, DamageTarget::Card(source), target_power);
        }
    } else {
        ctx.game.deal_damage_to_card(target, source_power);
        ctx.game.deal_damage_to_card(source, target_power);
    }

    // Fire per-fighter and batched fight triggers (matches Java FightEffect).
    ctx.trigger_handler.run_trigger(
        TriggerType::Fight,
        RunParams {
            card: Some(source),
            card2: Some(target),
            ..Default::default()
        },
        false,
    );
    ctx.trigger_handler.run_trigger(
        TriggerType::Fight,
        RunParams {
            card: Some(target),
            card2: Some(source),
            ..Default::default()
        },
        false,
    );
    ctx.trigger_handler.run_trigger(
        TriggerType::FightOnce,
        RunParams {
            card: Some(source),
            card2: Some(target),
            ..Default::default()
        },
        false,
    );

    let _ = crate::ability::spell_ability_effect::replace_dying(ctx.game, sa);
}
