//! AbilityActivated -- helper functions for activated abilities.
//! Mirrors Java's `AbilityActivated.java`.
//! In Rust the subclass is flattened: SpellAbility.is_activated == true.

use forge_foundation::ZoneType;

use crate::game::GameState;
use crate::spellability::SpellAbility;

/// Whether this activated ability can currently be played.
/// Mirrors Java's `AbilityActivated.canPlay()`.
///
/// Checks:
/// 1. Cost is not marked unpayable.
/// 2. Split second not on stack (unless mana ability).
/// 3. Not suppressed (e.g. Pithing Needle naming this card).
/// 4. Not detained.
/// 5. General restrictions pass.
pub fn can_play(sa: &SpellAbility, game: &GameState) -> bool {
    // Unpayable cost check
    if sa.ir.unpayable {
        return false;
    }

    // Split second check: mana abilities bypass
    if !sa.is_mana_ability && super::has_split_second_on_stack(game) {
        return false;
    }

    // Check if the source card is suppressed (Pithing Needle, etc.)
    if is_suppressed(sa, game) {
        return false;
    }

    // Check if the source card is detained
    if is_detained(sa, game) {
        return false;
    }

    // Delegate to restriction check
    check_restrictions(sa, game)
}

/// Whether this activated ability is possible (zone and activator checks).
/// Mirrors Java's `AbilityActivated.isPossible()`.
///
/// A lighter check than `can_play` -- used to filter the list of
/// abilities shown to the player before doing full legality checks.
pub fn is_possible_activated(sa: &SpellAbility, game: &GameState) -> bool {
    let card_id = match sa.source {
        Some(id) => id,
        None => return false,
    };

    // Check activation zone restriction -- activated abilities default to battlefield
    if !game.card_is_in_zone(card_id, ZoneType::Battlefield) {
        return false;
    }

    // The activating player must be alive
    let player = game.player(sa.activating_player);
    if !player.is_alive() {
        return false;
    }

    true
}

/// Check cant-be-activated restrictions from static abilities.
/// Mirrors Java's `AbilityActivated.checkRestrictions()`.
pub fn check_restrictions(sa: &SpellAbility, game: &GameState) -> bool {
    sa.can_play(game)
}

/// Whether to prompt even if this is the only possible ability.
/// Mirrors Java's `AbilityActivated.promptIfOnlyPossibleAbility()`.
/// Returns false -- activated abilities don't need confirmation when they're
/// the only option (unlike spells which may have alternative costs).
pub fn prompt_if_only_possible_ability() -> bool {
    false
}

/// Check if the source card is suppressed by a naming effect (Pithing Needle).
/// A card is suppressed if an opponent controls a permanent that names it
/// and prevents activated abilities.
pub fn is_suppressed(sa: &SpellAbility, game: &GameState) -> bool {
    let card_id = match sa.source {
        Some(id) => id,
        None => return false,
    };

    let card = game.card(card_id);
    let card_name = &card.card_name;

    // Walk all players' battlefields looking for suppression effects
    // (e.g. Pithing Needle naming this card via svars)
    for &pid in &game.player_order {
        if pid == sa.activating_player {
            continue;
        }
        for &cid in game.cards_in_zone(ZoneType::Battlefield, pid) {
            let perm = game.card(cid);
            if let Some(named) = perm.get_s_var("ChosenName") {
                if named.eq_ignore_ascii_case(card_name)
                    && perm.has_keyword("Suppress activated abilities")
                {
                    return true;
                }
            }
        }
    }
    false
}

/// Check if the source card is detained (can't attack, block, or activate abilities).
pub fn is_detained(sa: &SpellAbility, game: &GameState) -> bool {
    let card_id = match sa.source {
        Some(id) => id,
        None => return false,
    };
    let card = game.card(card_id);
    card.has_keyword("HIDDEN Detained")
}
