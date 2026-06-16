use super::EffectContext;

/// Resolve `SP$ EndCombatPhase` — end the current combat phase.
///
/// Mirrors Java `EndCombatPhaseEffect.java`.
/// Sets the `end_combat_requested` flag on `GameState`. The game loop checks
/// this flag in `step_combat()` to exit combat early and proceed to Main2.
///
/// # Card script examples
/// ```text
/// A:SP$ EndCombatPhase
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `EndCombatPhaseEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(EndCombatPhaseEffect)]
fn resolve(ctx: &mut EffectContext, _sa: &crate::spellability::SpellAbility) {
    if !ctx.game.turn.is_combat() {
        return; // CR 723.2g — only meaningful during combat
    }
    ctx.game.end_combat_requested = true;
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
    use forge_foundation::PhaseType;

    #[test]
    fn end_combat_sets_flag() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        game.turn.phase = PhaseType::CombatDeclareAttackers;

        let sa = SpellAbility::new_simple(None, p0, "SP$ EndCombatPhase");

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
        super::EndCombatPhaseEffect::resolve(&mut ctx, &sa);

        assert!(ctx.game.end_combat_requested);
    }

    #[test]
    fn end_combat_noop_outside_combat() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        game.turn.phase = PhaseType::Main1;

        let sa = SpellAbility::new_simple(None, p0, "SP$ EndCombatPhase");

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
        super::EndCombatPhaseEffect::resolve(&mut ctx, &sa);

        assert!(!ctx.game.end_combat_requested);
    }
}
