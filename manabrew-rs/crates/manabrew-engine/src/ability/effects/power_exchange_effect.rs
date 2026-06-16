use forge_foundation::ZoneType;

use super::EffectContext;
use crate::card::perpetual::perpetual_interface::PerpetualInterface;
use crate::card::perpetual::perpetual_new_pt;

/// End-of-turn revert for power exchange. Mirrors the `GameCommand.run()` in Java
/// `PowerExchangeEffect` that calls `removeNewPT` on both cards when the
/// duration expires, restoring their original power values.
///
/// Takes two card IDs and the original power values to restore.
pub fn run(
    game: &mut crate::game::GameState,
    card1: crate::ids::CardId,
    card2: crate::ids::CardId,
) {
    // Reset power modifiers to 0 to revert the exchange
    if game.card(card1).zone == ZoneType::Battlefield {
        game.card_mut(card1).set_power_modifier(0);
    }
    if game.card(card2).zone == ZoneType::Battlefield {
        game.card_mut(card2).set_power_modifier(0);
    }
}

/// Resolve `SP$ PowerExchange` — swap power between two creatures.
///
/// Mirrors Java `PowerExchangeEffect.java`.
///
/// # Card script examples
/// ```text
/// A:SP$ PowerExchange | ValidTgts$ Creature | TgtPrompt$ Select target creature
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `PowerExchangeEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(PowerExchangeEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let source = sa.source;
    let target = sa.target_chosen.target_card;

    let (c1, c2) = match (source, target) {
        (Some(s), Some(t)) => (s, t),
        _ => return,
    };

    if ctx.game.card(c1).zone != ZoneType::Battlefield
        || ctx.game.card(c2).zone != ZoneType::Battlefield
    {
        return;
    }

    // Both must be creatures
    if !ctx.game.card(c1).is_creature() || !ctx.game.card(c2).is_creature() {
        return;
    }

    let base_power = sa.ir.base_power;
    let p1 = if base_power {
        ctx.game.card(c1).base_power.unwrap_or(0)
    } else {
        ctx.game.card(c1).power()
    };
    let p2 = if base_power {
        ctx.game.card(c2).base_power.unwrap_or(0)
    } else {
        ctx.game.card(c2).power()
    };
    let is_perpetual = matches!(
        sa.ir.duration,
        Some(crate::spellability::AbilityDuration::Perpetual)
    );

    if is_perpetual {
        let ts = ctx.game.next_effect_timestamp();
        perpetual_new_pt::PerpetualNewPt {
            timestamp: ts,
            power: Some(p2),
            toughness: None,
        }
        .apply_effect(ctx.game.card_mut(c1));
        perpetual_new_pt::PerpetualNewPt {
            timestamp: ts,
            power: Some(p1),
            toughness: None,
        }
        .apply_effect(ctx.game.card_mut(c2));
        return;
    }

    // Calculate the modifier deltas needed to swap powers
    let c1_base = ctx
        .game
        .card(c1)
        .static_set_power
        .unwrap_or(ctx.game.card(c1).base_power.unwrap_or(0));
    let c2_base = ctx
        .game
        .card(c2)
        .static_set_power
        .unwrap_or(ctx.game.card(c2).base_power.unwrap_or(0));

    // Set power modifiers so effective power = the other's power
    let c1_static = ctx.game.card(c1).static_power_modifier;
    let c2_static = ctx.game.card(c2).static_power_modifier;
    ctx.game
        .card_mut(c1)
        .set_power_modifier(p2 - c1_base - c1_static);
    ctx.game
        .card_mut(c2)
        .set_power_modifier(p1 - c2_base - c2_static);
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

    #[test]
    fn power_exchange_swaps() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);

        let c1 = game.create_card(Card::new(
            CardId(0),
            "Bear".into(),
            p0,
            CardTypeLine::parse("Creature - Bear"),
            ManaCost::parse("1 G"),
            ColorSet::GREEN,
            Some(2),
            Some(2),
            vec![],
            vec![],
        ));
        game.move_card(c1, ZoneType::Battlefield, p0);

        let c2 = game.create_card(Card::new(
            CardId(0),
            "Dragon".into(),
            p0,
            CardTypeLine::parse("Creature - Dragon"),
            ManaCost::parse("4 R R"),
            ColorSet::RED,
            Some(5),
            Some(5),
            vec![],
            vec![],
        ));
        game.move_card(c2, ZoneType::Battlefield, p0);

        assert_eq!(game.card(c1).power(), 2);
        assert_eq!(game.card(c2).power(), 5);

        let mut sa = SpellAbility::new_simple(Some(c1), p0, "SP$ PowerExchange");
        sa.target_chosen.target_card = Some(c2);

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
        super::PowerExchangeEffect::resolve(&mut ctx, &sa);

        assert_eq!(ctx.game.card(c1).power(), 5);
        assert_eq!(ctx.game.card(c2).power(), 2);
    }
}
