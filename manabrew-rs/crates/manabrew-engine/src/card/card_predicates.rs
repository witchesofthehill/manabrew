//! Card predicate helpers mirroring Java `CardPredicates`.

use std::cmp::Ordering;

use forge_foundation::ZoneType;

use crate::ability::ability_utils;
use crate::card::{Card, CounterType};
use crate::combat::combat_util;
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::spellability::SpellAbility;

fn shares_any_core_type(a: &Card, b: &Card) -> bool {
    a.type_line
        .core_types
        .iter()
        .any(|ty| b.type_line.core_types.contains(ty))
}

fn shares_all_core_types(a: &Card, b: &Card) -> bool {
    a.type_line
        .core_types
        .iter()
        .all(|ty| b.type_line.core_types.contains(ty))
        && b.type_line
            .core_types
            .iter()
            .all(|ty| a.type_line.core_types.contains(ty))
}

fn shares_any_subtype(a: &Card, b: &Card) -> bool {
    crate::game::TypeRegistry::creature_types()
        .iter()
        .any(|creature_type| {
            a.has_creature_type(creature_type) && b.has_creature_type(creature_type)
        })
        || a.type_line
            .subtypes
            .iter()
            .any(|s| b.type_line.has_subtype(s))
}

pub fn owner_lives(game: &GameState, card_id: CardId) -> bool {
    game.player(game.card(card_id).owner).is_alive()
}

pub fn has_keyword(card: &Card, keyword: &str) -> bool {
    card.has_keyword(keyword)
}

pub fn contains_keyword(card: &Card, keyword: &str) -> bool {
    let needle = keyword.to_ascii_lowercase();
    card.keywords
        .iter_strings()
        .chain(card.granted_keywords.iter_strings())
        .chain(card.pump_keywords.iter_strings())
        .any(|kw| kw.to_ascii_lowercase().contains(&needle))
}

pub fn name_equals(card: &Card, name: &str) -> bool {
    card.card_name == name
}

pub fn name_not_equals(card: &Card, name: &str) -> bool {
    card.card_name != name
}

pub fn shares_name_with(card: &Card, other: &Card) -> bool {
    card.card_name.eq_ignore_ascii_case(&other.card_name)
}

pub fn shares_cmc_with(card: &Card, other: &Card) -> bool {
    card.mana_value() == other.mana_value()
}

pub fn shares_color_with(card: &Card, other: &Card) -> bool {
    card.color.shares_color_with(other.color)
}

pub fn shares_controller_with(card: &Card, other: &Card) -> bool {
    card.controller == other.controller
}

pub fn shares_card_type_with(card: &Card, other: &Card) -> bool {
    shares_any_core_type(card, other)
}

pub fn shares_all_card_types_with(card: &Card, other: &Card) -> bool {
    shares_all_core_types(card, other)
}

pub fn shares_creature_type_with(card: &Card, other: &Card) -> bool {
    card.is_creature() && other.is_creature() && shares_any_subtype(card, other)
}

pub fn shares_land_type_with(card: &Card, other: &Card) -> bool {
    card.is_land() && other.is_land() && shares_any_subtype(card, other)
}

pub fn possible_blockers(game: &GameState, attacker: CardId) -> Vec<CardId> {
    game.cards
        .iter()
        .filter(|c| c.zone == ZoneType::Battlefield)
        .filter(|c| combat_util::can_creature_block(game, c.id, attacker))
        .map(|c| c.id)
        .collect()
}

pub fn possible_blocker_for_at_least_one(
    game: &GameState,
    blocker: CardId,
    attackers: &[CardId],
) -> bool {
    let blocker_card = game.card(blocker);
    blocker_card.is_creature()
        && attackers
            .iter()
            .any(|&attacker| combat_util::can_creature_block(game, blocker, attacker))
}

pub fn restriction(
    game: &GameState,
    card: CardId,
    restrictions: &str,
    source_controller: PlayerId,
) -> bool {
    ability_utils::matches_valid_cards(game.card(card), restrictions, source_controller)
}

pub fn can_be_sacrificed_by(
    game: &GameState,
    card: CardId,
    sa: &SpellAbility,
    effect: bool,
) -> bool {
    !crate::staticability::static_ability_cant_sacrifice::cant_sacrifice(
        &game.cards,
        game.card(card),
        Some(sa),
        effect,
    )
}

pub fn can_exiled_by(game: &GameState, card: CardId, sa: &SpellAbility, effect: bool) -> bool {
    !crate::staticability::static_ability_cant_exile::cant_exile(
        &game.cards,
        game.card(card),
        Some(sa),
        effect,
    )
}

pub fn can_be_attached(game: &GameState, target: CardId, aura: CardId) -> bool {
    !crate::staticability::static_ability_cant_attach::cant_attach(
        &game.cards,
        game.card(aura),
        game.card(target),
        false,
    )
}

pub fn has_cmc(card: &Card, cmc: i32) -> bool {
    card.mana_value() == cmc
}

pub fn greater_cmc(card: &Card, cmc: i32) -> bool {
    card.mana_value() >= cmc
}

pub fn less_cmc(card: &Card, cmc: i32) -> bool {
    card.mana_value() <= cmc
}

pub fn even_cmc(card: &Card) -> bool {
    card.mana_value() % 2 == 0
}

pub fn odd_cmc(card: &Card) -> bool {
    card.mana_value() % 2 == 1
}

pub fn has_counters(card: &Card) -> bool {
    card.counters.values().copied().any(|n| n > 0)
}

pub fn has_counter(card: &Card, counter: &CounterType) -> bool {
    card.counter_count(counter) >= 1
}

pub fn has_less_counter(card: &Card, counter: &CounterType, n: i32) -> bool {
    let count = card.counter_count(counter);
    count > 0 && count <= n
}

pub fn can_receive_counters(game: &GameState, card: CardId, counter: &CounterType) -> bool {
    !crate::staticability::static_ability_cant_put_counter::any_cant_put_counter_on_card(
        &game.cards,
        game.card(card),
        counter,
    )
}

pub fn has_greater_power_than(card: &Card, min_power: i32) -> bool {
    card.power() > min_power
}

pub fn compare_by_counter_type(
    game: &GameState,
    a: CardId,
    b: CardId,
    counter: &CounterType,
) -> Ordering {
    game.card(a)
        .counter_count(counter)
        .cmp(&game.card(b).counter_count(counter))
}

pub fn has_s_var(card: &Card, name: &str) -> bool {
    card.svars.contains_key(name)
}

pub fn compare_by_game_timestamp(game: &GameState, a: CardId, b: CardId) -> Ordering {
    game.card(a)
        .zone_timestamp
        .cmp(&game.card(b).zone_timestamp)
}

pub fn in_zone(game: &GameState, card: CardId, zones: &[ZoneType]) -> bool {
    zones.contains(&game.card(card).zone)
}

pub fn cast_sa(
    cast_sa: Option<&SpellAbility>,
    pred_sa: impl FnOnce(&SpellAbility) -> bool,
) -> bool {
    cast_sa.map(pred_sa).unwrap_or(false)
}

pub fn phased_in(card: &Card) -> bool {
    !card.phased_out
}
