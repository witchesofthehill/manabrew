use crate::card::valid_filter;
use crate::game::GameState;
use crate::ids::PlayerId;
use crate::staticability::StaticMode;

pub fn get_devotion_mod(game: &GameState, player: PlayerId) -> i32 {
    let mut total = 0;
    for card in game
        .cards
        .iter()
        .filter(|c| c.zone.is_static_ability_source())
    {
        for st_ab in card
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::Devotion) && sa.zones_check(card.zone))
        {
            if !valid_filter::matches_valid_player_selector_opt(
                st_ab.ir.valid_player.as_ref(),
                player,
                card.controller,
            ) {
                continue;
            }
            let val = st_ab
                .ir
                .value_text
                .as_deref()
                .and_then(|s| s.parse::<i32>().ok())
                .unwrap_or(1);
            total += val;
        }
    }
    total
}
