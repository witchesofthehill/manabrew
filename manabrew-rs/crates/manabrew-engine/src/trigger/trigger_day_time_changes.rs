use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::Params;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerDayTimeChanges;

impl TriggerDayTimeChanges {
    pub fn parse(_params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self)
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerDayTimeChanges {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::DayTimeChanges
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
