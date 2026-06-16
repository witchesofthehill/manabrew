use forge_foundation::ZoneType;

use super::{emit_zone_trigger_with_lki_counters, matches_valid_cards_for_sa, EffectContext};
use crate::event::RunParams;
use crate::ids::CardId;
use crate::replacement::replacement_handler::{apply_replacements, ReplacementEvent};
use crate::replacement::ReplacementResult;
use crate::trigger::TriggerType;

/// `SP$ DestroyAll` — destroy all permanents matching `ValidCards$`.
///
/// Mirrors Java's `DestroyAllEffect.java`:
/// - Collects all matching battlefield cards (two-pass to avoid borrow issues).
/// - Respects `Indestructible` (keyword or R$-based replacement effect).
/// - `NoRegen$ True` is noted but regeneration is not yet implemented, so it
///   has no runtime effect.
///
/// # Card script examples
/// ```text
/// A:SP$ DestroyAll | ValidCards$ Creature | NoRegen$ True
/// A:SP$ DestroyAll | ValidCards$ Permanent.nonArtifact
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `DestroyAllEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(DestroyAllEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let valid_cards = sa.ir.valid_cards_selector.as_ref();

    // Pass 1 — collect matching battlefield cards
    let player_ids = ctx.game.player_order.clone();
    let mut to_destroy: Vec<CardId> = Vec::new();
    for &pid in &player_ids {
        let zone_cards = ctx.game.cards_in_zone(ZoneType::Battlefield, pid).to_vec();
        for cid in zone_cards {
            if matches_valid_cards_for_sa(ctx.game, sa, ctx.game.card(cid), valid_cards, "Creature")
            {
                to_destroy.push(cid);
            }
        }
    }

    // Pass 2 — destroy each card, respecting Indestructible
    for card_id in to_destroy {
        if ctx.game.card(card_id).zone != ZoneType::Battlefield {
            continue; // May have already left (e.g. legendary rule, previous step)
        }
        // K:Indestructible keyword fast path (CR 702.12)
        if ctx.game.card(card_id).has_keyword("Indestructible") {
            continue;
        }
        // R$-based Destroy replacement (e.g. Darksteel Myr's replacement effect)
        let mut destroy_event = ReplacementEvent::Destroy { target: card_id };
        let result = apply_replacements(ctx.game, &mut destroy_event);
        if result == ReplacementResult::Replaced {
            continue;
        }
        let owner = ctx.game.card(card_id).owner;
        // Capture +1/+1 counter count before move (for Modular death triggers)
        let lki_p1p1 = *ctx
            .game
            .card(card_id)
            .counters
            .get(&crate::card::CounterType::P1P1)
            .unwrap_or(&0);
        // Capture LKI counters for death triggers
        {
            let lki_counters = ctx.game.card(card_id).counters.clone();
            let lki_power = ctx.game.card(card_id).power();
            let lki_toughness = ctx.game.card(card_id).toughness();
            ctx.game.card_mut(card_id).lki_counters = Some(lki_counters);
            ctx.game
                .card_mut(card_id)
                .set_lki_power_toughness(Some(lki_power), Some(lki_toughness));
        }
        ctx.move_card(card_id, ZoneType::Graveyard, owner);
        ctx.trigger_handler.run_trigger(
            TriggerType::Destroyed,
            RunParams {
                card: Some(card_id),
                causer: sa.source,
                cause_card: sa.source,
                cause_player: Some(sa.activating_player),
                ..Default::default()
            },
            false,
        );
        emit_zone_trigger_with_lki_counters(
            ctx.trigger_handler,
            card_id,
            ZoneType::Battlefield,
            ZoneType::Graveyard,
            lki_p1p1,
            ctx.game
                .card(card_id)
                .lki_power
                .unwrap_or_else(|| ctx.game.card(card_id).power()),
            ctx.game
                .card(card_id)
                .lki_toughness
                .unwrap_or_else(|| ctx.game.card(card_id).toughness()),
        );
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

    fn make_creature(game: &mut GameState, owner: PlayerId, keywords: Vec<String>) -> CardId {
        let c = Card::new(
            CardId(0),
            "Bear".into(),
            owner,
            CardTypeLine::parse("Creature - Bear"),
            ManaCost::parse("1 G"),
            ColorSet::GREEN,
            Some(2),
            Some(2),
            keywords,
            vec![],
        );
        game.create_card(c)
    }

    fn make_ctx<'a>(
        game: &'a mut GameState,
        agents: &'a mut Vec<Box<dyn crate::agent::PlayerAgent>>,
        trigger_handler: &'a mut TriggerHandler,
        mana_pools: &'a mut Vec<ManaPool>,
        token_templates: &'a HashMap<String, Card>,
        token_art_variants: &'a HashMap<(String, String), usize>,
        token_fallback: &'a HashMap<String, String>,
        edition_dates: &'a HashMap<String, String>,
        rng: &'a mut dyn crate::game_rng::GameRng,
    ) -> EffectContext<'a> {
        EffectContext {
            game,
            combat: None,
            agents,
            trigger_handler,
            token_templates,
            token_art_variants,
            token_fallback,
            edition_dates,
            mana_pools,
            parent_target_card: None,
            rng,
        }
    }

    #[test]
    fn destroy_all_wipes_creatures() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);
        let c1 = make_creature(&mut game, p0, vec![]);
        let c2 = make_creature(&mut game, p1, vec![]);
        game.move_card(c1, ZoneType::Battlefield, p0);
        game.move_card(c2, ZoneType::Battlefield, p1);

        let sa = SpellAbility::new_simple(
            None,
            p0,
            "A:SP$ DestroyAll | ValidCards$ Creature | NoRegen$ True",
        );
        let mut th = TriggerHandler::new();
        let mut agents: Vec<Box<dyn crate::agent::PlayerAgent>> =
            vec![Box::new(PassAgent), Box::new(PassAgent)];
        let mut mp = vec![ManaPool::default(), ManaPool::default()];
        let templates = HashMap::new();
        let templates_variants: HashMap<(String, String), usize> = HashMap::new();
        let token_fallback: HashMap<String, String> = HashMap::new();
        let edition_dates: HashMap<String, String> = HashMap::new();
        let mut rng_adapter = crate::game_rng::ThreadRngAdapter;
        let mut ctx = make_ctx(
            &mut game,
            &mut agents,
            &mut th,
            &mut mp,
            &templates,
            &templates_variants,
            &token_fallback,
            &edition_dates,
            &mut rng_adapter,
        );
        super::DestroyAllEffect::resolve(&mut ctx, &sa);

        assert_eq!(ctx.game.cards_in_zone(ZoneType::Battlefield, p0).len(), 0);
        assert_eq!(ctx.game.cards_in_zone(ZoneType::Battlefield, p1).len(), 0);
        assert_eq!(ctx.game.cards_in_zone(ZoneType::Graveyard, p0).len(), 1);
        assert_eq!(ctx.game.cards_in_zone(ZoneType::Graveyard, p1).len(), 1);
    }

    #[test]
    fn destroy_all_indestructible_survives() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        let mortal = make_creature(&mut game, p0, vec![]);
        let immortal = make_creature(&mut game, p0, vec!["Indestructible".to_string()]);
        game.move_card(mortal, ZoneType::Battlefield, p0);
        game.move_card(immortal, ZoneType::Battlefield, p0);

        let sa = SpellAbility::new_simple(
            None,
            p0,
            "A:SP$ DestroyAll | ValidCards$ Creature | NoRegen$ True",
        );
        let mut th = TriggerHandler::new();
        let mut agents: Vec<Box<dyn crate::agent::PlayerAgent>> =
            vec![Box::new(PassAgent), Box::new(PassAgent)];
        let mut mp = vec![ManaPool::default(), ManaPool::default()];
        let templates = HashMap::new();
        let templates_variants: HashMap<(String, String), usize> = HashMap::new();
        let token_fallback: HashMap<String, String> = HashMap::new();
        let edition_dates: HashMap<String, String> = HashMap::new();
        let mut rng_adapter = crate::game_rng::ThreadRngAdapter;
        let mut ctx = make_ctx(
            &mut game,
            &mut agents,
            &mut th,
            &mut mp,
            &templates,
            &templates_variants,
            &token_fallback,
            &edition_dates,
            &mut rng_adapter,
        );
        super::DestroyAllEffect::resolve(&mut ctx, &sa);

        // One creature destroyed, indestructible one stays
        assert_eq!(ctx.game.cards_in_zone(ZoneType::Battlefield, p0).len(), 1);
        assert_eq!(ctx.game.cards_in_zone(ZoneType::Graveyard, p0).len(), 1);
        assert!(ctx.game.card(immortal).has_keyword("Indestructible"));
    }
}
