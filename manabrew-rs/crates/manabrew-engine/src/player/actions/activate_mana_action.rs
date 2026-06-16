use crate::ids::CardId;

use super::PlayerAction;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ActivateManaAction {
    pub card_id: CardId,
}

impl From<ActivateManaAction> for PlayerAction {
    fn from(value: ActivateManaAction) -> Self {
        PlayerAction::ActivateMana(value.card_id, None)
    }
}
