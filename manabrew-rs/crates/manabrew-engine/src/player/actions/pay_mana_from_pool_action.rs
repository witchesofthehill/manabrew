use super::player_action::{ManaChoice, PlayerAction};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PayManaFromPoolAction {
    pub color_selected: u8,
}

impl From<PayManaFromPoolAction> for PlayerAction {
    fn from(value: PayManaFromPoolAction) -> Self {
        PlayerAction::PayManaFromPool(ManaChoice {
            color_code: value.color_selected,
        })
    }
}
