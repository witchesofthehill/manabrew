//! AbilityStatic -- helper functions for static abilities (e.g. morph face-up).
//! Mirrors Java's `AbilityStatic.java`.
//! Static abilities are special actions that don't use the stack (like turning
//! a morph face-up).

use forge_foundation::ZoneType;

use crate::game::GameState;
use crate::spellability::SpellAbility;

/// Type alias for SpellAbility when used as a static ability.
/// In Java, `AbilityStatic` is a subclass; in Rust it's the same struct.
pub type AbilityStatic = super::SpellAbility;

/// Whether this static ability can currently be played.
/// Mirrors Java's `AbilityStatic.canPlay()`.
///
/// The primary use case is morph/megamorph turn-face-up: the card must be
/// face-down on the battlefield, and the player must be able to pay the cost.
pub fn can_play(sa: &SpellAbility, game: &GameState) -> bool {
    let card_id = match sa.source {
        Some(id) => id,
        None => return false,
    };

    let card = game.card(card_id);

    // For morph turn-face-up: card must be face-down on the battlefield
    if sa.ir.morph || sa.ir.morph_up || sa.ir.megamorph {
        // Must be on the battlefield
        if !game.card_is_in_zone(card_id, ZoneType::Battlefield) {
            return false;
        }
        // Must be face-down
        if !card.face_down {
            return false;
        }
    }

    // Split second does NOT prevent special actions like turning morphs face-up
    // (rule 702.37a: "Split second doesn't prevent special actions")

    // General restriction check
    sa.can_play(game)
}
