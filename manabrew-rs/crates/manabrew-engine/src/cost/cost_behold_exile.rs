//! Behold+Exile parity file for Java `CostBeholdExile`.

use crate::game::GameState;
use crate::ids::CardId;

pub fn pay_as_decided_cards(game: &mut GameState, cards: &[CardId]) -> bool {
    crate::cost::cost_behold::pay_as_decided_cards(game, cards, true)
}

pub fn can_pay(
    game: &crate::game::GameState,
    available_mana: &crate::mana::ManaPool,
    source: crate::ids::CardId,
    player: crate::ids::PlayerId,
    ability: Option<&crate::spellability::SpellAbility>,
    part: &super::CostPart,
) -> bool {
    crate::cost::cost_behold::can_pay(game, available_mana, source, player, ability, part)
}
