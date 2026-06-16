use super::{resolve_defined_player, resolve_numeric_svar, EffectContext};
use crate::parsing::keys;
use crate::phase::ExtraTurn;
use crate::spellability::SpellAbility;

/// Resolve `SP$ AddTurn` — give a player extra turns.
///
/// Mirrors Java `AddTurnEffect.java`.
/// Pushes the player onto the `extra_turns` queue in `GameState`.
/// The game loop's `AdvanceTurn` pops from this queue instead of
/// advancing to the next player in turn order.
///
/// # Card script examples
/// ```text
/// A:SP$ AddTurn | Defined$ You | NumTurns$ 1
/// A:SP$ AddTurn | Defined$ You | NumTurns$ 2
/// A:SP$ AddTurn | Defined$ You | NumTurns$ 1 | SkipUntap$ True
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `AddTurnEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(AddTurnEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;

    let num_turns = resolve_numeric_svar(ctx.game, sa, keys::NUM_TURNS, 1);
    let skip_untap = sa.ir.skip_untap;

    let defined = sa.defined().unwrap_or("You");

    let target = resolve_defined_player(defined, controller, ctx.game).unwrap_or(controller);

    if !ctx.game.player(target).is_alive() {
        return;
    }

    for _ in 0..num_turns {
        let mut et = ExtraTurn::new(target);
        et.set_skip_untap(skip_untap);
        ctx.game.extra_turns.push_back(et);
    }
}

/// Create an effect that prevents schemes from being set in motion during
/// the extra turn. Mirrors Java `AddTurnEffect.createCantSetSchemesInMotionEffect`.
///
/// In Archenemy, when extra turns are granted, schemes can't be set in motion
/// during those extra turns. This creates an effect card in the command zone
/// with a replacement effect that intercepts SetInMotion events, then exiles
/// the effect at end of turn.
pub fn create_cant_set_schemes_in_motion_effect(ctx: &mut EffectContext, sa: &SpellAbility) {
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};

    let source_id = match sa.source {
        Some(id) => id,
        None => return,
    };
    let controller = sa.activating_player;
    let card_name = ctx.game.card(source_id).card_name.clone();

    // Create a minimal effect card (mirrors Java's createEffect helper)
    let effect_card = crate::card::Card::new(
        crate::ids::CardId(0),
        format!("{}'s Effect", card_name),
        controller,
        CardTypeLine::default(),
        ManaCost::no_cost(),
        ColorSet::COLORLESS,
        None,
        None,
        vec![],
        vec![],
    );
    let effect_id = ctx.game.create_card(effect_card);

    // Store the replacement effect description — the replacement handler will
    // check this SVar when processing SetInMotion events.
    ctx.game.card_mut(effect_id).set_s_var(
        "ReplacementEffect",
        "Event$ SetInMotion | EffectZone$ Command | Layer$ CantHappen | Description$ Schemes can't be set in Motion".to_string(),
    );

    // Move to command zone so it stays active
    ctx.game.move_card(effect_id, ZoneType::Command, controller);

    // Mark for end-of-turn exile (the cleanup step will remove cards
    // with this marker from the command zone)
    ctx.game
        .card_mut(effect_id)
        .set_s_var("ExileAtEndOfTurn", "True".to_string());
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
    fn add_turn_queues_extra_turns() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);

        let sa = SpellAbility::new_simple(None, p0, "SP$ AddTurn | Defined$ You | NumTurns$ 2");

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
        super::AddTurnEffect::resolve(&mut ctx, &sa);

        assert_eq!(ctx.game.extra_turns.len(), 2);
        assert_eq!(ctx.game.extra_turns[0].player, p0);
        assert_eq!(ctx.game.extra_turns[1].player, p0);
    }

    #[test]
    fn add_turn_default_one() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);

        let sa = SpellAbility::new_simple(None, p0, "SP$ AddTurn | Defined$ You");

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
        super::AddTurnEffect::resolve(&mut ctx, &sa);

        assert_eq!(ctx.game.extra_turns.len(), 1);
        assert_eq!(ctx.game.extra_turns[0].player, p0);
        assert!(!ctx.game.extra_turns[0].skip_untap);
    }
}
