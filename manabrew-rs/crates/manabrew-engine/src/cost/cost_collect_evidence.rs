//! Collect evidence as a cost. Mirrors Java's `CostCollectEvidence`.

// NOTE: pay_as_decided is handled by GameLoop::pay_collect_evidence_cost() in game_action.rs
// because it requires agent interaction for card selection and trigger firing (CollectEvidence).

pub const HASH_LKI: &str = "Collected";
pub const HASH_CARDS: &str = "CollectedCards";

pub fn payment_order(part: &super::CostPart) -> i32 {
    part.payment_order()
}

pub fn can_pay(
    game: &crate::game::GameState,
    _available_mana: &crate::mana::ManaPool,
    source: crate::ids::CardId,
    player: crate::ids::PlayerId,
    ability: Option<&crate::spellability::SpellAbility>,
    part: &super::CostPart,
) -> bool {
    let super::CostPart::CollectEvidence(amount) = part else {
        return false;
    };
    let resolved_amount = amount.resolve(game, source, player);
    let static_source_cards = super::static_ability_source_cards(game);
    let total_mv: i32 = game
        .cards_in_zone(forge_foundation::ZoneType::Graveyard, player)
        .iter()
        .filter(|&&cid| {
            !crate::staticability::static_ability_cant_exile::cant_exile(
                &static_source_cards,
                game.card(cid),
                ability,
                true,
            )
        })
        .map(|&cid| game.card(cid).mana_cost.cmc())
        .sum();
    total_mv >= resolved_amount
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
