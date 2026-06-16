use crate::ids::CardId;

use super::PlayerAction;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PayCostAction {
    pub card_id: CardId,
}

impl From<PayCostAction> for PlayerAction {
    fn from(value: PayCostAction) -> Self {
        PlayerAction::PayCost(value.card_id)
    }
}
