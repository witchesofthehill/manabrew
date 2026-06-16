//! Forage as a cost. Mirrors Java's `CostForage`.
//!
//! Forage: exile 3 cards from your graveyard, or sacrifice a Food.

// NOTE: pay_as_decided is handled by GameLoop::pay_forage_cost() in game_action.rs
// because it requires agent interaction (choose GY cards or Food) and trigger firing (Forage).

pub const HASH_LKI: &str = "Foraged";
pub const HASH_CARDS: &str = "ForagedCards";

pub fn can_pay(
    game: &crate::game::GameState,
    _available_mana: &crate::mana::ManaPool,
    _source: crate::ids::CardId,
    player: crate::ids::PlayerId,
    ability: Option<&crate::spellability::SpellAbility>,
    _part: &super::CostPart,
) -> bool {
    let static_source_cards = super::static_ability_source_cards(game);
    let gy_count = game
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
        .count() as i32;
    let has_food = game
        .cards_in_zone(forge_foundation::ZoneType::Battlefield, player)
        .iter()
        .any(|&cid| {
            game.card(cid).type_line.has_subtype("Food")
                && !crate::staticability::static_ability_cant_sacrifice::cant_sacrifice(
                    &static_source_cards,
                    game.card(cid),
                    ability,
                    true,
                )
        });
    gy_count >= 3 || has_food
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
