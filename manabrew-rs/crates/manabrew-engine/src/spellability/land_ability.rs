//! LandAbility -- helper functions for land play abilities.
//! Mirrors Java's `LandAbility.java`.
//! Playing a land is a special action, not a spell -- it doesn't use the stack.

use forge_foundation::ZoneType;

use crate::game::GameState;
use crate::spellability::SpellAbility;

/// Whether this land ability can currently be played.
/// Mirrors Java's `LandAbility.canPlay()`.
///
/// Checks:
/// 1. The activating player exists and is alive.
/// 2. The source card is not already on the battlefield.
/// 3. The player has remaining land plays this turn.
/// 4. It must be the player's main phase with an empty stack and they are
///    the active player (sorcery-speed timing for land plays).
pub fn can_play(sa: &SpellAbility, game: &GameState) -> bool {
    let card_id = match sa.source {
        Some(id) => id,
        None => return false,
    };

    // Player must exist and be alive
    let player = game.player(sa.activating_player);
    if !player.is_alive() {
        return false;
    }

    // Card must not already be on the battlefield
    if game.card_is_in_zone(card_id, ZoneType::Battlefield) {
        return false;
    }

    // Player must have land plays remaining this turn
    if player.lands_played_this_turn >= player.max_land_plays_per_turn {
        return false;
    }

    // Land plays require sorcery timing: main phase, empty stack, active player
    let is_main = game.turn.phase.is_main();
    let stack_empty = game.stack.is_empty();
    let is_active = game.turn.active_player == sa.activating_player;

    is_main && stack_empty && is_active
}

/// Resolve a land play — move the land to the battlefield.
/// Mirrors Java's `LandAbility.resolve()`.
/// The actual land placement is handled by `GameState::move_card()`;
/// this function tracks the land play count.
pub fn resolve(sa: &SpellAbility, game: &mut GameState) {
    let card_id = match sa.source {
        Some(id) => id,
        None => return,
    };
    let player = sa.activating_player;

    // Move the land to the battlefield
    game.move_card(card_id, ZoneType::Battlefield, player);

    // Track land play
    game.player_record_land_play(player);
}

/// Whether this is a land ability.
/// Mirrors Java's `LandAbility.isLandAbility()` which always returns true.
pub fn is_land_ability() -> bool {
    true
}

/// Build the display string for this land ability.
/// Mirrors Java's `LandAbility.toUnsuppressedString()`.
pub fn to_unsuppressed_string(sa: &SpellAbility) -> String {
    if !sa.description.is_empty() {
        return sa.description.clone();
    }
    match sa.source {
        Some(_) => "Play land".to_string(),
        None => "Play land".to_string(),
    }
}
