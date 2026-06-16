use crate::ids::CardId;

use super::PlayerAction;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SelectCardAction {
    pub card_id: CardId,
}

impl From<SelectCardAction> for PlayerAction {
    fn from(value: SelectCardAction) -> Self {
        PlayerAction::SelectCard(value.card_id)
    }
}
