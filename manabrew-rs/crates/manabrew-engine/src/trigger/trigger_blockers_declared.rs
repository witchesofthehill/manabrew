use serde::{Deserialize, Serialize};

use crate::{
    event::RunParams, game::GameState, parsing::Params, spellability::SpellAbility,
    trigger::TriggerType,
};

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerBlockersDeclared;

impl TriggerBlockersDeclared {
    pub fn parse(_params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self)
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerBlockersDeclared {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::BlockersDeclared
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
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        if let Some(blockers) = params.blocker_ids.as_ref() {
            let csv = blockers
                .iter()
                .map(|c| c.0.to_string())
                .collect::<Vec<_>>()
                .join(",");
            sa.set_triggering_object(crate::ability::AbilityKey::Blockers, &csv);
        }
        if let Some(attackers) = params.attacker_ids.as_ref() {
            let csv = attackers
                .iter()
                .map(|c| c.0.to_string())
                .collect::<Vec<_>>()
                .join(",");
            sa.set_triggering_object(crate::ability::AbilityKey::Attackers, &csv);
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "Blockers: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Blockers)
                .unwrap_or("")
        )
    }
}
