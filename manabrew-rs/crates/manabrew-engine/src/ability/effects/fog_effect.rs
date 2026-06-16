use super::EffectContext;

/// Resolve `SP$ Fog` — prevent all combat damage this turn.
///
/// Mirrors Java `FogEffect.java` (which uses a ReplacementEffect in Java,
/// but we use a simpler flag-based approach).
///
/// Sets `prevent_all_combat_damage` on `GameState`. The combat damage
/// resolution checks this flag and skips dealing damage. The flag is
/// reset at end of turn cleanup.
///
/// # Card script examples
/// ```text
/// A:SP$ Fog
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `FogEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(FogEffect)]
fn resolve(ctx: &mut EffectContext, _sa: &crate::spellability::SpellAbility) {
    ctx.game.prevent_all_combat_damage = true;
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
    fn fog_sets_prevent_flag() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);

        assert!(!game.prevent_all_combat_damage);

        let sa = SpellAbility::new_simple(None, p0, "SP$ Fog");

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
        super::FogEffect::resolve(&mut ctx, &sa);

        assert!(ctx.game.prevent_all_combat_damage);
    }
}
