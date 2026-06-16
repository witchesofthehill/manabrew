use crate::game::GameState;
use crate::ids::PlayerId;

pub fn is_active_player(game: &GameState, player: PlayerId) -> bool {
    game.active_player() == player
}

pub fn is_opponent_of(game: &GameState, player: PlayerId, other: PlayerId) -> bool {
    player != other && !same_team(game, player, other)
}

pub fn same_team(game: &GameState, player: PlayerId, other: PlayerId) -> bool {
    let a = game.player(player).team_number;
    let b = game.player(other).team_number;
    a >= 0 && a == b
}

pub fn is_alive(game: &GameState, player: PlayerId) -> bool {
    game.player(player).is_alive()
}

pub fn can_discard_by(game: &GameState, player: PlayerId, other: PlayerId) -> bool {
    is_opponent_of(game, player, other) || same_team(game, player, other)
}

pub fn has_counters(game: &GameState, player: PlayerId) -> bool {
    let p = game.player(player);
    p.poison_counters > 0 || p.energy_counters > 0 || p.radiation_counters > 0
}

pub fn life_less_or_equal_to(game: &GameState, player: PlayerId, life: i32) -> bool {
    game.player(player).life <= life
}

pub fn life_greater_or_equal_to(game: &GameState, player: PlayerId, life: i32) -> bool {
    game.player(player).life >= life
}

pub fn has_counter(game: &GameState, player: PlayerId, counter: &str) -> bool {
    match counter {
        "Poison" => game.player(player).poison_counters > 0,
        "Energy" => game.player(player).energy_counters > 0,
        "Rad" | "Radiation" => game.player(player).radiation_counters > 0,
        _ => false,
    }
}

pub fn has_keyword(game: &GameState, player: PlayerId, keyword: &str) -> bool {
    game.player(player)
        .changed_keywords
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(keyword))
}

pub fn can_be_attached(game: &GameState, player: PlayerId) -> bool {
    is_alive(game, player)
}

pub fn has_urza_lands(game: &GameState, player: PlayerId) -> bool {
    let controls = |subtype: &str| {
        game.cards_in_zone(forge_foundation::ZoneType::Battlefield, player)
            .iter()
            .any(|&cid| {
                let card = game.card(cid);
                card.type_line.has_subtype("Urza's") && card.type_line.has_subtype(subtype)
            })
    };
    controls("Mine") && controls("Power-Plant") && controls("Tower")
}

pub fn restriction(game: &GameState, player: PlayerId, restriction: &str) -> bool {
    if restriction.trim().is_empty() {
        return true;
    }
    restriction
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .all(|part| match part {
            "You" | "Player.You" => true,
            "Opponent" | "Player.Opponent" => game
                .player_order
                .iter()
                .copied()
                .any(|other| is_opponent_of(game, player, other)),
            "ActivePlayer" => is_active_player(game, player),
            "Monarch" => game.monarch == Some(player),
            _ => false,
        })
}

pub fn compare_by_zone_size(
    game: &GameState,
    zone: forge_foundation::ZoneType,
) -> impl Fn(&PlayerId, &PlayerId) -> std::cmp::Ordering + '_ {
    move |a, b| {
        game.cards_in_zone(zone, *a)
            .len()
            .cmp(&game.cards_in_zone(zone, *b).len())
    }
}

pub fn compare_by_life(
    game: &GameState,
) -> impl Fn(&PlayerId, &PlayerId) -> std::cmp::Ordering + '_ {
    move |a, b| game.player(*a).life.cmp(&game.player(*b).life)
}

pub fn compare_by_poison(
    game: &GameState,
) -> impl Fn(&PlayerId, &PlayerId) -> std::cmp::Ordering + '_ {
    move |a, b| {
        game.player(*a)
            .poison_counters
            .cmp(&game.player(*b).poison_counters)
    }
}
