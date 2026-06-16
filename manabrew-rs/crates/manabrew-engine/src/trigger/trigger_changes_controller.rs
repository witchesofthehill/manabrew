use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerChangesController {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
}

impl TriggerChangesController {
    pub fn parse(valid_card: Option<crate::parsing::CompiledSelector>) -> Box<dyn TriggerBehavior> {
        Box::new(Self { valid_card })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerChangesController {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::ChangesController
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
        if let Some(card) = params.card {
            sa.set_triggering_object(crate::ability::AbilityKey::Card, card.0.to_string());
        }
        if let Some(p) = params.original_controller {
            sa.set_triggering_object(
                crate::ability::AbilityKey::OriginalController,
                p.0.to_string(),
            );
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "ChangedController: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Card)
                .unwrap_or_default()
        )
    }
}
