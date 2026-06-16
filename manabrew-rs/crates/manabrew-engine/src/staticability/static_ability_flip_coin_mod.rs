use crate::card::valid_filter;
use crate::game::GameState;
use crate::ids::PlayerId;
use crate::staticability::StaticMode;

/// Returns the fixed coin flip result if any static forces it, or None.
///
/// Mirrors Java's `StaticAbilityFlipCoinMod.fixedResult()`.
pub fn fixed_result(game: &GameState, player: PlayerId) -> Option<bool> {
    for card in game
        .cards
        .iter()
        .filter(|c| c.zone.is_static_ability_source())
    {
        for st_ab in card
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::FlipCoinMod) && sa.zones_check(card.zone))
        {
            if !valid_filter::matches_valid_player_selector_opt(
                st_ab.ir.valid_player.as_ref(),
                player,
                card.controller,
            ) {
                continue;
            }
            // Java: return Boolean.valueOf(stAb.getParam("Result"));
            // If Result param is absent, Boolean.valueOf(null) returns false.
            // We mirror that: absent param -> Some(false).
            match st_ab.ir.result_text.as_deref() {
                Some(result) => return Some(result.eq_ignore_ascii_case("True")),
                None => return Some(false),
            }
        }
    }
    None
}
