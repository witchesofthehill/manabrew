use serde::{Deserialize, Serialize};

use crate::{
    event::RunParams, game::GameState, parsing::Params, spellability::SpellAbility,
    trigger::TriggerType,
};

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerAlways;

impl TriggerAlways {
    pub fn parse(_params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self)
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerAlways {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::Always
    }

    fn perform_test(
        &self,
        _trigger: &super::trigger::Trigger,
        _params: &RunParams,
        _game: &GameState,
    ) -> bool {
        true
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        _sa: &mut SpellAbility,
        _params: &RunParams,
        _game: &GameState,
    ) {
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        _sa: &SpellAbility,
    ) -> String {
        String::new()
    }
}
