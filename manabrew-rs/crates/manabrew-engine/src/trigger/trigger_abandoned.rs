use serde::{Deserialize, Serialize};

use super::trigger::TriggerBehavior;
use crate::{
    event::RunParams,
    game::GameState,
    parsing::{keys, Params},
    spellability::SpellAbility,
    trigger::TriggerType,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerAbandoned {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
}

impl TriggerAbandoned {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerAbandoned {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::Abandoned
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        let _host_card = trigger.base.card_trait_base.host_card_id();
        let _host_controller = trigger.base.card_trait_base.host_controller(game);
        trigger.matches_optional_valid_card_filter(&self.valid_card, params.card, game)
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        if let Some(v) = params.card.as_ref() {
            sa.set_triggering_object(crate::ability::AbilityKey::Scheme, v.0.to_string());
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        _sa: &SpellAbility,
    ) -> String {
        String::new()
    }
}
