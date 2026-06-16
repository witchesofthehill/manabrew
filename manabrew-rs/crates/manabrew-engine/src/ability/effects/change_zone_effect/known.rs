//! Known-origin zone change resolution.
//!
//! Handles targeted/defined cards from visible zones (Battlefield, Graveyard, etc.)
//! Mirrors Java's `changeKnownOriginResolve`.

use forge_foundation::ZoneType;

use super::super::EffectContext;
use super::helpers::resolve_destination;
use super::move_cards::move_cards;
use super::search::resolve_defined_player_choice;
use super::stack::resolve_stack_removal;
use crate::ability::ability_ir::DefinedRef;
use crate::ids::CardId;
use crate::spellability::SpellAbility;

fn parse_trigger_object_cards(sa: &SpellAbility, key: &str) -> Vec<CardId> {
    crate::ability::ability_key::from_string(key)
        .map(|ability_key| sa.get_triggering_cards(ability_key))
        .unwrap_or_default()
}

/// Resolve zone changes from known/visible zones or targeted cards.
pub(super) fn resolve_known_origin(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    origin_zone: ZoneType,
    dest_zone: ZoneType,
) {
    let (dest_zone, lib_position) = resolve_destination(ctx, sa, dest_zone);
    let defined = sa.defined().unwrap_or("").to_string();
    let defined_ref = sa.defined_ref();
    let controller = sa.activating_player;

    // Unimprint$ — clear before processing (Java line 506)
    if sa.ir.unimprint {
        if let Some(source_id) = sa.source {
            ctx.game.card_mut(source_id).clear_imprinted_cards();
        }
    }

    // Stack removal path (Java lines 488-500)
    if origin_zone == ZoneType::Stack {
        resolve_stack_removal(ctx, sa, dest_zone, &lib_position, controller);
        return;
    }

    let cards_to_move: Vec<CardId> = if sa.uses_targeting() {
        if sa.overloaded && origin_zone == ZoneType::Battlefield {
            // Overload: target → each. Mirrors damage_deal_effect / pump_effect.
            let valid_tgts = sa
                .target_restrictions
                .as_ref()
                .and_then(|restrictions| restrictions.valid_tgts.first())
                .map(String::as_str)
                .unwrap_or_default();
            let valid_tgts_selector = sa
                .target_restrictions
                .as_ref()
                .map(|restrictions| &restrictions.valid_tgts_selector);
            ctx.game
                .player_order
                .clone()
                .iter()
                .flat_map(|&pid| ctx.game.cards_in_zone(ZoneType::Battlefield, pid).to_vec())
                .filter(|&cid| ctx.game.card(cid).zone == ZoneType::Battlefield)
                .filter(|&cid| {
                    super::super::matches_valid_cards_for_sa(
                        ctx.game,
                        sa,
                        ctx.game.card(cid),
                        valid_tgts_selector,
                        valid_tgts,
                    )
                })
                .collect()
        } else {
            let targeted_cards: Vec<CardId> = sa
                .target_chosen
                .all_target_cards()
                .into_iter()
                .filter(|&cid| ctx.game.card(cid).zone == origin_zone)
                .collect();

            if !targeted_cards.is_empty() || sa.defined_player().is_none() {
                targeted_cards
            } else {
                resolve_defined_player_choice(ctx, sa, origin_zone)
            }
        }
    } else if matches!(
        defined_ref,
        Some(DefinedRef::TriggeredCard | DefinedRef::TriggeredCardLkiCopy)
    ) {
        let cards = parse_trigger_object_cards(sa, "Card");
        if cards.is_empty() {
            sa.trigger_source
                .filter(|&cid| ctx.game.card(cid).zone == origin_zone)
                .into_iter()
                .collect()
        } else {
            cards
                .into_iter()
                .filter(|&cid| ctx.game.card(cid).zone == origin_zone)
                .collect()
        }
    } else if matches!(
        defined_ref,
        Some(DefinedRef::TriggeredNewCard | DefinedRef::TriggeredNewCardLkiCopy)
    ) {
        let cards = parse_trigger_object_cards(sa, "NewCard");
        if cards.is_empty() {
            sa.trigger_source
                .filter(|&cid| ctx.game.card(cid).zone == origin_zone)
                .into_iter()
                .collect()
        } else {
            cards
                .into_iter()
                .filter(|&cid| ctx.game.card(cid).zone == origin_zone)
                .collect()
        }
    } else if matches!(
        defined_ref,
        Some(
            DefinedRef::DelayTriggerRemembered
                | DefinedRef::DelayTriggerRememberedLki
                | DefinedRef::RememberedLki
        )
    ) {
        let cards = if matches!(defined_ref, Some(DefinedRef::DelayTriggerRemembered)) {
            sa.trigger_remembered
                .iter()
                .flat_map(|value| match value {
                    crate::event::AbilityValue::Card(card_id) => vec![*card_id],
                    crate::event::AbilityValue::Cards(cards) => cards.clone(),
                    _ => Vec::new(),
                })
                .collect()
        } else {
            parse_trigger_object_cards(sa, "RememberedLKI")
        };
        cards
            .into_iter()
            .filter(|&cid| ctx.game.card(cid).zone == origin_zone)
            .collect()
    } else if let Some(uid_str) = defined.strip_prefix("CardUID_") {
        uid_str
            .parse::<u32>()
            .ok()
            .map(crate::ids::CardId)
            .filter(|&cid| ctx.game.card(cid).zone == origin_zone)
            .into_iter()
            .collect()
    } else if matches!(defined_ref, Some(DefinedRef::SelfCard))
        || (defined.is_empty() && origin_zone.is_known() && sa.defined_player().is_none())
    {
        sa.source
            .filter(|&cid| ctx.game.card(cid).zone == origin_zone)
            .into_iter()
            .collect()
    } else if matches!(defined_ref, Some(DefinedRef::ExiledWith)) {
        resolve_exiled_with(ctx, sa, origin_zone)
    } else if matches!(defined_ref, Some(DefinedRef::Imprinted)) {
        resolve_imprinted(ctx, sa, origin_zone)
    } else if matches!(defined_ref, Some(DefinedRef::Remembered)) {
        resolve_remembered(ctx, sa, origin_zone)
    } else if !defined.is_empty() {
        crate::ability::ability_utils::get_defined_cards(
            ctx.game,
            sa.source,
            &defined,
            Some(controller),
        )
        .into_iter()
        .filter(|&cid| ctx.game.card(cid).zone == origin_zone)
        .collect()
    } else if sa.defined_player().is_some() {
        resolve_defined_player_choice(ctx, sa, origin_zone)
    } else {
        Vec::new()
    };

    // Optional$ True — Java mirrors the per-card confirm at
    // `ChangeZoneEffect.java:558-561`: ask the chooser whether to move each
    // card individually and skip non-confirmed cards. Without this prompt,
    // the deterministic agent's RNG ledger drifts vs Java (e.g. Risen Reef's
    // optional ChangeZone for a peeked land).
    let cards_to_move = if sa.ir.optional && !cards_to_move.is_empty() {
        let chooser = controller;
        let source_name = sa.source.map(|cid| ctx.game.card(cid).card_name.clone());
        cards_to_move
            .into_iter()
            .filter(|&cid| {
                let card_name = ctx.game.card(cid).card_name.clone();
                let prompt = format!(
                    "Do you want to move {} from {} to {}?",
                    card_name, origin_zone, dest_zone,
                );
                ctx.agents[chooser.index()].confirm_action(
                    chooser,
                    None,
                    &prompt,
                    &[],
                    sa.source,
                    Some(crate::ability::api_type::ApiType::ChangeZone),
                )
            })
            .collect()
    } else {
        cards_to_move
    };

    move_cards(
        ctx,
        sa,
        &cards_to_move,
        origin_zone,
        dest_zone,
        &lib_position,
        controller,
        controller,
    );
}

