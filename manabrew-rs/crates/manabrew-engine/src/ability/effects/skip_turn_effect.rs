use super::{resolve_defined_players, resolve_numeric_svar, EffectContext};
use crate::parsing::keys;

/// Resolve `SP$ SkipTurn` — make a player skip their next turn(s).
///
/// Mirrors Java `SkipTurnEffect.java`.
/// Increments `player.skip_turns` counter. The game loop checks this
/// at the start of a turn and skips it if > 0.
///
/// # Card script examples
/// ```text
/// A:SP$ SkipTurn | Defined$ Opponent | NumTurns$ 1
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `SkipTurnEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(SkipTurnEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;
    let num = resolve_numeric_svar(ctx.game, sa, keys::NUM_TURNS, 1);

    let defined = sa.defined().unwrap_or("You");

    let targets = resolve_defined_players(defined, controller, ctx.game);
    for target in targets {
        if ctx.game.player(target).is_alive() {
            ctx.game.player_add_skip_turns(target, num);
        }
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
    fn skip_turn_increments_counter() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);

        let sa =
            SpellAbility::new_simple(None, p0, "SP$ SkipTurn | Defined$ Opponent | NumTurns$ 1");

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
        super::SkipTurnEffect::resolve(&mut ctx, &sa);

        assert_eq!(ctx.game.player(p1).skip_turns, 1);
    }
}
