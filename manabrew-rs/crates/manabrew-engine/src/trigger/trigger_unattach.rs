use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::{Trigger, TriggerBehavior};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerUnattach {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
}

impl TriggerUnattach {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerUnattach {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::Unattached
    }

    fn perform_test(&self, trigger: &Trigger, params: &RunParams, game: &GameState) -> bool {
        let _host_card = trigger.base.card_trait_base.host_card_id();
        let _host_controller = trigger.base.card_trait_base.host_controller(game);
        trigger.matches_optional_valid_card_filter(&self.valid_card, params.card, game)
    }

    fn set_triggering_objects(
        &self,
        _trigger: &Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        if let Some(obj) = params.object_card {
            sa.set_triggering_object(crate::ability::AbilityKey::Object, obj.0.to_string());
        }
        if let Some(src) = params.source_card {
            sa.set_triggering_object(crate::ability::AbilityKey::AttachSource, src.0.to_string());
        }
    }

    fn get_important_stack_objects(&self, _trigger: &Trigger, sa: &SpellAbility) -> String {
        format!(
            "Object: {}, Attachment: {}",
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::Object)
                .map(|s| s.as_str())
                .unwrap_or(""),
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::AttachSource)
                .map(|s| s.as_str())
                .unwrap_or("")
        )
    }
}
