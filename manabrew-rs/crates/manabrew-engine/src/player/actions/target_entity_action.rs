use crate::ids::{CardId, PlayerId};

use super::player_action::{PlayerAction, TargetEntity};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetEntityAction {
    Card(CardId),
    Player(PlayerId),
}

impl From<TargetEntityAction> for PlayerAction {
    fn from(value: TargetEntityAction) -> Self {
        match value {
            TargetEntityAction::Card(card_id) => {
                PlayerAction::TargetEntity(TargetEntity::Card(card_id))
            }
            TargetEntityAction::Player(player_id) => {
                PlayerAction::TargetEntity(TargetEntity::Player(player_id))
            }
        }
    }
}
