//! DamageResolve — resolve accumulated damage from a damage map.
//! Ported from Java's DamageResolveEffect.

use super::EffectContext;
use crate::card::card_damage_map::DamageTarget;
use crate::card::CounterType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `DamageResolveEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(DamageResolveEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let from_pending = sa.damage_map.is_none();
    let damage_map_owned = sa
        .damage_map
        .clone()
        .or_else(|| ctx.game.pending_damage_map.clone());
    let Some(damage_map) = damage_map_owned.as_ref() else {
        return;
    };

    let prevent_map_owned = sa
        .prevent_map
        .clone()
        .or_else(|| ctx.game.pending_prevent_map.clone());
    if let Some(prevent_map) = prevent_map_owned.as_ref() {
        prevent_map.trigger_prevent_damage(ctx.trigger_handler, false);
    }

    for (source, target, amount) in damage_map.entries() {
        if amount <= 0 {
            continue;
        }
        match target {
            DamageTarget::Card(cid) => {
                if ctx.game.card(cid).zone == forge_foundation::ZoneType::Battlefield {
                    // Protection prevents damage from matching sources.
                    if crate::staticability::static_ability_colorless_damage_source::target_is_protected_from_source(
                        &ctx.game.cards,
                        ctx.game.card(cid),
                        ctx.game.card(source),
                    ) {
                        continue;
                    }

                    if !ctx
                        .game
                        .card(cid)
                        .damage_sources_this_turn
                        .contains(&source)
                    {
                        ctx.game.card_mut(cid).add_damage_source_this_turn(source);
                    }

                    let source_has_infect = ctx.game.card(source).has_infect();
                    let source_has_wither = ctx.game.card(source).has_wither()
                        || crate::staticability::static_ability_wither_damage::is_wither_damage(
                            &ctx.game.cards,
                            ctx.game.card(source),
                        );

                    if source_has_infect || source_has_wither {
                        if !crate::staticability::static_ability_cant_put_counter::any_cant_put_counter_on_card(
                            &ctx.game.cards,
                            ctx.game.card(cid),
                            &CounterType::M1M1,
                        ) {
                            ctx.game.card_mut(cid).add_counter(&CounterType::M1M1, amount);
                        }
                    } else {
                        ctx.game.deal_damage_to_card(cid, amount);
                    }
                }
            }
            DamageTarget::Player(pid) => {
                let source_has_infect = ctx.game.card(source).has_infect()
                    || crate::staticability::static_ability_infect_damage::is_infect_damage(
                        ctx.game,
                        &ctx.game.cards,
                        pid,
                        ctx.game.card(source).controller,
                    );
                if source_has_infect {
                    if !crate::staticability::static_ability_cant_put_counter::any_cant_put_counter_on_player(
                        &ctx.game.cards,
                        pid,
                        &CounterType::Poison,
                    ) {
                        ctx.game.player_add_poison(pid, amount);
                    }
                } else {
                    let dealt = ctx.game.deal_damage_to_player(pid, amount);
                    ctx.game
                        .record_player_damage_assignment(Some(source), Some(pid), dealt, false);
                }
            }
        }

        // Track source total damage for count expressions.
        ctx.game.card_mut(source).total_damage_done_this_turn += amount;
        ctx.game
            .card_mut(source)
            .damage_history
            .record_damage(amount, false);
    }

    damage_map.trigger_damage_done_once(ctx.game, ctx.trigger_handler, false);

    // Pre-match DamageDoneOnce triggers while damaged creatures are still on
    // the battlefield.  SBAs run after effect resolution and would move
    // lethally damaged creatures to the graveyard, causing their "when dealt
    // damage" triggers (e.g. Raptor Hatchling Enrage) to fail the active-zone
    // check.  Flushing now stores them as pre-matched so they survive SBA.
    ctx.trigger_handler.flush_waiting_triggers(ctx.game);

    // Java parity hook (currently a no-op helper until full replacement wiring lands).
    let _ = crate::ability::spell_ability_effect::replace_dying(ctx.game, sa);

    if from_pending {
        ctx.game.clear_pending_damage_maps();
    }
}

#[cfg(test)]
mod tests {
    use crate::ability::spell_ability_effect::SpellAbilityEffect;
    use std::collections::HashMap;

    use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};

    use crate::ability::effects::EffectContext;
    use crate::agent::{PassAgent, PlayerAgent};
    use crate::card::card_damage_map::{CardDamageMap, DamageTarget};
    use crate::card::Card;
    use crate::game::GameState;
    use crate::ids::{CardId, PlayerId};
    use crate::mana::ManaPool;
    use crate::spellability::SpellAbility;
    use crate::trigger::handler::TriggerHandler;

    fn creature(game: &mut GameState, owner: PlayerId, name: &str) -> CardId {
        let c = Card::new(
            CardId(0),
            name.to_string(),
            owner,
            CardTypeLine::parse("Creature"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            Some(2),
            Some(2),
            vec![],
            vec![],
        );
        let id = game.create_card(c);
        game.move_card(id, ZoneType::Battlefield, owner);
        id
    }

    #[test]
    fn damage_resolve_consumes_pending_damage_map() {
        let mut game = GameState::new(&["A", "B"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);
        let src = creature(&mut game, p0, "Src");
        let tgt = creature(&mut game, p1, "Tgt");

        let mut map = CardDamageMap::default();
        map.put(src, DamageTarget::Card(tgt), 2);
        map.put(src, DamageTarget::Player(p1), 1);
        game.pending_damage_map = Some(map);
        game.pending_prevent_map = Some(CardDamageMap::default());

        let sa = SpellAbility::new_simple(Some(src), p0, "DB$ DamageResolve");
        let mut th = TriggerHandler::new();
        let mut agents: Vec<Box<dyn PlayerAgent>> = vec![Box::new(PassAgent), Box::new(PassAgent)];
        let mut pools = vec![ManaPool::default(), ManaPool::default()];
        let templates = HashMap::new();
        let templates_variants = HashMap::new();
        let token_fallback = HashMap::new();
        let edition_dates: HashMap<String, String> = HashMap::new();
        let mut rng = crate::game_rng::ThreadRngAdapter;
        let mut ctx = EffectContext {
            game: &mut game,
            combat: None,
            agents: &mut agents,
            trigger_handler: &mut th,
            token_templates: &templates,
            token_art_variants: &templates_variants,
            token_fallback: &token_fallback,
            edition_dates: &edition_dates,
            mana_pools: &mut pools,
            parent_target_card: None,
            rng: &mut rng,
        };

        super::DamageResolveEffect::resolve(&mut ctx, &sa);

        assert_eq!(ctx.game.card(tgt).damage, 2);
        assert_eq!(ctx.game.player(p1).life, 19);
        assert!(ctx.game.pending_damage_map.is_none());
        assert!(ctx.game.pending_prevent_map.is_none());
    }

    #[test]
    fn damage_resolve_replace_dying_exiles_lethal_target() {
        let mut game = GameState::new(&["A", "B"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);
        let src = creature(&mut game, p0, "Scorching Dragonfire");
        let tgt = creature(&mut game, p1, "Talruum Minotaur");

        let mut map = CardDamageMap::default();
        map.put(src, DamageTarget::Card(tgt), 3);
        game.pending_damage_map = Some(map);
        game.pending_prevent_map = Some(CardDamageMap::default());

        let mut sa = SpellAbility::new_simple(
            Some(src),
            p0,
            "DB$ DamageResolve | ReplaceDyingDefined$ Targeted",
        );
        sa.target_chosen.target_card = Some(tgt);

        let mut th = TriggerHandler::new();
        let mut agents: Vec<Box<dyn PlayerAgent>> = vec![Box::new(PassAgent), Box::new(PassAgent)];
        let mut pools = vec![ManaPool::default(), ManaPool::default()];
        let templates = HashMap::new();
        let templates_variants = HashMap::new();
        let token_fallback = HashMap::new();
        let edition_dates: HashMap<String, String> = HashMap::new();
        let mut rng = crate::game_rng::ThreadRngAdapter;
        let mut ctx = EffectContext {
            game: &mut game,
            combat: None,
            agents: &mut agents,
            trigger_handler: &mut th,
            token_templates: &templates,
            token_art_variants: &templates_variants,
            token_fallback: &token_fallback,
            edition_dates: &edition_dates,
            mana_pools: &mut pools,
            parent_target_card: None,
            rng: &mut rng,
        };

        super::DamageResolveEffect::resolve(&mut ctx, &sa);
        assert_eq!(ctx.game.card(tgt).zone, ZoneType::Battlefield);
        assert!(ctx.game.cards.iter().any(|c| {
            c.zone == ZoneType::Command
                && c.remembered_cards == vec![tgt]
                && !c.replacement_effects.is_empty()
        }));

        assert!(ctx.game.check_state_based_actions());
        assert_eq!(ctx.game.card(tgt).zone, ZoneType::Exile);
        assert!(!ctx.game.cards.iter().any(|c| c.zone == ZoneType::Command));
    }
}
