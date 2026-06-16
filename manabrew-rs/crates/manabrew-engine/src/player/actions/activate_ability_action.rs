use crate::ids::CardId;

use super::player_action::{AbilityRef, PlayerAction};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ActivateAbilityAction {
    pub card_id: CardId,
    pub ability_index: usize,
}

impl From<ActivateAbilityAction> for PlayerAction {
    fn from(value: ActivateAbilityAction) -> Self {
        PlayerAction::ActivateAbility(AbilityRef {
            card_id: value.card_id,
            ability_index: value.ability_index,
        })
    }
}
