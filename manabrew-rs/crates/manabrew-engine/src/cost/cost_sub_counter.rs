//! Remove counters from source as a cost. Mirrors Java's `CostRemoveCounter`.

use crate::card::CounterType;
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};

pub fn pay_as_decided(
    game: &mut GameState,
    source: CardId,
    amount: i32,
    counter_type: &CounterType,
) -> bool {
    game.card_mut(source).remove_counter(counter_type, amount);
    true
}

/// Refund by adding counters back.
pub fn refund(game: &mut GameState, source: CardId, amount: i32, counter_type: &CounterType) {
    game.card_mut(source).add_counter(counter_type, amount);
}

pub fn can_pay(game: &GameState, source: CardId, part: &super::CostPart) -> bool {
    let super::CostPart::SubCounter {
        amount,
        counter_type,
        type_filter,
    } = part
    else {
        return false;
    };
    let controller = game.card(source).controller;
    can_pay_for_player(
        game,
        source,
        controller,
        amount.resolve(game, source, controller),
        counter_type,
        type_filter,
    )
}

pub fn can_pay_for_player(
    game: &GameState,
    source: CardId,
    player: PlayerId,
    amount: i32,
    counter_type: &CounterType,
    type_filter: &str,
) -> bool {
    if !type_filter.eq_ignore_ascii_case("CARDNAME")
        && !type_filter.eq_ignore_ascii_case("NICKNAME")
    {
        return super::get_sub_counter_targets(game, player, source, type_filter)
            .into_iter()
            .any(|cid| game.card(cid).counter_count(counter_type) >= amount);
    }
    let card = game.card(source);
    if card.zone != forge_foundation::ZoneType::Battlefield || card.phased_out {
        return false;
    }
    card.counter_count(counter_type) >= amount
}
