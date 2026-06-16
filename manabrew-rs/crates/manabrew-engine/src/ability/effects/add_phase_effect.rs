use super::{resolve_numeric_svar, EffectContext};
use crate::parsing::keys;

/// Resolve `SP$ AddPhase` — add extra combat (or main) phases to the current turn.
///
/// Mirrors Java `AddPhaseEffect.java`.
/// Increments `game.extra_combat_phases`. The game loop inserts extra
/// Combat→Main2 cycles after the normal combat phase.
///
/// # Card script examples
/// ```text
/// A:SP$ AddPhase | ExtraPhase$ Combat | Amount$ 1
/// A:SP$ AddPhase | ExtraPhase$ Combat | Amount$ 2
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `AddPhaseEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(AddPhaseEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let extra_phase = sa.ir.extra_phase_text.as_deref().unwrap_or("Combat");

    let amount = resolve_numeric_svar(ctx.game, sa, keys::AMOUNT, 1).max(0) as u32;

    match extra_phase {
        "Combat" | "BeginCombat" => {
            ctx.game.extra_combat_phases += amount;
        }
        _ => {
            // Only extra combat phases are supported for now
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
    fn add_extra_combat_phase() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        assert_eq!(game.extra_combat_phases, 0);

        let sa =
            SpellAbility::new_simple(None, p0, "SP$ AddPhase | ExtraPhase$ Combat | Amount$ 1");

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
        super::AddPhaseEffect::resolve(&mut ctx, &sa);

        assert_eq!(ctx.game.extra_combat_phases, 1);
    }
}
