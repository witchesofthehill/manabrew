use forge_foundation::ZoneType;

use crate::card::valid_filter;
use crate::game::GameState;
use crate::ids::PlayerId;
use crate::parsing::CompiledSelector;
use crate::staticability::StaticMode;

pub fn can_draw_amount(game: &GameState, player: PlayerId, start_amount: i32) -> i32 {
    if start_amount <= 0 {
        return 0;
    }
    let mut amount = start_amount;
    for card in game
        .cards
        .iter()
        .filter(|c| c.zone == ZoneType::Battlefield)
    {
        for st_ab in card
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::CantDraw))
        {
            let valid_player = st_ab.ir.valid_player.as_ref();
            if !matches_valid_player(valid_player, player, card.controller) {
                continue;
            }
            let limit = st_ab.ir.draw_limit.unwrap_or(0);
            let drawn = game.player(player).drawn_this_turn;
            amount = amount.min((limit - drawn).max(0));
        }
    }
    amount
}

pub fn can_draw_this_amount(game: &GameState, player: PlayerId, amount: i32) -> bool {
    can_draw_amount(game, player, amount) >= amount
}

pub fn apply_cant_draw_amount_ability(
    draw_limit: Option<&str>,
    valid_player: Option<&CompiledSelector>,
    player: PlayerId,
    source_controller: PlayerId,
    drawn_this_turn: i32,
    current_amount: i32,
) -> i32 {
    if !matches_valid_player(valid_player, player, source_controller) {
        return current_amount;
    }
    let limit = draw_limit.and_then(|s| s.parse::<i32>().ok()).unwrap_or(0);
    current_amount.min((limit - drawn_this_turn).max(0))
}

fn matches_valid_player(
    valid: Option<&CompiledSelector>,
    player: PlayerId,
    source_controller: PlayerId,
) -> bool {
    valid_filter::matches_valid_player_selector_opt(valid, player, source_controller)
}
