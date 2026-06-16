use forge_foundation::ZoneType;

use super::{resolve_numeric_svar, EffectContext};
use crate::ability::ability_ir::EffectIr;
use crate::ability::AbilityKey;
use crate::card::card_damage_map::DamageTarget;
use crate::card::valid_filter::{self, MatchContext};
use crate::ids::CardId;
use crate::parsing::keys;
use crate::spellability::SpellAbility;

/// `SP$ DamageAll` — deal N damage to all matching permanents and/or players.
///
/// Mirrors Java's `DamageAllEffect.java`:
/// - `ValidCards$` selects which battlefield permanents receive damage.
/// - `ValidPlayers$` set to "Player" also deals damage to every player.
/// - `NumDmg$` specifies the amount (integer or SVar reference).
///
/// # Card script examples
/// ```text
/// A:SP$ DamageAll | NumDmg$ 2 | ValidCards$ Creature
/// A:SP$ DamageAll | ValidCards$ Creature.withFlying | ValidPlayers$ Player | NumDmg$ X
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `DamageAllEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(DamageAllEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let num_dmg = resolve_damage_all_amount(ctx, sa);
    if num_dmg <= 0 {
        return;
    }

    let activating_player = sa.activating_player;
    let valid_cards_filter = sa.ir.valid_cards_selector.as_ref();
    let valid_players = sa.ir.valid_players_selector.as_ref();
    let use_damage_map = ctx.game.pending_damage_map.is_some() || sa.ir.damage_map;
    if sa.ir.damage_map {
        ctx.game.ensure_pending_damage_maps();
    }

    let player_ids = ctx.game.player_order.clone();

    // Pass 1 — collect matching battlefield permanents
    let mut to_damage: Vec<CardId> = Vec::new();
    if valid_cards_filter.is_some() {
        for &pid in &player_ids {
            let zone_cards = ctx.game.cards_in_zone(ZoneType::Battlefield, pid).to_vec();
            for cid in zone_cards {
                if damage_all_matches_valid_card(ctx, sa, valid_cards_filter.unwrap(), cid) {
                    to_damage.push(cid);
                }
            }
        }
    }

    // Check source card for Infect/Wither keywords
    let source = sa.source;
    let (source_has_infect_keyword, source_has_wither) = if let Some(src_id) = source {
        let src = ctx.game.card(src_id);
        (
            src.has_infect(),
            src.has_wither()
                || crate::staticability::static_ability_wither_damage::is_wither_damage(
                    &ctx.game.cards,
                    src,
                ),
        )
    } else {
        (false, false)
    };

    // Pass 2 — apply damage to collected permanents
    let source = sa.source;
    for card_id in to_damage {
        if ctx.game.card(card_id).zone == ZoneType::Battlefield {
            // Protection: prevents all damage from matching sources
            if let Some(src_id) = source {
                if crate::staticability::static_ability_colorless_damage_source::target_is_protected_from_source(
                    &ctx.game.cards,
                    ctx.game.card(card_id),
                    ctx.game.card(src_id),
                ) {
                    continue;
                }
            }

            // Track damage source for DamagedBy trigger filters
            if let Some(src_id) = source {
                if !ctx
                    .game
                    .card(card_id)
                    .damage_sources_this_turn
                    .contains(&src_id)
                {
                    ctx.game
                        .card_mut(card_id)
                        .damage_sources_this_turn
                        .push(src_id);
                }
            }
            if source_has_infect_keyword || source_has_wither {
                // Infect/Wither: damage to creatures as -1/-1 counters
                if use_damage_map {
                    if let Some(src_id) = source {
                        if let Some(map) = ctx.game.pending_damage_map.as_mut() {
                            map.put(src_id, DamageTarget::Card(card_id), num_dmg);
                        }
                    }
                } else if !crate::staticability::static_ability_cant_put_counter::any_cant_put_counter_on_card(
                    &ctx.game.cards,
                    ctx.game.card(card_id),
                    &crate::card::CounterType::M1M1,
                ) {
                    ctx.game
                        .card_mut(card_id)
                        .add_counter(&crate::card::CounterType::M1M1, num_dmg);
                }
            } else if use_damage_map {
                if let Some(src_id) = source {
                    if let Some(map) = ctx.game.pending_damage_map.as_mut() {
                        map.put(src_id, DamageTarget::Card(card_id), num_dmg);
                    }
                }
            } else {
                ctx.game.deal_damage_to_card(card_id, num_dmg);
            }

            // Fire DamageDone trigger per card
            if !use_damage_map {
                ctx.trigger_handler.run_trigger(
                    crate::trigger::TriggerType::DamageDone,
                    crate::event::RunParams {
                        damage_source: source,
                        damage_target_card: Some(card_id),
                        damage_amount: Some(num_dmg),
                        is_combat_damage: Some(false),
                        ..Default::default()
                    },
                    false,
                );
            }
        }
    }

    // Deal damage to each matching player if ValidPlayers$ is set
    if let Some(valid_players) = valid_players {
        for pid in player_ids {
            if !valid_filter::matches_valid_player_selector(valid_players, pid, activating_player) {
                continue;
            }
            let source_has_infect = if let Some(src_id) = source {
                let src = ctx.game.card(src_id);
                source_has_infect_keyword
                    || crate::staticability::static_ability_infect_damage::is_infect_damage(
                        ctx.game,
                        &ctx.game.cards,
                        pid,
                        src.controller,
                    )
            } else {
                false
            };
            if source_has_infect {
                if use_damage_map {
                    if let Some(src_id) = source {
                        if let Some(map) = ctx.game.pending_damage_map.as_mut() {
                            map.put(src_id, DamageTarget::Player(pid), num_dmg);
                        }
                    }
                } else if !crate::staticability::static_ability_cant_put_counter::any_cant_put_counter_on_player(
                    &ctx.game.cards,
                    pid,
                    &crate::card::CounterType::Poison,
                ) {
                    ctx.game.player_add_poison(pid, num_dmg);
                }
            } else if use_damage_map {
                if let Some(src_id) = source {
                    if let Some(map) = ctx.game.pending_damage_map.as_mut() {
                        map.put(src_id, DamageTarget::Player(pid), num_dmg);
                    }
                }
            } else {
                let dealt = ctx.game.deal_damage_to_player(pid, num_dmg);
                ctx.game
                    .record_player_damage_assignment(source, Some(pid), dealt, false);
            }

            // Fire DamageDone trigger per player
            if !use_damage_map {
                ctx.trigger_handler.run_trigger(
                    crate::trigger::TriggerType::DamageDone,
                    crate::event::RunParams {
                        damage_source: source,
                        damage_target_player: Some(pid),
                        damage_amount: Some(num_dmg),
                        is_combat_damage: Some(false),
                        ..Default::default()
                    },
                    false,
                );
            }
        }
    }
}

fn resolve_damage_all_amount(ctx: &EffectContext, sa: &SpellAbility) -> i32 {
    if let Some(EffectIr::DamageAll(ir)) = &sa.ir.effect {
        if let Some(amount) = &ir.amount {
            let resolved = amount.resolve_for_spell_ability(ctx.game, sa, 0);
            #[cfg(debug_assertions)]
            debug_assert_eq!(
                resolved,
                resolve_numeric_svar(ctx.game, sa, keys::NUM_DMG, 0),
                "compiled DamageAll amount diverged from string params"
            );
            return resolved;
        }
    }

    resolve_numeric_svar(ctx.game, sa, keys::NUM_DMG, 0)
}

fn damage_all_matches_valid_card(
    ctx: &EffectContext,
    sa: &SpellAbility,
    selector: &crate::parsing::CompiledSelector,
    card_id: CardId,
) -> bool {
    let Some(source_id) = sa.source else {
        return crate::ability::ability_utils::matches_valid_cards_selector_opt(
            Some(selector),
            ctx.game.card(card_id),
            sa.activating_player,
        );
    };
    let source = ctx.game.card(source_id);
    let targeted_cards = sa.target_chosen.all_target_cards();
    let targeted_players = sa.target_chosen.all_target_players();
    let triggering_card = sa.get_triggering_card(AbilityKey::Target);
    let triggering_player = sa.get_triggering_player(AbilityKey::Target);
    valid_filter::matches_valid_card_selector_with_context(
        selector,
        ctx.game.card(card_id),
        MatchContext::from_source(source)
            .with_game(ctx.game)
            .with_targets(&targeted_cards, &targeted_players)
            .with_triggering(triggering_card, triggering_player),
    )
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
    fn damage_all_deals_to_each_creature() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);
        let c1 = make_creature(&mut game, p0);
        let c2 = make_creature(&mut game, p1);
        game.move_card(c1, ZoneType::Battlefield, p0);
        game.move_card(c2, ZoneType::Battlefield, p1);

        let sa = SpellAbility::new_simple(
            None,
            p0,
            "A:SP$ DamageAll | NumDmg$ 2 | ValidCards$ Creature",
        );
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
        super::DamageAllEffect::resolve(&mut ctx, &sa);

        assert_eq!(ctx.game.card(c1).damage, 2);
        assert_eq!(ctx.game.card(c2).damage, 2);
        // Players not affected (no ValidPlayers$)
        assert_eq!(ctx.game.player(p0).life, 20);
        assert_eq!(ctx.game.player(p1).life, 20);
    }

    #[test]
    fn damage_all_with_valid_players() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);

        let sa = SpellAbility::new_simple(
            None,
            p0,
            "A:SP$ DamageAll | NumDmg$ 3 | ValidCards$ | ValidPlayers$ Player",
        );
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
        super::DamageAllEffect::resolve(&mut ctx, &sa);

        assert_eq!(ctx.game.player(p0).life, 17);
        assert_eq!(ctx.game.player(p1).life, 17);
    }
}
