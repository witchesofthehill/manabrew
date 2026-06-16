use std::collections::HashSet;

use forge_foundation::ManaAtom;
use forge_foundation::ZoneType;

use crate::card::valid_filter;
use crate::game::GameState;
use crate::ids::PlayerId;
use crate::staticability::StaticMode;

/// All mana type atoms, matching Java's `ManaAtom.MANATYPES`.
const MANATYPES: [u16; 6] = [
    ManaAtom::WHITE,
    ManaAtom::BLUE,
    ManaAtom::BLACK,
    ManaAtom::RED,
    ManaAtom::GREEN,
    ManaAtom::COLORLESS,
];

/// Returns the set of mana type atoms that don't empty from the pool.
///
/// Mirrors Java's `StaticAbilityUnspentMana.getManaToKeep()`.
/// Returns a deduplicated `HashSet<u16>` of `ManaAtom` constants.
pub fn get_mana_to_keep(game: &GameState, player: PlayerId) -> HashSet<u16> {
    let mut result = HashSet::new();
    for card in game
        .cards
        .iter()
        .filter(|c| c.zone == ZoneType::Battlefield)
    {
        for st_ab in card
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::UnspentMana))
        {
            apply_unspent_mana_ability(st_ab, card.controller, player, &mut result);
        }
    }
    result
}

/// Check if a player has mana burn (loses life for unspent mana).
///
/// Mirrors Java's `StaticAbilityUnspentMana.hasManaBurn()`.
///
/// Java logic: finds the FIRST ManaBurn static, checks ValidPlayer,
/// and returns based on the match result. If the player doesn't match,
/// returns false. If no ManaBurn static exists, returns false.
pub fn has_mana_burn(game: &GameState, player: PlayerId) -> bool {
    for card in game
        .cards
        .iter()
        .filter(|c| c.zone == ZoneType::Battlefield)
    {
        if let Some(st_ab) = card
            .static_abilities
            .iter()
            .find(|sa| sa.check_mode(&StaticMode::ManaBurn))
        {
            // Java short-circuits on the first ManaBurn static found:
            // if (!stAb.matchesValidParam("ValidPlayer", player)) return false;
            // return true;
            return valid_filter::matches_valid_player_selector_opt(
                st_ab.ir.valid_player.as_ref(),
                player,
                card.controller,
            );
        }
    }
    false
}

/// Apply a single UnspentMana static ability, adding kept mana types to the result set.
///
/// Mirrors Java's `StaticAbilityUnspentMana.applyUnspentManaAbility()`.
fn apply_unspent_mana_ability(
    st_ab: &crate::staticability::StaticAbility,
    source_controller: PlayerId,
    player: PlayerId,
    result: &mut HashSet<u16>,
) {
    if !valid_filter::matches_valid_player_selector_opt(
        st_ab.ir.valid_player.as_ref(),
        player,
        source_controller,
    ) {
        return;
    }

    if let Some(mana_type) = st_ab.ir.mana_type_text.as_deref() {
        // Java: result.add(MagicColor.fromName(stAb.getParam("ManaType")))
        let atom = ManaAtom::from_name(&mana_type.to_ascii_lowercase());
        if atom != 0 {
            result.insert(atom);
        }
    } else {
        // No ManaType specified = all mana types
        // Java: for (byte b : ManaAtom.MANATYPES) result.add(b);
        for &b in &MANATYPES {
            result.insert(b);
        }
    }
}
