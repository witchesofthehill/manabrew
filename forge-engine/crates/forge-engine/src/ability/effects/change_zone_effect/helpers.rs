//! Shared helpers for the ChangeZone effect module.
//!
//! Contains: card matching, pre/post move logic, destination resolution,
//! search restrictions, and effect creation.

use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};

use super::super::{
    emit_zone_trigger, matches_change_type, parse_counter_type, parse_zone_type,
    resolve_defined_players, EffectContext,
};
use crate::card::valid_filter::{matches_valid_card_selector_with_context, MatchContext};
use crate::card::Card;
use crate::event::RunParams;
use crate::ids::{CardId, PlayerId};
use crate::parsing::keys;
use crate::parsing::CompiledSelector;
use crate::spellability::SpellAbility;
use crate::staticability::parse_static_ability;
use crate::trigger::TriggerType;

// ─── Card Matching ──────────────────────────────────────────────────────────

/// Check if a card matches a compiled ChangeType selector.
pub(super) fn matches_with_context(
    ctx: &EffectContext,
    sa: &SpellAbility,
    card_id: CardId,
    selector: Option<&CompiledSelector>,
) -> bool {
    let Some(selector) = selector else {
        return true;
    };
    let source = ctx.game.card(sa.source.unwrap_or(card_id));
    let targeted_cards = sa.target_chosen.all_target_cards();
    let targeted_players = sa.target_chosen.all_target_players();
    let match_context = MatchContext::from_source(source)
        .with_game(ctx.game)
        .with_spell_ability(sa)
        .with_targets(&targeted_cards, &targeted_players);
    matches_valid_card_selector_with_context(selector, ctx.game.card(card_id), match_context)
}

/// Check if all candidates are fungible (same card name).
/// NOTE: Not used for search parity — Java always delegates to the player
/// controller even for fungible candidates, so we must do the same to keep
/// agent RNG consumption in sync.
#[allow(dead_code)]
pub(super) fn all_candidates_fungible(ctx: &EffectContext, candidates: &[CardId]) -> bool {
    if candidates.len() <= 1 {
        return true;
    }
    let first_name = &ctx.game.card(candidates[0]).card_name;
    candidates[1..]
        .iter()
        .all(|&cid| ctx.game.card(cid).card_name == *first_name)
}

/// Collect all card IDs currently on the battlefield.
pub(super) fn battlefield_card_ids(ctx: &EffectContext) -> Vec<CardId> {
    ctx.game
        .cards
        .iter()
        .filter(|c| c.zone == ZoneType::Battlefield)
        .map(|c| c.id)
        .collect()
}

// ─── Land Type Utilities ────────────────────────────────────────────────────

const BASIC_LAND_TYPES: &[&str] = &["Plains", "Island", "Swamp", "Mountain", "Forest"];

/// Extract basic land subtypes from a card's subtypes list.
pub(super) fn get_land_subtypes(subtypes: &[String]) -> Vec<String> {
    subtypes
        .iter()
        .filter(|s| {
            BASIC_LAND_TYPES
                .iter()
                .any(|blt| s.eq_ignore_ascii_case(blt))
        })
        .cloned()
        .collect()
}

// ─── Search Restrictions ────────────────────────────────────────────────────

/// Check for Aven Mindcensor — limits search to top N cards.
pub(super) fn find_search_limit(
    ctx: &EffectContext,
    _search_player: PlayerId,
    searcher: PlayerId,
) -> Option<usize> {
    for card in ctx.game.cards.iter() {
        if card.zone != ZoneType::Battlefield || card.controller == searcher {
            continue;
        }
        for kw in card.keywords.iter_strings() {
            if let Some(rest) = kw.strip_prefix("LimitSearchLibrary:") {
                if let Ok(n) = rest.trim().parse::<usize>() {
                    return Some(n);
                }
            }
        }
    }
    None
}

