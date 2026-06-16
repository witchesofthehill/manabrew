use crate::card::valid_filter;
use crate::game::GameState;
use crate::ids::PlayerId;
use crate::staticability::StaticMode;

pub fn is_turn_reversed(game: &GameState, player: PlayerId) -> bool {
    any_turn_phase_reversed(game, player, StaticMode::TurnReversed)
}

pub fn is_phase_reversed(game: &GameState, player: PlayerId) -> bool {
    any_turn_phase_reversed(game, player, StaticMode::PhaseReversed)
}

fn any_turn_phase_reversed(game: &GameState, player: PlayerId, mode: StaticMode) -> bool {
    let mut result = false;
    for card in game
        .cards
        .iter()
        .filter(|c| c.zone.is_static_ability_source())
    {
        for st_ab in card
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&mode) && sa.zones_check(card.zone))
        {
            if valid_filter::matches_valid_player_selector_opt(
                st_ab.ir.valid_player.as_ref(),
                player,
                card.controller,
            ) {
                result = !result;
            }
        }
    }
    result
}
