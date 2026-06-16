use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerCounterRemovedOnce {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub counter_type: Option<String>,
}

impl TriggerCounterRemovedOnce {
    pub fn parse(
        valid_card: Option<crate::parsing::CompiledSelector>,
        counter_type: Option<String>,
    ) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card,
            counter_type,
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerCounterRemovedOnce {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::CounterRemovedOnce
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        trigger.matches_optional_valid_card_filter(&self.valid_card, params.card, game)
            && super::trigger::Trigger::matches_counter_type_filter(
                &self.counter_type,
                &params.counter_type,
            )
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
        if let Some(amount) = params.counter_amount {
            sa.set_triggering_object(crate::ability::AbilityKey::Amount, amount.to_string());
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "RemovedFrom: {}, Amount: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Card)
                .unwrap_or_default(),
            sa.get_triggering_object(crate::ability::AbilityKey::Amount)
                .unwrap_or_default()
        )
    }
}
