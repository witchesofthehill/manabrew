use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerChampioned {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub valid_source: Option<crate::parsing::CompiledSelector>,
}

impl TriggerChampioned {
    pub fn parse(
        valid_card: Option<crate::parsing::CompiledSelector>,
        valid_source: Option<crate::parsing::CompiledSelector>,
    ) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card,
            valid_source,
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerChampioned {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::Championed
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        trigger.matches_optional_valid_card_filter(
            &self.valid_card,
            params.championed_card.or(params.card),
            game,
        ) && trigger.matches_optional_valid_card_filter(&self.valid_source, params.card, game)
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        if let Some(c) = params.championed_card {
            sa.set_triggering_object(crate::ability::AbilityKey::Championed, c.0.to_string());
        }
        if let Some(card) = params.card {
            sa.set_triggering_object(crate::ability::AbilityKey::Card, card.0.to_string());
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "Championed: {}",
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::Championed)
                .cloned()
                .unwrap_or_default()
        )
    }
}