/// Check for Opposition Agent — redirects search control to an opponent.
pub(super) fn find_opposition_agent(ctx: &EffectContext, searcher: PlayerId) -> Option<PlayerId> {
    for card in ctx.game.cards.iter() {
        if card.zone != ZoneType::Battlefield || card.controller == searcher {
            continue;
        }
        for kw in card.keywords.iter_strings() {
            if kw.eq_ignore_ascii_case("OppositionAgent") || kw.contains("ControlSearching") {
                return Some(card.controller);
            }
        }
        if card.card_name == "Opposition Agent" {
            return Some(card.controller);
        }
    }
    None
}

/// Check if a player can search their library (Leonin Arbiter, etc.)
pub(super) fn can_search_library(ctx: &EffectContext, searcher: PlayerId) -> bool {
    for card in ctx.game.cards.iter() {
        if card.zone != ZoneType::Battlefield {
            continue;
        }
        for kw in card.keywords.iter_strings() {
            if kw.eq_ignore_ascii_case("CantSearchLibrary") {
                return false;
            }
            if kw.starts_with("CantSearchLibraryUnlessPaid") && card.controller != searcher {
                return false;
            }
        }
    }
    true
}

// ─── Destination Resolution ─────────────────────────────────────────────────

/// Handle DestinationAlternative$ — player chooses between two destinations.
pub(super) fn resolve_destination(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    dest_zone: ZoneType,
) -> (ZoneType, String) {
    let lib_position = sa.library_position().unwrap_or("").to_string();
    if let Some(alt_dest_str) = sa.destination_alternative() {
        if let Some(alt_zone) = parse_zone_type(alt_dest_str) {
            let alt_lib_pos = sa.library_position_alternative().unwrap_or("0").to_string();
            let chooser = sa.activating_player;
            ctx.agents[chooser.index()].snapshot_state(ctx.game, ctx.mana_pools);
            let options = vec![format!("{:?}", dest_zone), format!("{:?}", alt_zone)];
            let use_alt = ctx.agents[chooser.index()].confirm_action(
                chooser,
                Some("ChangeZoneToAltDestination"),
                "Choose destination",
                &options,
                None,
                None,
            );
            return if use_alt {
                (alt_zone, alt_lib_pos)
            } else {
                (dest_zone, lib_position)
            };
        }
    }
    (dest_zone, lib_position)
}

/// Determine the controller/owner for the destination zone.
pub(super) fn resolve_dest_owner(
    ctx: &EffectContext,
    sa: &SpellAbility,
    card_id: CardId,
    dest_zone: ZoneType,
) -> PlayerId {
    if dest_zone == ZoneType::Battlefield && sa.is_gain_control() {
        gain_control_player(ctx.game, sa)
    } else {
        ctx.game.card(card_id).owner
    }
}

pub(super) fn gain_control_player(game: &crate::game::GameState, sa: &SpellAbility) -> PlayerId {
    match sa.ir.gain_control_text.as_deref() {
        None | Some("True") => sa.activating_player,
        Some(g) => crate::ability::ability_utils::resolve_defined_players_with_sa(
            g,
            sa,
            sa.activating_player,
            game,
        )
        .first()
        .copied()
        .unwrap_or(sa.activating_player),
    }
}

// ─── Pre/Post Move Logic ────────────────────────────────────────────────────

