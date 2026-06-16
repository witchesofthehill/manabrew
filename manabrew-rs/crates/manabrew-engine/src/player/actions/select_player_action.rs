use crate::ids::PlayerId;

use super::PlayerAction;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SelectPlayerAction {
    pub player_id: PlayerId,
}

impl From<SelectPlayerAction> for PlayerAction {
    fn from(value: SelectPlayerAction) -> Self {
        PlayerAction::SelectPlayer(value.player_id)
    }
}
