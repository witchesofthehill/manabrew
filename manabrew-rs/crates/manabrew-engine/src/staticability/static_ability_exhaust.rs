use crate::card::valid_filter;
use crate::game::GameState;
use crate::ids::PlayerId;
use crate::staticability::StaticMode;

/// Apply exhaust ability check for a specific card.
pub fn apply_with_exhaust(
    st_ab: &crate::staticability::StaticAbility,
    player: PlayerId,
    source_controller: PlayerId,
) -> bool {
    valid_filter::matches_valid_player_selector_opt(
        st_ab.ir.valid_player.as_ref(),
        player,
        source_controller,
    )
}

pub fn any_with_exhaust(game: &GameState, player: PlayerId) -> bool {
    for card in game
        .cards
        .iter()
        .filter(|c| c.zone.is_static_ability_source())
    {
        for st_ab in card
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::CanExhaust) && sa.zones_check(card.zone))
        {
            if valid_filter::matches_valid_player_selector_opt(
                st_ab.ir.valid_player.as_ref(),
                player,
                card.controller,
            ) {
                return true;
            }
        }
    }
    false
}