/// Apply pre-move effects. Returns false if the card should NOT be moved.
pub(super) fn apply_pre_move(
    ctx: &mut EffectContext,
    card_id: CardId,
    sa: &SpellAbility,
    dest_zone: ZoneType,
) -> bool {
    // canExiledBy check
    if dest_zone == ZoneType::Exile
        && ctx
            .game
            .card(card_id)
            .keywords
            .contains_string_ignore_case("CantBeExiled")
    {
        return false;
    }

    if dest_zone == ZoneType::Battlefield {
        // FaceDown$ — before move
        if sa.is_face_down() {
            ctx.game.card_mut(card_id).set_face_down(true);
        }

        // Transformed$ — before move
        if sa.is_transformed() {
            if ctx.game.card(card_id).other_part.is_some() {
                ctx.game.card_mut(card_id).set_transformed(true);
                if let Some(other_name) = ctx
                    .game
                    .card(card_id)
                    .other_part
                    .as_ref()
                    .map(|o| o.name.clone())
                {
                    ctx.game.card_mut(card_id).set_card_name(other_name);
                }
            } else {
                return false;
            }
        }

        // AttachedTo$ — choose and attach before ETB
        if let Some(attached_to_def) = sa.attached_to() {
            let valid: Vec<CardId> = battlefield_card_ids(ctx)
                .into_iter()
                .filter(|&cid| matches_change_type(ctx.game.card(cid), attached_to_def, &[]))
                .collect();
            if !valid.is_empty() {
                let ctrl = sa.activating_player;
                ctx.agents[ctrl.index()].snapshot_state(ctx.game, ctx.mana_pools);
                if let Some(target) = ctx.agents[ctrl.index()].choose_single_card_for_zone_change(
                    ctrl,
                    &valid,
                    "Select a card to attach to",
                    false,
                ) {
                    ctx.game.card_mut(card_id).set_attached_to(Some(target));
                    ctx.game.card_mut(target).add_attachment(card_id);
                }
            } else if ctx
                .game
                .card(card_id)
                .type_line
                .subtypes
                .iter()
                .any(|s| s.eq_ignore_ascii_case("Aura"))
            {
                return false;
            }
        }

        // AttachedToPlayer$ — Curses
        if let Some(atp_def) = sa.ir.attached_to_player_text.as_deref() {
            let players = resolve_defined_players(atp_def, sa.activating_player, ctx.game);
            if players.is_empty() {
                return false;
            }
        }
    }

    true
}

