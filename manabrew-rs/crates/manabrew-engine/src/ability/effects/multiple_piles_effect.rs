//! MultiplePiles — Fact or Fiction style pile splitting.
//! Ported from Java's MultiplePilesEffect: separates cards into N piles,
//! optionally remembers a randomly chosen pile.

use forge_foundation::ZoneType;

use super::{resolve_numeric_svar, EffectContext};
use crate::ids::CardId;
use crate::parsing::keys;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `MultiplePilesEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(MultiplePilesEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let source = match sa.source {
        Some(s) => s,
        None => return,
    };
    let controller = sa.activating_player;

    let pile_count = resolve_numeric_svar(ctx.game, sa, keys::PILES, 2).max(0) as usize;

    let random_chosen = sa.ir.random_chosen;

    // Get the zone to pull cards from
    let zone = sa.ir.zone.unwrap_or(ZoneType::Battlefield);

    // Get cards in the zone for the controller
    let pool: Vec<CardId> = ctx
        .game
        .cards
        .iter()
        .filter(|c| c.zone == zone && c.controller == controller)
        .map(|c| c.id)
        .collect();

    if pool.is_empty() || pile_count == 0 {
        return;
    }

    // Auto-split into piles (agent would choose in full implementation)
    // For now, distribute evenly
    let mut piles: Vec<Vec<CardId>> = vec![vec![]; pile_count];
    for (i, card_id) in pool.iter().enumerate() {
        piles[i % pile_count].push(*card_id);
    }

    // If RandomChosen, remember a random pile's cards on source
    if random_chosen && !piles.is_empty() {
        let chosen_idx = ctx.rng.next_int(piles.len() as i32) as usize % piles.len();
        for card_id in &piles[chosen_idx] {
            ctx.game.card_mut(source).add_remembered_card(*card_id);
        }
    }
}
