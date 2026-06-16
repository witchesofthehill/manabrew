use crate::ids::CardId;

use super::PlayerAction;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UndoManaAction {
    pub card_id: CardId,
}

impl From<UndoManaAction> for PlayerAction {
    fn from(value: UndoManaAction) -> Self {
        PlayerAction::UndoMana(value.card_id)
    }
}
