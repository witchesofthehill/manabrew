use super::{resolve_defined_player, EffectContext};
use crate::replacement::replacement_handler::{apply_replacements, ReplacementEvent};
use crate::replacement::GameLossReason;
use crate::replacement::ReplacementResult;

/// Resolve `SP$ GameLoss` — a player loses the game.
///
/// Mirrors Java `GameLossEffect.java`.
///
/// # Card script examples
/// ```text
/// A:SP$ GameLoss | Defined$ You
/// A:SP$ GameLoss | Defined$ Opponent
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `GameLossEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(GameLossEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;

    let defined = sa.defined().unwrap_or("You");

    let loser = resolve_defined_player(defined, controller, ctx.game).unwrap_or(controller);

    if !ctx.game.player(loser).is_alive() {
        return;
    }

    // Run GameLoss replacement effects (e.g. Platinum Angel).
    let mut event = ReplacementEvent::GameLoss {
        player: loser,
        reason: GameLossReason::SpellEffect,
    };
    let result = apply_replacements(ctx.game, &mut event);
    if result == ReplacementResult::Replaced {
        return;
    }

    ctx.game
        .player_mark_lost(loser, crate::replacement::GameLossReason::SpellEffect);

    // SBA will determine if the game is over and set the winner
    let alive = ctx.game.alive_players();
    if alive.len() <= 1 {
        ctx.game.game_over = true;
        if alive.len() == 1 {
            ctx.game.winner = Some(alive[0]);
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
    fn game_loss_marks_player_lost() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);

        let sa = SpellAbility::new_simple(None, p0, "SP$ GameLoss | Defined$ You");

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
        super::GameLossEffect::resolve(&mut ctx, &sa);

        assert!(ctx.game.player(p0).has_lost);
        assert!(!ctx.game.player(p1).has_lost);
        assert!(ctx.game.game_over);
        assert_eq!(ctx.game.winner, Some(p1));
    }
}
