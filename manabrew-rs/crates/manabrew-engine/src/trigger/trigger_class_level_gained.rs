use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerClassLevelGained {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub class_level: Option<i32>,
}

impl TriggerClassLevelGained {
    pub fn parse(
        valid_card: Option<crate::parsing::CompiledSelector>,
        class_level: Option<i32>,
    ) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card,
            class_level,
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerClassLevelGained {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::ClassLevelGained
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        let _host_card = trigger.base.card_trait_base.host_card_id();
        let _host_controller = trigger.base.card_trait_base.host_controller(game);
        if !trigger.matches_optional_valid_card_filter(&self.valid_card, params.card, game) {
            return false;
        }
        if let Some(expected) = self.class_level {
            return params.class_level == Some(expected);
        }
        true
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        if let Some(level) = params.class_level {
            sa.set_triggering_object(crate::ability::AbilityKey::ClassLevel, level.to_string());
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "Class Level: {}",
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::ClassLevel)
                .cloned()
                .unwrap_or_default()
        )
    }
}
