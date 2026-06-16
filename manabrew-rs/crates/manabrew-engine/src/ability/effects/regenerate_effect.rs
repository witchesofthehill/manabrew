use forge_foundation::ZoneType;

use super::EffectContext;

/// Resolve `SP$ Regenerate` — add a regeneration shield to a creature.
///
/// Mirrors Java `RegenerateEffect.java`.
/// Increments `card.regeneration_shields` on the target creature.
/// When a creature with shields would be destroyed, a shield is consumed
/// instead: the creature is tapped, removed from combat, and damage is removed.
/// Shields reset at end of turn.
///
/// # Card script examples
/// ```text
/// A:SP$ Regenerate | Defined$ Self
/// A:SP$ Regenerate | ValidTgts$ Creature.YouCtrl | TgtPrompt$ Select target creature you control
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `RegenerateEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(RegenerateEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    // Targeted: use the chosen target card.
    if let Some(target_card) = sa.target_chosen.target_card {
        if ctx.game.card(target_card).zone == ZoneType::Battlefield
            && ctx.game.card(target_card).is_creature()
            && !crate::staticability::static_ability_cant_regenerate::cant_regenerate(
                &ctx.game.cards,
                ctx.game.card(target_card),
            )
        {
            ctx.game.card_mut(target_card).regeneration_shields += 1;
        }
        return;
    }

    // Defined$ Self — regenerate the source card.
    if let Some(source) = sa.source {
        if ctx.game.card(source).zone == ZoneType::Battlefield
            && ctx.game.card(source).is_creature()
            && !crate::staticability::static_ability_cant_regenerate::cant_regenerate(
                &ctx.game.cards,
                ctx.game.card(source),
            )
        {
            ctx.game.card_mut(source).regeneration_shields += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::ability::spell_ability_effect::SpellAbilityEffect;
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};
    use std::collections::HashMap;

    use crate::ability::effects::EffectContext;
    use crate::agent::PassAgent;
    use crate::card::Card;
    use crate::game::GameState;
    use crate::ids::{CardId, PlayerId};
    use crate::mana::ManaPool;
    use crate::spellability::SpellAbility;
    use crate::trigger::handler::TriggerHandler;

    fn make_creature(game: &mut GameState, owner: PlayerId) -> CardId {
        let c = Card::new(
            CardId(0),
            "Bear".into(),
            owner,
            CardTypeLine::parse("Creature - Bear"),
            ManaCost::parse("1 G"),
            ColorSet::GREEN,
            Some(2),
            Some(2),
            vec![],
            vec![],
        );
        game.create_card(c)
    }

    #[test]
    fn regenerate_adds_shield() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        let c1 = make_creature(&mut game, p0);
        game.move_card(c1, ZoneType::Battlefield, p0);
        assert_eq!(game.card(c1).regeneration_shields, 0);

        let sa = SpellAbility::new_simple(Some(c1), p0, "SP$ Regenerate | Defined$ Self");

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
        super::RegenerateEffect::resolve(&mut ctx, &sa);

        assert_eq!(ctx.game.card(c1).regeneration_shields, 1);
    }

    #[test]
    fn regenerate_stacks_shields() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        let c1 = make_creature(&mut game, p0);
        game.move_card(c1, ZoneType::Battlefield, p0);

        let sa = SpellAbility::new_simple(Some(c1), p0, "SP$ Regenerate | Defined$ Self");

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
        super::RegenerateEffect::resolve(&mut ctx, &sa);
        super::RegenerateEffect::resolve(&mut ctx, &sa);

        assert_eq!(ctx.game.card(c1).regeneration_shields, 2);
    }
}
