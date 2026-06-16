use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::Params;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::{Trigger, TriggerBehavior};

/// Mirrors Java's `TriggerImmediate extends Trigger`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerImmediate;

impl TriggerImmediate {
    pub fn parse(_params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self)
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerImmediate {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::Immediate
    }

    fn perform_test(&self, _trigger: &Trigger, _params: &RunParams, _game: &GameState) -> bool {
        // TODO: We're missing stuff in replacement to make this work
        true
    }

    fn set_triggering_objects(
        &self,
        _trigger: &Trigger,
        _sa: &mut SpellAbility,
        _params: &RunParams,
        _game: &GameState,
    ) {
    }

    fn get_important_stack_objects(&self, _trigger: &Trigger, _sa: &SpellAbility) -> String {
        String::new()
    }
}
