//! Ability -- helper functions for in-play abilities.
//! Mirrors Java's `Ability.java` (base class for abilities on permanents).
//! In Rust the subclass is flattened into SpellAbility.

use forge_foundation::ZoneType;

use crate::game::GameState;
use crate::spellability::SpellAbility;

/// Type alias for SpellAbility when used as an in-play ability.
/// In Java, `Ability` is a subclass; in Rust it's the same struct with `is_activated = true`.
pub type Ability = super::SpellAbility;

/// Whether this in-play ability can currently be played.
/// Mirrors Java's `Ability.canPlay()`.
///
/// Checks:
/// 1. Split second not on stack (unless this is a mana ability).
/// 2. The source card is on the battlefield (in play).
/// 3. The source card is not face down (face-down cards can't use abilities
///    except morph/megamorph turn-face-up).
pub fn can_play(sa: &SpellAbility, game: &GameState) -> bool {
    let card_id = match sa.source {
        Some(id) => id,
        None => return false,
    };

    // Split second check: mana abilities bypass split second
    if !sa.is_mana_ability && super::has_split_second_on_stack(game) {
        return false;
    }

    // The card must be on the battlefield to activate in-play abilities
    if !game.card_is_in_zone(card_id, ZoneType::Battlefield) {
        return false;
    }

    let card = game.card(card_id);

    // Face-down cards cannot activate abilities (except morph turn-face-up,
    // which is handled by AbilityStatic, not Ability)
    if card.face_down {
        return false;
    }

    // Delegate to general restriction check
    sa.can_play(game)
}
