//! Waterbend as a cost. Mirrors Java's `CostWaterbend` which extends `CostPartMana`.
//!
//! Waterbend N means pay N generic mana, but you can tap your artifacts and creatures
//! to help pay (each tapped = {1}, like convoke + improvise combined).

// NOTE: pay_as_decided for waterbend requires agent interaction (choose_convoke)
// and mana pool access, so it stays in GameLoop::pay_waterbend_cost() in game_action.rs.

pub fn can_pay(
    game: &crate::game::GameState,
    available_mana: Option<&crate::mana::ManaPool>,
    source: crate::ids::CardId,
    player: crate::ids::PlayerId,
    part: &super::CostPart,
) -> bool {
    let super::CostPart::Waterbend { amount } = part else {
        return false;
    };
    let pool_total = available_mana.map_or(0, |p| p.total_mana());
    let tappable_count = game
        .cards_in_zone(forge_foundation::ZoneType::Battlefield, player)
        .iter()
        .filter(|&&cid| {
            let c = game.card(cid);
            !c.tapped && cid != source && (c.is_creature() || c.type_line.is_artifact())
        })
        .count() as i32;
    pool_total + tappable_count >= amount.resolve(game, source, player)
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
