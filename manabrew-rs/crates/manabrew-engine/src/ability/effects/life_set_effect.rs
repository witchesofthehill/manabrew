use super::{resolve_defined_players, resolve_numeric_svar, EffectContext};
use crate::ability::ability_ir::EffectIr;
use crate::event::RunParams;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

/// Resolve `SP$ LifeSet` — set a player's life total to a specific value.
///
/// Mirrors Java `LifeSetEffect.java`.
/// Supports multi-player targeting via `Defined$ Each`.
///
/// # Card script examples
/// ```text
/// A:SP$ LifeSet | Defined$ You | LifeAmount$ 10
/// A:SP$ LifeSet | Defined$ Opponent | LifeAmount$ 1
/// A:SP$ LifeSet | Defined$ Each | LifeAmount$ 20
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `LifeSetEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(LifeSetEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;

    let amount = resolve_life_set_amount(ctx, sa);

    let defined = sa.defined().unwrap_or("You");

    let targets = resolve_defined_players(defined, controller, ctx.game);

    for target in targets {
        if !ctx.game.player(target).is_alive() {
            continue;
        }

        let diff = ctx.game.player_set_life(target, amount);

        // Fire the appropriate life trigger based on the difference
        if diff > 0 {
            ctx.trigger_handler.run_trigger(
                TriggerType::LifeGained,
                RunParams {
                    player: Some(target),
                    life_amount: Some(diff),
                    first_time: Some(ctx.game.player(target).life_gained_this_turn == diff),
                    source_card: sa.source,
                    source_sa: Some(sa.clone()),
                    ..Default::default()
                },
                false,
            );
        } else if diff < 0 {
            ctx.trigger_handler.run_trigger(
                TriggerType::LifeLost,
                RunParams {
                    player: Some(target),
                    life_amount: Some(diff.abs()),
                    first_time: Some(ctx.game.player(target).life_lost_this_turn == diff.abs()),
                    source_card: sa.source,
                    source_sa: Some(sa.clone()),
                    ..Default::default()
                },
                false,
            );
        }
    }
}

fn resolve_life_set_amount(ctx: &EffectContext, sa: &SpellAbility) -> i32 {
    if let Some(EffectIr::LifeSet(ir)) = &sa.ir.effect {
        if let Some(amount) = &ir.amount {
            let resolved = amount.resolve_for_spell_ability(ctx.game, sa, 0);
            #[cfg(debug_assertions)]
            debug_assert_eq!(
                resolved,
                resolve_numeric_svar(ctx.game, sa, crate::parsing::keys::LIFE_AMOUNT, 0),
                "compiled SetLife amount diverged from string params"
            );
            return resolved;
        }
    }

    resolve_numeric_svar(ctx.game, sa, crate::parsing::keys::LIFE_AMOUNT, 0)
}

#[cfg(test)]
mod tests {
    use crate::ability::spell_ability_effect::SpellAbilityEffect;
    use std::collections::HashMap;

    use crate::ability::effects::EffectContext;
    use crate::agent::PassAgent;
    use crate::game::GameState;
    use crate::ids::PlayerId;
    use crate::mana::ManaPool;
    use crate::spellability::SpellAbility;
    use crate::trigger::handler::TriggerHandler;

    #[test]
    fn life_set_reduces_life() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);

        let sa = SpellAbility::new_simple(None, p0, "SP$ LifeSet | Defined$ You | LifeAmount$ 10");

        let mut th = TriggerHandler::new();
        let mut agents: Vec<Box<dyn crate::agent::PlayerAgent>> =
            vec![Box::new(PassAgent), Box::new(PassAgent)];
        let mut mp = vec![ManaPool::default(), ManaPool::default()];
        let templates = HashMap::new();
        let templates_variants = HashMap::new();
        let token_fallback = HashMap::new();
        let edition_dates: HashMap<String, String> = HashMap::new();
        let mut rng_adapter = crate::game_rng::ThreadRngAdapter;
        let mut ctx = EffectContext {
            game: &mut game,
            combat: None,
            agents: &mut agents,
            trigger_handler: &mut th,
            token_templates: &templates,
            token_art_variants: &templates_variants,
            token_fallback: &token_fallback,
            edition_dates: &edition_dates,
            mana_pools: &mut mp,
            parent_target_card: None,
            rng: &mut rng_adapter,
        };
        super::LifeSetEffect::resolve(&mut ctx, &sa);

        assert_eq!(ctx.game.player(p0).life, 10);
        assert_eq!(ctx.game.player(p0).life_lost_this_turn, 10);
    }

    #[test]
    fn life_set_increases_life() {
        let mut game = GameState::new(&["Alice", "Bob"], 5);
        let p0 = PlayerId(0);

        let sa = SpellAbility::new_simple(None, p0, "SP$ LifeSet | Defined$ You | LifeAmount$ 20");

        let mut th = TriggerHandler::new();
        let mut agents: Vec<Box<dyn crate::agent::PlayerAgent>> =
            vec![Box::new(PassAgent), Box::new(PassAgent)];
        let mut mp = vec![ManaPool::default(), ManaPool::default()];
        let templates = HashMap::new();
        let templates_variants = HashMap::new();
        let token_fallback = HashMap::new();
        let edition_dates: HashMap<String, String> = HashMap::new();
        let mut rng_adapter = crate::game_rng::ThreadRngAdapter;
        let mut ctx = EffectContext {
            game: &mut game,
            combat: None,
            agents: &mut agents,
            trigger_handler: &mut th,
            token_templates: &templates,
            token_art_variants: &templates_variants,
            token_fallback: &token_fallback,
            edition_dates: &edition_dates,
            mana_pools: &mut mp,
            parent_target_card: None,
            rng: &mut rng_adapter,
        };
        super::LifeSetEffect::resolve(&mut ctx, &sa);

        assert_eq!(ctx.game.player(p0).life, 20);
        assert_eq!(ctx.game.player(p0).life_gained_this_turn, 15);
    }
}
