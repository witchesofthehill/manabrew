use forge_foundation::ZoneType;

use super::EffectContext;
use crate::agent::{GameEntity, GameLogEvent};
use crate::event::RunParams;
use crate::ids::CardId;
use crate::spellability::{SpellAbility, StackEntry};
use crate::trigger::TriggerType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy
#[manabrew_engine_macros::spell_effect(PlayEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let mut candidates = resolve_target_cards(ctx, sa);
    candidates.retain(|&cid| ctx.game.card(cid).zone != ZoneType::Stack);
    if candidates.is_empty() {
        return;
    }

    let controller = sa.activating_player;
    let without_mana_cost = sa.ir.without_mana_cost;
    let play_cost = sa.ir.play_cost_text.clone();
    let remember = sa.ir.remember_played;
    let optional = sa.ir.optional;
    let is_madness = sa.ir.play_cost_text.is_some()
        && sa
            .source
            .is_some_and(|src| ctx.game.card(src).has_keyword("Madness"));

    // ── Step 1: Choose card
    // For single-card + optional: isOptional=false (auto-pick), then confirmAction below.
    let single_option = candidates.len() == 1 && optional;
    let tgt_cards: Vec<_> = candidates.iter().copied().map(GameEntity::Card).collect();
    let chosen = ctx.agents[controller.index()].choose_single_entity_for_effect(
        controller,
        &tgt_cards,
        !single_option && optional,
    );
    let card_id = match chosen {
        Some(GameEntity::Card(cid)) => cid,
        None => return,
        Some(GameEntity::Player(_)) => return,
    };

    // ── Step 2: Optional confirm — Java only asks the outer "Do you want
    // to play X?" prompt in the single-option case (`PlayEffect.java:250`).
    // For multi-option, the chooser at Step 1 already lets the player decline
    // by returning `None`. The non-mandatory-cost confirm below is separate.
    if single_option {
        let card_name = ctx.game.card(card_id).card_name.clone();
        let accepted = ctx.agents[controller.index()].confirm_action(
            controller,
            None,
            &format!("Do you want to play {}?", card_name),
            &[],
            Some(card_id),
            Some(crate::ability::api_type::ApiType::Play),
        );
        if !accepted {
            return;
        }
    }

    // ── Step 3: Get ability to play
    let spell_sa_base =
        crate::spellability::build_spell_ability_for_card_cast(ctx.game, card_id, controller);
    let abilities = vec![spell_sa_base];
    let sa_idx = ctx.agents[controller.index()].get_ability_to_play(controller, &abilities);
    let mut spell_sa = match sa_idx {
        Some(idx) => abilities.into_iter().nth(idx).unwrap(),
        None => return,
    };

    // ── Step 3: Cost replacement ────────────────────────────────────
    if without_mana_cost {
        if let Some(ref mut cost) = spell_sa.pay_costs {
            cost.parts
                .retain(|part| !matches!(part, crate::cost::CostPart::Mana { .. }));
        }
    } else if let Some(ref cost_str) = play_cost {
        let alt_mc = forge_foundation::ManaCost::parse(cost_str);
        if let Some(ref existing) = spell_sa.pay_costs {
            spell_sa.pay_costs = Some(existing.copy_with_defined_mana(alt_mc));
        }
    }

    // ── Step 4: Alt-cost flags ──────────────────────────────────────
    if is_madness {
        spell_sa.alt_cost = Some(crate::spellability::AlternativeCost::Madness);
    }

    if let Some(ref mut cost) = spell_sa.pay_costs {
        cost.mandatory = true;
    }

    // Remove zone restriction — allow casting from exile/library/etc.
    spell_sa.ir.cast_from_play_effect = true;

    if !spell_sa.setup_targets(ctx.game, ctx.agents, ctx.mana_pools) {
        return;
    }

    // ── Step 6: Pay mana ────────────────────────────────────────────
    if !without_mana_cost {
        let mc = if let Some(ref cost_str) = play_cost {
            forge_foundation::ManaCost::parse(cost_str)
        } else {
            ctx.game.card(card_id).mana_cost.clone()
        };

        let available = crate::mana::calculate_available_mana(
            &ctx.mana_pools[controller.index()],
            ctx.game,
            controller,
        );
        if !available.can_pay(&mc) {
            return;
        }
        let tapped = crate::mana::auto_tap_lands(
            ctx.game,
            &mut ctx.mana_pools[controller.index()],
            controller,
            &mc,
            Some(card_id),
        );
        for &land_id in &tapped {
            ctx.trigger_handler.run_trigger(
                TriggerType::TapsForMana,
                RunParams {
                    card: Some(land_id),
                    player: Some(controller),
                    ..Default::default()
                },
                false,
            );
        }
        ctx.mana_pools[controller.index()].try_pay(&mc);
    }

    // `ReplaceGraveyard$ <Zone>` — install a one-shot replacement that
    // reroutes the played card if it would be put into the graveyard
    // (e.g. Diviner of Mist exiles the spell on resolve).
    if let Some(zone) = sa.ir.replace_graveyard.clone() {
        let host_card = sa.source.unwrap_or(card_id);
        add_replace_graveyard_effect(ctx, card_id, host_card, sa, &zone);
    }

    // ── Step 7: Push to stack ───────────────────────────────────────
    let label = if is_madness {
        "Madness"
    } else if without_mana_cost {
        "Rebound"
    } else {
        "Play"
    };
    push_spell_to_stack(ctx, card_id, spell_sa, label);

    // ── Step 8: RememberPlayed ──────────────────────────────────────
    if remember {
        if let Some(source_id) = sa.source {
            ctx.game.card_mut(source_id).remembered_cards.push(card_id);
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────

/// Resolve the target cards from `Valid$` or `Defined$` parameters.
fn resolve_target_cards(ctx: &EffectContext, sa: &SpellAbility) -> Vec<CardId> {
    if let Some(valid) = crate::parsing::raw_get(&sa.ability_text, crate::parsing::keys::VALID) {
        let zones = crate::parsing::raw_get(&sa.ability_text, crate::parsing::keys::VALID_ZONE)
            .map(|raw| {
                raw.split(',')
                    .filter_map(|part| crate::zone::zone_type::smart_value_of(part.trim()))
                    .collect::<Vec<_>>()
            })
            .filter(|zones| !zones.is_empty())
            .unwrap_or_else(|| vec![ZoneType::Hand]);
        let Some(source_id) = sa.source else {
            return Vec::new();
        };
        let source = ctx.game.card(source_id);
        let selector = crate::parsing::cached_compiled_selector(&valid);
        let valid_sa = crate::parsing::raw_get(&sa.ability_text, crate::parsing::keys::VALID_SA);
        return ctx
            .game
            .cards
            .iter()
            .filter(|card| zones.contains(&card.zone))
            .filter(|card| {
                crate::card::valid_filter::matches_valid_card_selector_in_game(
                    &selector, card, source, ctx.game,
                )
            })
            .filter(|card| {
                if valid_sa
                    .as_deref()
                    .is_some_and(|v| v.eq_ignore_ascii_case("Spell"))
                {
                    !card.is_land()
                } else {
                    true
                }
            })
            .map(|card| card.id)
            .collect();
    }

    let defined = sa.ir.defined_text.clone().unwrap_or_default();
    if let Some(uid_str) = defined.strip_prefix("CardUID_") {
        uid_str
            .parse::<u32>()
            .ok()
            .map(CardId)
            .into_iter()
            .collect()
    } else {
        let defined = if defined.is_empty() {
            "Self"
        } else {
            defined.as_str()
        };
        crate::ability::ability_utils::get_defined_cards(
            ctx.game,
            sa.source,
            defined,
            Some(sa.activating_player),
        )
    }
}

/// Push the spell onto the stack and fire SpellCast trigger.
fn push_spell_to_stack(
    ctx: &mut EffectContext,
    card_id: CardId,
    spell_sa: SpellAbility,
    label: &str,
) {
    let controller = spell_sa.activating_player;
    let is_creature = ctx.game.card(card_id).is_creature();
    let is_permanent = ctx.game.card(card_id).is_permanent();
    let cast_zone = Some(ctx.game.card(card_id).zone);
    let card_name = ctx.game.card(card_id).card_name.clone();
    let chosen_target = spell_sa.target_chosen.target_card;

    let entry = StackEntry {
        id: 0,
        spell_ability: spell_sa,
        is_pending_cast: false,
        is_creature_spell: is_creature,
        is_permanent_spell: is_permanent,
        cast_from_zone: cast_zone,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    let trigger_sa = entry.spell_ability.clone();

    ctx.game.stack.push(entry);
    ctx.move_card(card_id, ZoneType::Stack, controller);
    ctx.game.player_record_spell_cast(controller, card_id);

    ctx.trigger_handler.run_trigger(
        TriggerType::SpellCast,
        RunParams {
            spell_card: Some(card_id),
            spell_controller: Some(controller),
            source_sa: Some(trigger_sa.clone()),
            ..Default::default()
        },
        false,
    );
    super::emit_targeting_triggers(ctx, card_id, &trigger_sa);

    let mut event = GameLogEvent::stack(format!("{}: cast {}", label, card_name))
        .with_player(controller)
        .with_source_card(card_id);
    if let Some(target_id) = chosen_target {
        event = event.with_target_card(target_id);
    }
    crate::agent::notify_all_agents(ctx.agents, event);
}

/// Create a one-shot replacement effect on a Command-zone effect card that
/// reroutes `card_id` to `dest_zone` if it would be put into the graveyard
/// from the stack (e.g. Diviner of Mist's `ReplaceGraveyard$ Exile`).
pub fn add_replace_graveyard_effect(
    ctx: &mut EffectContext,
    card_id: CardId,
    _host_card: CardId,
    sa: &SpellAbility,
    zone: &str,
) {
    let controller = sa.activating_player;
    let dest_zone = if zone.is_empty() { "Exile" } else { zone };

    let mut effect = crate::player::player_factory_util::new_player_effect_card(
        controller,
        "ReplaceGraveyard Effect",
        None,
    );
    effect.remembered_cards.push(card_id);
    let raw = format!(
        "R$ Event$ Moved | ValidCard$ Card.IsRemembered | Origin$ Stack | Destination$ Graveyard | NewDestination$ {} | ForgetOnMoved$ Origin | Description$ If that card would be put into your graveyard this turn, put it into {} instead.",
        dest_zone, dest_zone
    );
    crate::player::player_factory_util::add_replacement_effect(&mut effect, &raw);
    effect.exile_when_no_remembered = true;
    effect.forget_on_moved_origin = Some(ZoneType::Stack);

    let effect_id = ctx.game.create_card(effect);
    ctx.game.move_card(effect_id, ZoneType::Command, controller);
}
