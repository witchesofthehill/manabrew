//! CountersNote effect — note the number of counters on a permanent.
//!
//! Ported from Java's `CountersNoteEffect.java`.
//! Store counter amounts for later use (e.g. "noted P1P1 counters").

use super::EffectContext;
use crate::card::CounterType;

/// Note the number of counters of a specific type on a card.
/// Mirrors Java's `CountersNoteEffect.noteCounters(Card, CounterType)`.
///
/// Stores the counter count in the source card's remembered_cmc list
/// for later retrieval by effects that check "noted" counter amounts.
pub fn note_counters(
    game: &mut crate::game::GameState,
    source_id: crate::ids::CardId,
    target_id: crate::ids::CardId,
    counter_type: &crate::card::CounterType,
) {
    let count = *game
        .card(target_id)
        .counters
        .get(counter_type)
        .unwrap_or(&0);
    game.card_mut(source_id).add_remembered_cmc(count);
}

/// Load previously noted counter amounts back onto a card.
/// Mirrors Java's `CountersNoteEffect.loadCounters(Card, CounterType)`.
///
/// Reads the noted counter count from the source card's remembered_cmc
/// and adds that many counters of the specified type to the target.
pub fn load_counters(
    game: &mut crate::game::GameState,
    source_id: crate::ids::CardId,
    target_id: crate::ids::CardId,
    counter_type: &crate::card::CounterType,
) {
    // Get the noted count (last remembered CMC value)
    let noted_count = game
        .card(source_id)
        .remembered_cmc
        .last()
        .copied()
        .unwrap_or(0);

    if noted_count > 0 {
        game.card_mut(target_id)
            .add_counter(counter_type, noted_count);
    }
}

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `CountersNoteEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(CountersNoteEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let Some(source_id) = sa.source else { return };
    let counter_type = sa.ir.counter_type.clone().unwrap_or(CounterType::P1P1);

    let targets: Vec<crate::ids::CardId> = if sa.uses_targeting() {
        sa.target_chosen.target_card.into_iter().collect()
    } else {
        sa.source.into_iter().collect()
    };

    for card_id in targets {
        let count = *ctx
            .game
            .card(card_id)
            .counters
            .get(&counter_type)
            .unwrap_or(&0);
        // Store noted value in source's remembered_cmc (used by WithNotedCounters$)
        ctx.game.card_mut(source_id).add_remembered_cmc(count);
    }
}