fn resolve_exiled_with(
    ctx: &EffectContext,
    sa: &SpellAbility,
    origin_zone: ZoneType,
) -> Vec<CardId> {
    let Some(source_id) = sa.source else {
        return Vec::new();
    };
    let mut result: Vec<_> = ctx
        .game
        .cards
        .iter()
        .filter(|c| c.zone == origin_zone && c.exiled_by == Some(source_id))
        .map(|c| c.id)
        .collect();
    let remembered: Vec<_> = ctx
        .game
        .card(source_id)
        .remembered_cards
        .iter()
        .copied()
        .filter(|&cid| ctx.game.card(cid).zone == origin_zone)
        .filter(|cid| !result.contains(cid))
        .collect();
    result.extend(remembered);
    result
}

fn resolve_remembered(
    ctx: &EffectContext,
    sa: &SpellAbility,
    origin_zone: ZoneType,
) -> Vec<CardId> {
    let Some(source_id) = sa.source else {
        return Vec::new();
    };
    ctx.game
        .card(source_id)
        .remembered_cards
        .iter()
        .copied()
        .filter(|&cid| ctx.game.card(cid).zone == origin_zone)
        .collect()
}

fn resolve_imprinted(ctx: &EffectContext, sa: &SpellAbility, origin_zone: ZoneType) -> Vec<CardId> {
    let Some(source_id) = sa.source else {
        return Vec::new();
    };
    ctx.game
        .card(source_id)
        .imprinted_cards
        .iter()
        .copied()
        .filter(|&cid| ctx.game.card(cid).zone == origin_zone)
        .collect()
}
