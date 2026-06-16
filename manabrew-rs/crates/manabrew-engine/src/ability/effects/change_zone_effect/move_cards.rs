//! Shared move + post-processing logic for zone changes.
//!
//! Handles: card ordering, pre/post move, meld, AtEOT, Duration, shuffle.

use forge_foundation::ZoneType;

use super::super::{emit_zone_trigger, EffectContext};
use super::helpers::{apply_post_move, apply_pre_move, resolve_dest_owner};
use crate::event::RunParams;
use crate::ids::{CardId, PlayerId};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

/// Move collected cards to destination zone and apply all post-move effects.
///
/// `controller` is the SA activating player (used for SearchedLibrary trigger
/// run params and AtEOT$ delayed-trigger controller — mirrors Java's `decider`).
/// `search_player` is the player whose library was searched (used as the
/// shuffle target when the search returned no cards — mirrors Java's
/// `triggerList.getMap(Library).keySet()` shuffle in `ChangeZoneEffect`).
pub(super) fn move_cards(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    cards: &[CardId],
    origin_zone: ZoneType,
    dest_zone: ZoneType,
    lib_position: &str,
    controller: PlayerId,
    search_player: PlayerId,
) {
    // SearchedLibrary trigger
    if origin_zone == ZoneType::Library {
        ctx.trigger_handler.run_trigger(
            TriggerType::SearchedLibrary,
            RunParams {
                player: Some(controller),
                ..Default::default()
            },
            false,
        );
    }

    // Card ordering for library destination (Java lines 529-539)
    let mut ordered = cards.to_vec();
    if dest_zone == ZoneType::Library && ordered.len() > 1 && !sa.is_shuffle() {
        if sa.ir.random_order {
            ctx.rng.shuffle_cards(&mut ordered);
        } else if sa.ir.shuffle_changed_pile {
            ctx.rng.shuffle_cards(&mut ordered);
        }
    }

    let mut searched_owners: Vec<PlayerId> = Vec::new();

    // ForgetOtherRemembered$ — clear before processing (Java line 510)
    if sa.ir.forget_other_remembered {
        if let Some(sid) = sa.source {
            ctx.game.card_mut(sid).clear_remembered();
        }
    }

    // Java parity (`ChangeZoneEffect.java:1255`): when both origin and
    // destination are Library, the searcher's library is shuffled BEFORE
    // the chosen cards are placed at their target position. This matches
    // "shuffle, then put that card on top" wording (e.g. Flamekin Harbinger).
    // We perform the shuffle here so RNG consumption stays in lockstep with
    // Java; the subsequent per-card move then re-positions the chosen cards.
    let pre_move_shuffle = origin_zone == ZoneType::Library && dest_zone == ZoneType::Library;
    if pre_move_shuffle {
        let no_shuffle = sa.ir.shuffle_raw.as_deref() == Some("False") || sa.ir.no_shuffle;
        if !no_shuffle {
            let mut shuffled_owners: Vec<PlayerId> = Vec::new();
            for &card_id in &ordered {
                let owner = ctx.game.card(card_id).owner;
                if !shuffled_owners.contains(&owner) {
                    shuffled_owners.push(owner);
                }
            }
            for pid in shuffled_owners {
                if ctx.game.cards_in_zone(ZoneType::Library, pid).is_empty() {
                    continue;
                }
                ctx.game.shuffle_zone_cards(ZoneType::Library, pid, ctx.rng);
                ctx.trigger_handler.run_trigger(
                    TriggerType::Shuffled,
                    RunParams {
                        player: Some(pid),
                        ..Default::default()
                    },
                    false,
                );
            }
        }
    }

    let mut moved = Vec::new();

    for &card_id in &ordered {
        if origin_zone == ZoneType::Library {
            let owner = ctx.game.card(card_id).owner;
            if !searched_owners.contains(&owner) {
                searched_owners.push(owner);
            }
        }

        if !apply_pre_move(ctx, card_id, sa, dest_zone) {
            continue;
        }

        // Collect melded parts before moving (CR 712.4)
        let melded_parts = ctx.game.card(card_id).melded_with.clone();

        let dest_owner = resolve_dest_owner(ctx, sa, card_id, dest_zone);
        let old_zone = ctx.game.card(card_id).zone;

        // Consult Moved replacement effects so commander-to-command-zone
        // redirects (and similar) apply when a permanent moves off the
        // battlefield to its owner's hand/library. Mirrors Java's
        // `GameAction.changeZone()` running `replacementHandler.run(Moved)`
        // regardless of destination.
        let final_dest = apply_hand_library_replacement(ctx, card_id, old_zone, dest_zone);
        ctx.move_card(card_id, final_dest, dest_owner);
        if final_dest == ZoneType::Battlefield {
            ctx.trigger_handler
                .register_active_trigger(ctx.game, card_id);
        }
        apply_post_move(
            ctx,
            card_id,
            sa,
            old_zone,
            dest_zone,
            dest_owner,
            lib_position,
        );
        if old_zone == ZoneType::Battlefield && final_dest != ZoneType::Battlefield {
            ctx.trigger_handler.unregister_active_triggers(card_id);
        }
        moved.push(card_id);

        // Move melded parts together
        for meld_id in melded_parts {
            if ctx.game.card(meld_id).zone == old_zone {
                let mo = ctx.game.card(meld_id).owner;
                let mz = ctx.game.card(meld_id).zone;
                ctx.move_card(meld_id, dest_zone, mo);
                if dest_zone == ZoneType::Battlefield {
                    ctx.trigger_handler
                        .register_active_trigger(ctx.game, meld_id);
                }
                emit_zone_trigger(ctx.trigger_handler, meld_id, mz, dest_zone);
                if mz == ZoneType::Battlefield && dest_zone != ZoneType::Battlefield {
                    ctx.trigger_handler.unregister_active_triggers(meld_id);
                }
                moved.push(meld_id);
            }
        }
    }

    // Searched$ — force trigger even without Library origin
    if sa.ir.searched && origin_zone != ZoneType::Library {
        ctx.trigger_handler.run_trigger(
            TriggerType::SearchedLibrary,
            RunParams {
                player: Some(controller),
                ..Default::default()
            },
            false,
        );
    }

    // AtEOT$ delayed triggers
    if let Some(eot_svar) = sa.ir.at_eot.as_deref() {
        for &cid in &moved {
            ctx.trigger_handler
                .register_delayed_trigger(crate::trigger::handler::DelayedTrigger {
                    mode: TriggerType::Phase,
                    trigger_mode: Box::new(crate::trigger::trigger_always::TriggerAlways)
                        as Box<dyn crate::trigger::TriggerBehavior>,
                    params: crate::parsing::Params::default(),
                    execute_svar: eot_svar.to_string(),
                    controller,
                    source_card: sa.source.unwrap_or(cid),
                    created_turn: ctx.game.turn.turn_number,
                    created_phase: ctx.game.turn.phase,
                    target_card: Some(cid),
                    remembered_amount: 0,
                    remembered_cards: Vec::new(),
                    remembered_players: Vec::new(),
                    remembered_lki_cards: Vec::new(),
                    sort_after_active: false,
                    trigger_order: None,
                });
        }
    }

    // Duration$ UntilHostLeavesPlay — mark exiled cards for return
    if let Some(duration) = sa.ir.duration.as_ref() {
        if matches!(
            duration,
            crate::spellability::AbilityDuration::UntilHostLeavesPlay
                | crate::spellability::AbilityDuration::UntilHostLeavesPlayOrEot
        ) {
            if let Some(sid) = sa.source {
                for &cid in &moved {
                    ctx.game.card_mut(cid).set_exiled_by(Some(sid));
                }
            }
        }
    }

    // Shuffle after library search (origin Library, destination NOT Library —
    // e.g. Tutor a card to hand). The Library→Library case was already
    // handled above (pre-move shuffle), so skip it here to avoid a second
    // shuffle that would consume extra RNG and diverge from Java.
    let no_shuffle = sa.ir.shuffle_raw.as_deref() == Some("False") || sa.ir.no_shuffle;
    let force_shuffle = sa.is_shuffle();
    let already_shuffled = pre_move_shuffle;
    if !already_shuffled && !no_shuffle && (origin_zone == ZoneType::Library || force_shuffle) {
        let players = if !searched_owners.is_empty() {
            searched_owners.clone()
        } else {
            vec![search_player]
        };
        for pid in players {
            if ctx.game.cards_in_zone(ZoneType::Library, pid).is_empty() {
                continue;
            }
            ctx.game.shuffle_zone_cards(ZoneType::Library, pid, ctx.rng);
            ctx.trigger_handler.run_trigger(
                TriggerType::Shuffled,
                RunParams {
                    player: Some(pid),
                    ..Default::default()
                },
                false,
            );

            if dest_zone == ZoneType::Library && !force_shuffle {
                reapply_library_position(ctx, &ordered, dest_zone, lib_position, pid);
            }
        }
    }
}

