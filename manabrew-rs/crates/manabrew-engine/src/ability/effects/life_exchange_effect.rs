use super::{resolve_defined_player, EffectContext};
use crate::event::RunParams;
use crate::trigger::TriggerType;

/// Resolve `SP$ LifeExchange` — exchange life totals between two players.
///
/// Mirrors Java `LifeExchangeEffect.java`.
///
/// # Card script examples
/// ```text
/// A:SP$ LifeExchange | ValidTgts$ Player
/// A:SP$ LifeExchange | Defined$ Opponent
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `LifeExchangeEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(LifeExchangeEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;

    // Determine the other player: targeted or Defined$
    let other = if let Some(target_player) = sa.target_chosen.target_player {
        target_player
    } else {
        let defined = sa.defined().unwrap_or("Opponent");
        resolve_defined_player(defined, controller, ctx.game)
            .unwrap_or_else(|| ctx.game.opponent_of(controller))
    };

    if !ctx.game.player(controller).is_alive() || !ctx.game.player(other).is_alive() {
        return;
    }

    let life_a = ctx.game.player(controller).life;
    let life_b = ctx.game.player(other).life;

    // Set each player's life to the other's previous total
    let diff_a = ctx.game.player_set_life(controller, life_b);
    let diff_b = ctx.game.player_set_life(other, life_a);

    // Fire triggers for controller
    if diff_a > 0 {
        ctx.trigger_handler.run_trigger(
            TriggerType::LifeGained,
            RunParams {
                player: Some(controller),
                life_amount: Some(diff_a),
                first_time: Some(ctx.game.player(controller).life_gained_this_turn == diff_a),
                source_card: sa.source,
                source_sa: Some(sa.clone()),
                ..Default::default()
            },
            false,
        );
    } else if diff_a < 0 {
        ctx.trigger_handler.run_trigger(
            TriggerType::LifeLost,
            RunParams {
                player: Some(controller),
                life_amount: Some(diff_a.abs()),
                first_time: Some(ctx.game.player(controller).life_lost_this_turn == diff_a.abs()),
                source_card: sa.source,
                source_sa: Some(sa.clone()),
                ..Default::default()
            },
            false,
        );
    }

    // Fire triggers for the other player
    if diff_b > 0 {
        ctx.trigger_handler.run_trigger(
            TriggerType::LifeGained,
            RunParams {
                player: Some(other),
                life_amount: Some(diff_b),
                first_time: Some(ctx.game.player(other).life_gained_this_turn == diff_b),
                source_card: sa.source,
                source_sa: Some(sa.clone()),
                ..Default::default()
            },
            false,
        );
    } else if diff_b < 0 {
        ctx.trigger_handler.run_trigger(
            TriggerType::LifeLost,
            RunParams {
                player: Some(other),
                life_amount: Some(diff_b.abs()),
                first_time: Some(ctx.game.player(other).life_lost_this_turn == diff_b.abs()),
                source_card: sa.source,
                source_sa: Some(sa.clone()),
                ..Default::default()
            },
            false,
        );
    }
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
    fn life_exchange_swaps_totals() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);

        // Set different life totals
        game.player_mut(p0).life = 5;
        game.player_mut(p1).life = 30;

        let sa = SpellAbility::new_simple(None, p0, "SP$ LifeExchange | Defined$ Opponent");

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
        super::LifeExchangeEffect::resolve(&mut ctx, &sa);

        assert_eq!(ctx.game.player(p0).life, 30);
        assert_eq!(ctx.game.player(p1).life, 5);
    }
}
