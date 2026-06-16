//! Spell -- helper functions for cast spells.
//! Mirrors Java's `Spell.java` (subclass of SpellAbility for spells cast from hand/zone).
//! In Rust the subclass is flattened: SpellAbility.is_spell == true marks a spell.

use forge_foundation::ZoneType;

use crate::game::GameState;
use crate::ids::CardId;
use crate::spellability::SpellAbility;

/// Type alias for SpellAbility when used as a cast spell.
/// In Java, `Spell` is a subclass; in Rust it's the same struct with `is_spell = true`.
pub type Spell = super::SpellAbility;

/// Whether this spell can currently be played.
/// Mirrors Java's `Spell.canPlay()`.
///
/// Checks:
/// 1. The source card is not already on the battlefield.
/// 2. No split-second spell is on the stack (unless this is a mana ability).
/// 3. General restrictions pass.
pub fn can_play(sa: &SpellAbility, game: &GameState) -> bool {
    // Card must exist
    let card_id = match sa.source {
        Some(id) => id,
        None => return false,
    };

    // A spell cannot be cast if its card is already on the battlefield
    if game.card_is_in_zone(card_id, ZoneType::Battlefield) {
        return false;
    }

    // Split second check: if any spell on the stack has split second,
    // only mana abilities may be activated
    if super::has_split_second_on_stack(game) && !sa.is_mana_ability {
        return false;
    }

    if !sa.can_cast_timing(game) {
        return false;
    }

    // Delegate to general restriction check
    check_restrictions(sa, game)
}

/// Check cant-be-cast restrictions from static abilities.
/// Mirrors Java's `Spell.checkRestrictions()`.
///
/// Walks static abilities on the battlefield looking for "can't cast" effects
/// that apply to this spell. Returns true if casting is allowed.
pub fn check_restrictions(sa: &SpellAbility, game: &GameState) -> bool {
    // Base restriction check from SpellAbility itself
    sa.can_play(game)
}

/// Whether this spell can be played from its host card.
/// Mirrors Java's `Spell.canPlayFromHost()`.
/// Returns the card if playable, None otherwise.
pub fn can_play_from_host(sa: &SpellAbility, game: &GameState) -> Option<CardId> {
    let card_id = sa.source?;
    // A spell cannot be cast if its card is already on the battlefield
    if game.card_is_in_zone(card_id, ZoneType::Battlefield) {
        return None;
    }

    // Split second check
    if super::has_split_second_on_stack(game) && !sa.is_mana_ability {
        return None;
    }

    if !sa.can_cast_timing(game) {
        return None;
    }

    // Restrictions check
    if !sa.can_play(game) {
        return None;
    }

    Some(card_id)
}

/// Whether this spell can be countered by the given counter spell/ability.
/// Mirrors Java's `Spell.isCounterableBy(SpellAbility)`.
///
/// A spell is counterable unless it has "can't be countered" (e.g. Abrupt Decay).
pub fn is_counterable_by(sa: &SpellAbility, _counter_sa: &SpellAbility) -> bool {
    // Check if the spell has the "CantBeCountered" flag in params
    if sa.ir.cant_be_countered {
        return false;
    }

    // Check if the source card has "This spell can't be countered" keyword
    // This is handled by checking the param rather than the card keyword
    // because by the time it's on the stack, the SA params are authoritative.
    true
}

/// Set whether this spell is cast face down (Morph).
/// Mirrors Java's `Spell.setCastFaceDown(boolean)`.
pub fn set_cast_face_down(sa: &mut SpellAbility, face_down: bool) {
    sa.cast_face_down = face_down;
}
