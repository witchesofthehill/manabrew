use super::{resolve_defined_players, EffectContext};

/// Create a skip-phase effect for use by static or replacement abilities.
/// Mirrors Java's `SkipPhaseEffect.createSkipPhaseEffect(...)`.
///
/// Creates an effect that will cause the specified player to skip the
/// specified phase on their next turn. Used by cards like Stasis,
/// Teferi's Protection, etc.
pub fn create_skip_phase_effect(
    game: &mut crate::game::GameState,
    player: crate::ids::PlayerId,
    phase: &str,
) {
    match phase {
        "Draw" => game.player_mut(player).skip_next_draw = true,
        "Combat" | "BeginCombat" => game.player_mut(player).skip_next_combat = true,
        "Untap" => game.player_mut(player).skip_next_untap = true,
        _ => {
            eprintln!("SkipPhaseEffect: Unknown phase to skip: {:?}", phase);
        }
    }
}

/// Run the skip-phase effect (entry point for non-resolve contexts).
/// Mirrors Java's `SkipPhaseEffect.run(SpellAbility)`.
///
/// Parses the Phase$ and Defined$ parameters and applies the skip.
pub fn run(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    use crate::ability::spell_ability_effect::SpellAbilityEffect;
    SkipPhaseEffect::resolve(ctx, sa);
}

/// Resolve `SP$ SkipPhase` — make a player skip their next occurrence of a phase.
///
/// Mirrors Java `SkipPhaseEffect.java`.
/// Sets per-player phase skip flags. The game loop checks these before
/// entering each phase and skips accordingly.
///
/// # Card script examples
/// ```text
/// A:SP$ SkipPhase | Defined$ Opponent | Phase$ Draw
/// A:SP$ SkipPhase | Defined$ You | Phase$ Combat
/// A:SP$ SkipPhase | Defined$ Opponent | Phase$ Untap
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `SkipPhaseEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(SkipPhaseEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;

    let phase = sa
        .ir
        .phase_text
        .as_deref()
        .or(sa.ir.step_text.as_deref())
        .unwrap_or("");

    let defined = sa.defined().unwrap_or("You");

    let targets = resolve_defined_players(defined, controller, ctx.game);
    for target in targets {
        if !ctx.game.player(target).is_alive() {
            continue;
        }
        match phase {
            "Draw" => ctx.game.player_set_skip_draw(target),
            "Combat" | "BeginCombat" => ctx.game.player_set_skip_combat(target),
            "Untap" => ctx.game.player_set_skip_untap(target),
            _ => {
                let err = crate::ability::IllegalAbilityException::new(format!(
                    "Unknown phase to skip: {:?}",
                    phase
                ));
                eprintln!("{}", err);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::SkipPhaseEffect;
    use crate::ability::effects::EffectContext;
    use crate::ability::spell_ability_effect::SpellAbilityEffect;
    use crate::agent::PassAgent;
    use crate::game::GameState;
    use crate::ids::PlayerId;
    use crate::mana::ManaPool;
    use crate::spellability::SpellAbility;
    use crate::trigger::handler::TriggerHandler;

    #[test]
    fn skip_draw_phase() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);

        let sa =
            SpellAbility::new_simple(None, p0, "SP$ SkipPhase | Defined$ Opponent | Phase$ Draw");

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
        super::SkipPhaseEffect::resolve(&mut ctx, &sa);

        assert!(ctx.game.player(p1).skip_next_draw);
        assert!(!ctx.game.player(p1).skip_next_combat);
    }

    #[test]
    fn skip_combat_phase() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);

        let sa = SpellAbility::new_simple(None, p0, "SP$ SkipPhase | Defined$ You | Phase$ Combat");

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
        super::SkipPhaseEffect::resolve(&mut ctx, &sa);

        assert!(ctx.game.player(p0).skip_next_combat);
    }
}
