use crate::agent::PlayOption;

use super::player_action::PlayerAction;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CastSpellAction {
    pub play: PlayOption,
}

impl From<CastSpellAction> for PlayerAction {
    fn from(value: CastSpellAction) -> Self {
        PlayerAction::CastSpell(value.play)
    }
}
