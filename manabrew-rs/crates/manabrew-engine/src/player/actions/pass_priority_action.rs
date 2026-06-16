use super::PlayerAction;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PassPriorityAction;

impl From<PassPriorityAction> for PlayerAction {
    fn from(_: PassPriorityAction) -> Self {
        PlayerAction::PassPriority
    }
}
