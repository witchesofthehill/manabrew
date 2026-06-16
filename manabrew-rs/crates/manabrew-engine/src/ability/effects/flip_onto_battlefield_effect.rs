//! FlipOntoBattlefield effect — Chaos Orb style flipping.
//!
//! Ported 1:1 from Java's `FlipOntoBattlefieldEffect.java`.
//! Flip a card onto the battlefield from a height of at least one foot.
//! Destroy any permanents it lands on. (Un-set / silver-bordered mechanic.)
//! In digital, this is implemented as random selection.

use forge_foundation::ZoneType;

use super::resolve_numeric_svar;
use super::EffectContext;
use crate::ids::CardId;
use crate::parsing::keys;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `FlipOntoBattlefieldEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(FlipOntoBattlefieldEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let _controller = sa.activating_player;

    // Get all permanents on the battlefield (except the source)
    let source = sa.source;
    let targets: Vec<CardId> = ctx
        .game
        .cards
        .iter()
        .filter(|c| c.zone == ZoneType::Battlefield && (source != Some(c.id)))
        .map(|c| c.id)
        .collect();

    if targets.is_empty() {
        return;
    }

    // In digital: randomly select which permanents get "hit"
    // Java uses actual physics simulation — we use RNG
    let hit_count = resolve_numeric_svar(ctx.game, sa, keys::HIT_COUNT, 1).max(0) as usize;

    let mut pool = targets;
    ctx.rng.shuffle_cards(&mut pool);
    let hits: Vec<CardId> = pool.into_iter().take(hit_count).collect();

    // Destroy hit permanents
    for card_id in hits {
        if ctx.game.card(card_id).zone != ZoneType::Battlefield {
            continue;
        }
        let old_zone = ctx.game.card(card_id).zone;
        let owner = ctx.game.card(card_id).owner;
        ctx.move_card(card_id, ZoneType::Graveyard, owner);
        super::emit_zone_trigger(ctx.trigger_handler, card_id, old_zone, ZoneType::Graveyard);
    }
}
