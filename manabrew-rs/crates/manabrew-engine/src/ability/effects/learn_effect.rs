//! Learn effect — reveal a Lesson from outside the game, or discard to draw.
//!
//! Ported from Java's `LearnEffect.java` + `Player.learnLesson()`.
//! Learn: You may reveal a Lesson card you own from outside the game and put
//! it into your hand, or discard a card to draw a card.

use forge_foundation::ZoneType;

use super::{emit_zone_trigger, EffectContext};
use crate::event::RunParams;
use crate::ids::PlayerId;
use crate::replacement::replacement_handler::{apply_replacements, ReplacementEvent};
use crate::replacement::ReplacementResult;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `LearnEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(LearnEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;

    // Run Learn replacement effects before learning.
    let mut event = ReplacementEvent::Learn { player: controller };
    let result = apply_replacements(ctx.game, &mut event);
    if result == ReplacementResult::Skipped || result == ReplacementResult::Replaced {
        return;
    }

    let players = if let Some(def) = sa.defined_player() {
        super::resolve_defined_players(def, controller, ctx.game)
    } else {
        vec![controller]
    };

    for pid in players {
        learn_lesson(ctx, sa, pid);
    }
}

/// Implement the Learn choice: get Lesson from sideboard OR discard+draw.
fn learn_lesson(ctx: &mut EffectContext, _sa: &SpellAbility, player: PlayerId) {
    // Collect options: Lesson cards from sideboard + cards in hand
    let sideboard_lessons: Vec<crate::ids::CardId> = ctx
        .game
        .cards_in_zone(ZoneType::Sideboard, player)
        .to_vec()
        .into_iter()
        .filter(|&cid| {
            ctx.game
                .card(cid)
                .type_line
                .subtypes
                .iter()
                .any(|s| s.eq_ignore_ascii_case("Lesson"))
        })
        .collect();

    let hand_cards: Vec<crate::ids::CardId> =
        ctx.game.cards_in_zone(ZoneType::Hand, player).to_vec();

    // Combine all options
    let mut all_options = sideboard_lessons.clone();
    all_options.extend(&hand_cards);

    if all_options.is_empty() {
        return;
    }

    // Player chooses one card (optional — can decline)
    ctx.agents[player.index()].snapshot_state(ctx.game, ctx.mana_pools);
    let chosen = ctx.agents[player.index()].choose_single_card_for_zone_change(
        ctx.game,
        player,
        &all_options,
        "Learn: choose a Lesson from sideboard, or a card from hand to discard",
        true, // optional
    );

    let Some(card_id) = chosen else { return };

    let card_zone = ctx.game.card(card_id).zone;

    if card_zone == ZoneType::Sideboard {
        // Lesson from sideboard → hand
        let old_zone = ctx.game.card(card_id).zone;
        ctx.move_card(card_id, ZoneType::Hand, player);
        emit_zone_trigger(ctx.trigger_handler, card_id, old_zone, ZoneType::Hand);
    } else if card_zone == ZoneType::Hand {
        // Discard from hand, then draw 1
        let old_zone = ctx.game.card(card_id).zone;
        ctx.game.player_record_discard(player, 1);
        ctx.game.card_mut(card_id).set_discarded(true);
        ctx.game
            .move_card(card_id, ZoneType::Graveyard, ctx.game.card(card_id).owner);

        ctx.trigger_handler.run_trigger(
            TriggerType::Discarded,
            RunParams {
                card: Some(card_id),
                player: Some(player),
                origin: Some(old_zone),
                destination: Some(ZoneType::Graveyard),
                ..Default::default()
            },
            false,
        );
        emit_zone_trigger(ctx.trigger_handler, card_id, old_zone, ZoneType::Graveyard);

        // Draw 1 card
        let lib = ctx.game.cards_in_zone(ZoneType::Library, player).to_vec();
        if let Some(&top) = lib.last() {
            let dz = ctx.game.card(top).zone;
            ctx.move_card(top, ZoneType::Hand, player);
            ctx.trigger_handler.run_trigger(
                TriggerType::Drawn,
                RunParams {
                    card: Some(top),
                    player: Some(player),
                    ..Default::default()
                },
                false,
            );
            emit_zone_trigger(ctx.trigger_handler, top, dz, ZoneType::Hand);
        }
    }
}
