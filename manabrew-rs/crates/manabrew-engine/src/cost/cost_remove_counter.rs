//! Parity shim for Java `CostRemoveCounter`.

pub fn pay_as_decided(
    game: &mut crate::game::GameState,
    source: crate::ids::CardId,
    amount: i32,
    counter_type: &crate::card::CounterType,
) -> bool {
    crate::cost::cost_sub_counter::pay_as_decided(game, source, amount, counter_type)
}

pub fn refund(
    game: &mut crate::game::GameState,
    source: crate::ids::CardId,
    amount: i32,
    counter_type: &crate::card::CounterType,
) {
    crate::cost::cost_sub_counter::refund(game, source, amount, counter_type);
}

pub fn can_pay(
    game: &crate::game::GameState,
    _available_mana: &crate::mana::ManaPool,
    source: crate::ids::CardId,
    player: crate::ids::PlayerId,
    _ability: Option<&crate::spellability::SpellAbility>,
    part: &super::CostPart,
) -> bool {
    let super::CostPart::SubCounter {
        amount,
        counter_type,
        type_filter,
    } = part
    else {
        return false;
    };
    crate::cost::cost_sub_counter::can_pay_for_player(
        game,
        source,
        player,
        amount.resolve(game, source, player),
        counter_type,
        type_filter,
    )
}

pub fn pay_with_decision(
    game: &mut crate::game::GameState,
    player: crate::ids::PlayerId,
    source: crate::ids::CardId,
    part: &super::CostPart,
    _decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    let super::CostPart::SubCounter {
        amount,
        counter_type,
        type_filter,
    } = part
    else {
        return false;
    };
    let resolved = amount.resolve(game, source, player);
    if !type_filter.eq_ignore_ascii_case("CARDNAME")
        && !type_filter.eq_ignore_ascii_case("NICKNAME")
    {
        let Some(target) = super::get_sub_counter_targets(game, player, source, type_filter)
            .into_iter()
            .find(|cid| game.card(*cid).counter_count(counter_type) >= resolved)
        else {
            return false;
        };
        return pay_as_decided(game, target, resolved, counter_type);
    }
    pay_as_decided(game, source, resolved, counter_type)
}

pub fn payment_order(part: &super::CostPart) -> i32 {
    part.payment_order()
}
