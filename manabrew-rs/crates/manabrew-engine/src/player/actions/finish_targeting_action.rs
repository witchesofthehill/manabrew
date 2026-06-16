use super::PlayerAction;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct FinishTargetingAction;

impl From<FinishTargetingAction> for PlayerAction {
    fn from(_: FinishTargetingAction) -> Self {
        PlayerAction::FinishTargeting
    }
}
