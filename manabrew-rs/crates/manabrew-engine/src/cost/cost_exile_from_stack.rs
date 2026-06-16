//! Exile spells from the stack as a cost. Mirrors Java's `CostExileFromStack`.

// NOTE: pay_as_decided is handled by GameLoop::pay_exile_from_stack_cost() in game_action.rs
// because it requires stack manipulation and agent interaction for target selection.

pub fn payment_order(part: &super::CostPart) -> i32 {
    part.payment_order()
}

pub fn can_pay(
    game: &crate::game::GameState,
    _available_mana: &crate::mana::ManaPool,
    source: crate::ids::CardId,
    player: crate::ids::PlayerId,
    _ability: Option<&crate::spellability::SpellAbility>,
    part: &super::CostPart,
) -> bool {
    let super::CostPart::ExileFromStack {
        amount,
        type_filter,
    } = part
    else {
        return false;
    };
    let resolved_amount = amount.resolve(game, source, player);
    if type_filter == "All" {
        return true;
    }
    let count = game
        .stack
        .iter()
        .filter(|e| e.spell_ability.is_spell)
        .filter_map(|e| e.spell_ability.source)
        .filter(|&cid| {
            super::matches_exile_from_stack_filter(game, cid, source, player, type_filter)
        })
        .count() as i32;
    count >= resolved_amount
}

pub fn pay_as_decided() -> bool {
    true
}

pub fn pay_with_decision(
    _game: &mut crate::game::GameState,
    _player: crate::ids::PlayerId,
    _source: crate::ids::CardId,
    _part: &super::CostPart,
    _decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    true
}
