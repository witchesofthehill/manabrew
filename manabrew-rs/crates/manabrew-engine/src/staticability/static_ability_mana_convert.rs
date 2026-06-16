use forge_foundation::ZoneType;

use crate::card::{valid_filter, Card};
use crate::ids::PlayerId;
use crate::staticability::StaticMode;

/// Check if a player can spend mana as though it were any color/type
/// when casting a particular spell.
///
/// Mirrors Java's `StaticAbilityManaConvert.manaConvert()`.
///
/// Returns true if any active ManaConvert static on the battlefield allows
/// the player to spend mana freely for the given card.
pub fn can_spend_mana_as_any_color(cards: &[Card], player: PlayerId, spell_card: &Card) -> bool {
    for source in cards
        .iter()
        .filter(|c| c.zone == ZoneType::Battlefield || c.zone == ZoneType::Command)
    {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::ManaConvert))
        {
            // Check ValidPlayer$
            if !valid_filter::matches_valid_player_selector_opt(
                st_ab.ir.valid_player.as_ref(),
                player,
                source.controller,
            ) {
                continue;
            }

            // Check ValidCard$ (what spell this applies to)
            if !valid_filter::matches_valid_card_selector_opt(
                st_ab.ir.valid_card.as_ref(),
                spell_card,
                source,
            ) {
                continue;
            }

            // Check ManaConversion$ — we support the dominant pattern
            if let Some(conversion) = st_ab.ir.mana_conversion.as_deref() {
                if conversion.contains("AnyColor") || conversion.contains("AnyType") {
                    return true;
                }
            }
        }
    }
    false
}

pub fn mana_convert(cards: &[Card], player: PlayerId, spell_card: &Card) -> bool {
    can_spend_mana_as_any_color(cards, player, spell_card)
}

pub fn check_mana_convert(
    st_ab: &crate::staticability::StaticAbility,
    source: &Card,
    player: PlayerId,
    spell_card: &Card,
) -> bool {
    if !valid_filter::matches_valid_player_selector_opt(
        st_ab.ir.valid_player.as_ref(),
        player,
        source.controller,
    ) {
        return false;
    }
    if !valid_filter::matches_valid_card_selector_opt(
        st_ab.ir.valid_card.as_ref(),
        spell_card,
        source,
    ) {
        return false;
    }
    st_ab
        .ir
        .mana_conversion
        .as_deref()
        .is_some_and(|conversion| conversion.contains("AnyColor") || conversion.contains("AnyType"))
}
