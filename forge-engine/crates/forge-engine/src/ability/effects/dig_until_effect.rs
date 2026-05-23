use forge_foundation::ZoneType;

use super::{
    emit_zone_trigger, matches_change_type, resolve_defined_player, resolve_numeric_svar,
    EffectContext,
};
use crate::card::valid_filter;
use crate::parsing::keys;

/// `SP$ DigUntil` — reveal cards from the top of library until finding N matching cards.
///
/// Mirrors Java's `DigUntilEffect.java`.
/// - `Amount$` — how many matching cards to find (default 1).
/// - `Valid$` — filter for matching cards (e.g. "Land", "Creature").
/// - `FoundDestination$` — where found cards go (default Hand).
/// - `RevealedDestination$` — where non-matching cards go (default Library bottom).
///
/// # Card script examples
/// ```text
/// A:SP$ DigUntil | Valid$ Land | FoundDestination$ Hand | RevealedDestination$ Graveyard
/// A:SP$ DigUntil | Valid$ Creature | Amount$ 2 | FoundDestination$ Battlefield
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `DigUntilEffect` class extending `SpellAbilityEffect`.
#[forge_engine_macros::spell_effect(DigUntilEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let amount = resolve_numeric_svar(ctx.game, sa, keys::AMOUNT, 1).max(0) as usize;

    let valid_selector = sa.ir.valid_filter_selector.as_ref();
    let valid_filter = sa.ir.valid_filter_text.as_deref().unwrap_or("Card");

    let found_dest = sa.ir.found_destination_zone.unwrap_or(ZoneType::Hand);
    let revealed_dest = sa.ir.revealed_destination_zone.unwrap_or(ZoneType::Library);

    let target_player = sa
        .target_chosen
        .target_player
        .or_else(|| {
            sa.defined()
                .and_then(|d| resolve_defined_player(d, sa.activating_player, ctx.game))
        })
        .unwrap_or(sa.activating_player);

    let lib_len = ctx
        .game
        .cards_in_zone(ZoneType::Library, target_player)
        .len();
    if lib_len == 0 {
        return;
    }

    let mut found = Vec::new();
    let mut revealed = Vec::new();

    // Walk from top of library down
    let lib_cards: Vec<_> = ctx
        .game
        .cards_in_zone(ZoneType::Library, target_player)
        .to_vec();
    // Library is stored bottom→top, so iterate from end (top) backwards
    for &cid in lib_cards.iter().rev() {
        if found.len() >= amount {
            break;
        }
        revealed.push(cid);
        let card = ctx.game.card(cid);
        let matches = match (valid_selector, sa.source) {
            (Some(selector), Some(source_id)) => valid_filter::matches_valid_card_selector_in_game(
                selector,
                card,
                ctx.game.card(source_id),
                ctx.game,
            ),
            _ => matches_change_type(card, valid_filter, &[]),
        };
        if matches {
            found.push(cid);
            if let Some(source_id) = sa.source {
                if crate::parsing::raw_has_key(&sa.ability_text, keys::FORGET_OTHER_REMEMBERED) {
                    ctx.game.card_mut(source_id).clear_remembered();
                }
                if sa.ir.remember_found {
                    ctx.game.card_mut(source_id).add_remembered_card(cid);
                }
                if sa.ir.imprint_found {
                    ctx.game.card_mut(source_id).add_imprinted_card(cid);
                }
            }
        } else {
        }
    }
    let rest: Vec<_> = revealed
        .iter()
        .copied()
        .filter(|cid| !found.contains(cid))
        .collect();
    if let Some(source_id) = sa.source {
        if sa.ir.imprint_revealed {
            ctx.game
                .card_mut(source_id)
                .add_imprinted_cards(rest.iter().copied());
        }
        if sa.ir.remember_revealed {
            ctx.game
                .card_mut(source_id)
                .add_remembered_cards(rest.iter().copied());
        }
    }

    // Remove found + rest cards from library
    let removed: Vec<_> = revealed.to_vec();
    for card_id in removed {
        ctx.game
            .remove_card_from_zone(ZoneType::Library, target_player, card_id);
    }

    // Move found cards to destination
    for &id in &found {
        let owner = ctx.game.card(id).owner;
        let dest_owner = if found_dest == ZoneType::Battlefield {
            sa.activating_player
        } else {
            owner
        };
        ctx.move_card(id, found_dest, dest_owner);
        if found_dest == ZoneType::Battlefield {
            let _ = super::add_to_combat(ctx, sa, id, keys::ATTACKING);
        }
        emit_zone_trigger(ctx.trigger_handler, id, ZoneType::Library, found_dest);
    }

    // Move rest to revealed destination
    for &id in &rest {
        let owner = ctx.game.card(id).owner;
        if revealed_dest == ZoneType::Library {
            // Put on bottom
            ctx.game
                .add_card_to_zone_bottom(ZoneType::Library, owner, id);
            ctx.game.card_mut(id).set_zone(ZoneType::Library);
        } else {
            ctx.move_card(id, revealed_dest, owner);
            emit_zone_trigger(ctx.trigger_handler, id, ZoneType::Library, revealed_dest);
        }
    }
}
