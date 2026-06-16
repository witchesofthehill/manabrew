//! Exert permanents as a cost. Mirrors Java's `CostExert`.

// NOTE: pay_as_decided is handled by GameLoop::pay_exert_cost() in game_action.rs
// because it requires agent interaction and trigger firing (Exerted).

pub const HASH_LKI: &str = "Exerted";
pub const HASH_CARDS: &str = "ExertedCards";

pub fn can_pay(
    game: &crate::game::GameState,
    _available_mana: &crate::mana::ManaPool,
    source: crate::ids::CardId,
    player: crate::ids::PlayerId,
    _ability: Option<&crate::spellability::SpellAbility>,
    part: &super::CostPart,
) -> bool {
    let super::CostPart::Exert {
        amount,
        type_filter,
    } = part
    else {
        return false;
    };
    let resolved_amount = amount.resolve(game, source, player);
    if type_filter == "CARDNAME" || type_filter == "NICKNAME" {
        return resolved_amount <= 1;
    }
    let count = game
        .cards_in_zone(forge_foundation::ZoneType::Battlefield, player)
        .iter()
        .filter(|&&cid| {
            crate::ability::effects::matches_change_type(game.card(cid), type_filter, &[])
        })
        .count() as i32;
    count >= resolved_amount
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