/// Consult Moved replacement effects for off-battlefield moves to Hand/Library.
/// Mirrors Java's `GameAction.changeZone()` which runs the replacement handler
/// for every Moved event, not just Graveyard. Returns the destination zone
/// after replacement (may be redirected to Command zone for commanders).
fn apply_hand_library_replacement(
    ctx: &mut EffectContext,
    card_id: CardId,
    origin: ZoneType,
    destination: ZoneType,
) -> ZoneType {
    use crate::replacement::replacement_handler::{ReplacementEvent, ReplacementHandler};
    if origin != ZoneType::Battlefield {
        return destination;
    }
    if destination != ZoneType::Hand && destination != ZoneType::Library {
        return destination;
    }
    let mut event = ReplacementEvent::Moved {
        card: card_id,
        origin,
        destination,
        is_discard: false,
    };
    let mut handler = ReplacementHandler::new();
    handler.run(ctx.game, Some(ctx.agents), None, &mut event);
    if let ReplacementEvent::Moved {
        destination: new_dest,
        ..
    } = event
    {
        new_dest
    } else {
        destination
    }
}

fn reapply_library_position(
    ctx: &mut EffectContext,
    ordered: &[CardId],
    dest_zone: ZoneType,
    lib_position: &str,
    owner: PlayerId,
) {
    if dest_zone != ZoneType::Library || ordered.is_empty() {
        return;
    }

    let moved_in_library: Vec<CardId> = ordered
        .iter()
        .copied()
        .filter(|cid| {
            ctx.game
                .cards_in_zone(ZoneType::Library, owner)
                .contains(cid)
        })
        .collect();
    if moved_in_library.is_empty() {
        return;
    }

    if lib_position == "-1" || lib_position.eq_ignore_ascii_case("Bottom") {
        ctx.game
            .move_cards_to_zone_bottom(ZoneType::Library, owner, &moved_in_library);
    } else {
        ctx.game
            .move_cards_to_zone_top(ZoneType::Library, owner, &moved_in_library);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::{PassAgent, PlayerAgent};
    use crate::card::Card;
    use crate::game::GameState;
    use crate::game_rng::GameRng;
    use crate::ids::CardId;
    use crate::mana::ManaPool;
    use crate::spellability::SpellAbility;
    use crate::trigger::TriggerHandler;
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost};
    use std::collections::HashMap;

    struct ReverseRng;

    impl GameRng for ReverseRng {
        fn shuffle_cards(&mut self, cards: &mut [CardId]) {
            cards.reverse();
        }

        fn next_int(&mut self, _bound: i32) -> i32 {
            0
        }
    }

    fn card(owner: PlayerId, name: &str) -> Card {
        Card::new(
            CardId(0),
            name.to_string(),
            owner,
            CardTypeLine::parse("Artifact Food"),
            ManaCost::parse("2"),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec![],
        )
    }

    #[test]
    fn shuffle_true_does_not_reapply_library_position_after_shuffle() {
        let player = PlayerId(0);
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let bottom = game.create_card(card(player, "Bottom Card"));
        let top = game.create_card(card(player, "Top Card"));
        let lembas = game.create_card(card(player, "Lembas"));

        game.move_card(bottom, ZoneType::Library, player);
        game.move_card(top, ZoneType::Library, player);
        game.move_card(lembas, ZoneType::Graveyard, player);

        let mut agents: Vec<Box<dyn PlayerAgent>> = vec![Box::new(PassAgent), Box::new(PassAgent)];
        let mut trigger_handler = TriggerHandler::new();
        let token_templates = HashMap::new();
        let token_art_variants = HashMap::new();
        let token_fallback = HashMap::new();
        let edition_dates = HashMap::new();
        let mut mana_pools = vec![ManaPool::new(), ManaPool::new()];
        let mut rng = ReverseRng;
        let mut ctx = EffectContext {
            game: &mut game,
            combat: None,
            agents: &mut agents,
            trigger_handler: &mut trigger_handler,
            token_templates: &token_templates,
            token_art_variants: &token_art_variants,
            token_fallback: &token_fallback,
            edition_dates: &edition_dates,
            mana_pools: &mut mana_pools,
            parent_target_card: None,
            rng: &mut rng,
        };
        let sa = SpellAbility::new_simple(
            Some(lembas),
            player,
            "DB$ ChangeZone | Origin$ Graveyard | Destination$ Library | Defined$ TriggeredNewCardLKICopy | ChangeNum$ 1 | Shuffle$ True | Mandatory$ True",
        );

        move_cards(
            &mut ctx,
            &sa,
            &[lembas],
            ZoneType::Graveyard,
            ZoneType::Library,
            "",
            player,
            player,
        );

        assert_eq!(
            ctx.game.cards_in_zone(ZoneType::Library, player),
            &[lembas, top, bottom],
            "Shuffle$ True should leave the moved card wherever the shuffle placed it, not force it back to the top"
        );
    }
}
