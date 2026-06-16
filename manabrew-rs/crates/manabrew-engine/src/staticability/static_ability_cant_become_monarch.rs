use crate::card::valid_filter;
use crate::game::GameState;
use crate::ids::PlayerId;
use crate::staticability::StaticMode;

pub fn any_cant_become_monarch(game: &GameState, player: PlayerId) -> bool {
    for card in game
        .cards
        .iter()
        .filter(|c| c.zone.is_static_ability_source())
    {
        for st_ab in card
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::CantBecomeMonarch) && sa.zones_check(card.zone))
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