/// Apply shared post-move logic for a card entering a destination zone.
pub(super) fn apply_post_move(
    ctx: &mut EffectContext,
    card_id: CardId,
    sa: &SpellAbility,
    old_zone: ZoneType,
    dest_zone: ZoneType,
    dest_owner: PlayerId,
    lib_position: &str,
) {
    let controller = sa.activating_player;
    let exile_source = sa.source.and_then(|source_id| {
        if sa.ir.exiled_with_effect_source {
            ctx.game.card(source_id).effect_source.or(Some(source_id))
        } else {
            None
        }
    });

    if dest_zone == ZoneType::Exile {
        if let Some(exile_source) = exile_source {
            ctx.game.card_mut(card_id).set_exiled_by(Some(exile_source));
        }
    }

    // Remember / Forget / Imprint
    if sa.is_remember_changed() {
        if let Some(sid) = sa.source {
            ctx.game.card_mut(sid).add_remembered_card(card_id);
        }
    }
    if sa.ir.remember_lki_flag {
        if let Some(sid) = sa.source {
            ctx.game.card_mut(sid).add_remembered_card(card_id);
        }
    }
    if dest_zone == ZoneType::Exile && sa.ir.exiled_with_effect_source {
        if let Some(exile_source) = exile_source {
            ctx.game.card_mut(exile_source).add_remembered_card(card_id);
        }
    }
    if sa.is_forget_changed() {
        if let Some(sid) = sa.source {
            ctx.game.card_mut(sid).remove_remembered(card_id);
        }
    }
    if sa.is_imprint() {
        if let Some(sid) = sa.source {
            let cm = ctx.game.card_mut(sid);
            if sa.ir.imprint_last {
                cm.clear_imprinted_cards();
            }
            cm.add_imprinted_card(card_id);
        }
    }

    // Library bottom positioning
    if dest_zone == ZoneType::Library
        && (lib_position == "-1" || lib_position.eq_ignore_ascii_case("Bottom"))
    {
        ctx.game
            .reorder_card_in_zone(ZoneType::Library, dest_owner, card_id, 0);
    }

    // Battlefield entry effects
    if dest_zone == ZoneType::Battlefield {
        if sa.is_tapped() {
            ctx.game.tap(card_id);
        }
        if sa.is_gain_control() {
            let new_controller = gain_control_player(ctx.game, sa);
            ctx.game.card_mut(card_id).set_controller(new_controller);
        }
        if sa.ir.ninjutsu {
            let _ = super::super::add_to_combat(ctx, sa, card_id, keys::NINJUTSU);
        }
        if sa.ir.unearth {
            ctx.game.card_mut(card_id).add_pump_keyword("Haste");
            ctx.game.card_mut(card_id).set_summoning_sick(false);
            ctx.game.card_mut(card_id).set_unearthed(true);
            ctx.trigger_handler
                .register_delayed_trigger(crate::trigger::handler::DelayedTrigger {
                    mode: TriggerType::Phase,
                    trigger_mode: Box::new(crate::trigger::trigger_always::TriggerAlways)
                        as Box<dyn crate::trigger::TriggerBehavior>,
                    params: crate::parsing::Params::default(),
                    execute_svar: "UneartheExileDelayedTrigger".to_string(),
                    controller,
                    source_card: card_id,
                    created_turn: ctx.game.turn.turn_number,
                    created_phase: ctx.game.turn.phase,
                    target_card: Some(card_id),
                    remembered_amount: 0,
                    remembered_cards: Vec::new(),
                    remembered_players: Vec::new(),
                    remembered_lki_cards: Vec::new(),
                    sort_after_active: false,
                    trigger_order: None,
                });
        }
        if sa.ir.attacking || sa.ir.attacking_text.is_some() {
            let _ = super::super::add_to_combat(ctx, sa, card_id, keys::ATTACKING);
        }
        if let Some(counter_type) = sa.with_counters_type_enum() {
            // WithCountersAmount$ goes through the AddCounter replacement chain.
            let amount =
                crate::svar::resolve_numeric_svar(ctx.game, sa, keys::WITH_COUNTERS_AMOUNT, 1);
            if !crate::staticability::static_ability_cant_put_counter::any_cant_put_counter_on_card(
                &ctx.game.cards,
                &ctx.game.cards[card_id.index()],
                counter_type,
            ) {
                let mut add_event =
                    crate::replacement::replacement_handler::ReplacementEvent::AddCounter {
                        target: card_id,
                        counter_type: counter_type.clone(),
                        count: amount,
                        is_effect: true,
                    };
                crate::replacement::replacement_handler::apply_replacements_with_agents(
                    ctx.game,
                    ctx.agents,
                    &mut add_event,
                );
                let final_amount =
                    if let crate::replacement::replacement_handler::ReplacementEvent::AddCounter {
                        count,
                        ..
                    } = add_event
                    {
                        count
                    } else {
                        amount
                    };
                if final_amount > 0 {
                    ctx.game
                        .card_mut(card_id)
                        .add_counter(counter_type, final_amount);
                }
            }
        }
        ctx.trigger_handler
            .register_active_trigger(ctx.game, card_id);

        // AttachAfter$
        if let Some(attach_def) = sa.ir.attach_after_text.as_deref() {
            let valid: Vec<CardId> = battlefield_card_ids(ctx)
                .into_iter()
                .filter(|&cid| {
                    cid != card_id && matches_change_type(ctx.game.card(cid), attach_def, &[])
                })
                .collect();
            if !valid.is_empty() {
                ctx.agents[controller.index()].snapshot_state(ctx.game, ctx.mana_pools);
                if let Some(t) = ctx.agents[controller.index()].choose_single_card_for_zone_change(
                    controller,
                    &valid,
                    "Select a card to attach to",
                    false,
                ) {
                    ctx.game.card_mut(card_id).set_attached_to(Some(t));
                    ctx.game.card_mut(t).add_attachment(card_id);
                }
            }
        }
    }

    // Exile effects
    if dest_zone == ZoneType::Exile {
        if sa.is_exile_face_down() {
            ctx.game.card_mut(card_id).set_face_down(true);
        }
        if !ctx.game.card(card_id).is_token {
            if let Some(sid) = sa.source {
                // Only set exiled_by when the exile has a Duration$ that returns the card
                // when the host leaves. Permanent exile (like Stalking Leonin) should NOT
                // set exiled_by, otherwise the SBA code will incorrectly return the card
                // when the source leaves play.
                let has_return_duration = sa
                    .ir
                    .duration
                    .as_ref()
                    .is_some_and(crate::spellability::AbilityDuration::returns_on_host_leave);
                if has_return_duration {
                    ctx.game.card_mut(card_id).set_exiled_by(Some(sid));
                }
                let src_zone = ctx.game.card(sid).zone;
                let source_active = matches!(
                    src_zone,
                    ZoneType::Battlefield | ZoneType::Stack | ZoneType::Command
                );
                if source_active && !ctx.game.card(sid).remembered_cards.contains(&card_id) {
                    ctx.game.card_mut(sid).add_remembered_card(card_id);
                }
                // Mirrors Java `SpellAbilityEffect.handleExiledWith` — feeds
                // `Card.ExiledWithSource` / `Defined$ ExiledWith` selectors.
                if source_active {
                    ctx.game.card_mut(sid).add_imprinted_card(card_id);
                }
            }
        }
        ctx.trigger_handler.run_trigger(
            TriggerType::Exiled,
            RunParams {
                card: Some(card_id),
                origin: Some(old_zone),
                destination: Some(dest_zone),
                ..Default::default()
            },
            false,
        );

        if sa.ir.foretold {
            ctx.game.card_mut(card_id).set_foretold(true);
            if sa.ir.foretold_cost {
                ctx.game.card_mut(card_id).set_foretold_cost_by_effect(true);
            }
        }

        // Warp keyword
        let is_warp = sa.ir.warp
            || (sa.trigger_source.is_some()
                && ctx
                    .game
                    .card(card_id)
                    .keywords
                    .contains_string_ignore_case("Warp"));
        if is_warp {
            create_warp_effect(ctx, sa, card_id);
        }
    }

    if sa.ir.track_discarded {
        ctx.game.card_mut(card_id).set_discarded(true);
    }

    // Champion$
    if sa.ir.champion {
        ctx.trigger_handler.run_trigger(
            TriggerType::ChangesZone,
            RunParams {
                card: Some(card_id),
                origin: Some(old_zone),
                destination: Some(dest_zone),
                player: Some(controller),
                ..Default::default()
            },
            false,
        );
    }

    // WithNotedCounters$
    if sa.ir.with_noted_counters {
        if let Some(sid) = sa.source {
            let noted = ctx.game.card(sid).remembered_cmc.clone();
            let amount: i32 = noted.iter().sum();
            if amount > 0 {
                let ct = sa
                    .with_counters_type_enum()
                    .cloned()
                    .unwrap_or_else(|| parse_counter_type("P1P1"));
                ctx.game.card_mut(card_id).add_counter(&ct, amount);
            }
        }
    }

    emit_zone_trigger(ctx.trigger_handler, card_id, old_zone, dest_zone);
    ctx.trigger_handler.flush_waiting_triggers(ctx.game);
}

// ─── Warp Effect ────────────────────────────────────────────────────────────

fn create_warp_effect(ctx: &mut EffectContext, sa: &SpellAbility, exiled_card_id: CardId) {
    let controller = sa.activating_player;
    let card_name = ctx.game.card(exiled_card_id).card_name.clone();
    let mut effect = Card::new(
        CardId(0),
        format!("Warped {}", card_name),
        controller,
        CardTypeLine::parse("Effect"),
        ManaCost::parse("0"),
        ColorSet::COLORLESS,
        None,
        None,
        vec![],
        vec![],
    );
    effect.set_controller(controller);
    effect.set_effect_source(sa.source);
    effect.add_remembered_card(exiled_card_id);
    effect.set_forget_on_moved_origin(Some(ZoneType::Exile));
    let static_text = "Mode$ Continuous | MayPlay$ True | EffectZone$ Command | Affected$ Card.IsRemembered+nonLand | AffectedZone$ Exile";
    if let Some(parsed) = parse_static_ability(&format!("S$ {}", static_text)) {
        effect.add_static_ability(parsed);
    }
    let eid = ctx.game.create_card(effect);
    ctx.move_card(eid, ZoneType::Command, controller);
}
