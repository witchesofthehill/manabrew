use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerCounterAddedOnce {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub counter_type: Option<String>,
    pub valid_source: Option<crate::parsing::CompiledSelector>,
}

impl TriggerCounterAddedOnce {
    pub fn parse(
        valid_card: Option<crate::parsing::CompiledSelector>,
        counter_type: Option<String>,
        valid_source: Option<crate::parsing::CompiledSelector>,
    ) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card,
            counter_type,
            valid_source,
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerCounterAddedOnce {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::CounterAddedOnce
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        let host_controller = trigger.base.card_trait_base.host_controller(game);
        if !trigger.matches_optional_valid_card_filter(&self.valid_card, params.card, game) {
            return false;
        }
        if !super::trigger::Trigger::matches_counter_type_filter(
            &self.counter_type,
            &params.counter_type,
        ) {
            return false;
        }
        if let Some(filter) = &self.valid_source {
            if filter.is_any_of(["You"]) {
                return params.cause_player == Some(host_controller);
            }
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
        if let Some(card) = params.card {
            sa.set_triggering_object(crate::ability::AbilityKey::Card, card.0.to_string());
        }
        if let Some(p) = params.player {
            sa.set_triggering_object(crate::ability::AbilityKey::Player, p.0.to_string());
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
        let target = sa
            .trigger_objects
            .get(&crate::ability::AbilityKey::Card)
            .or(sa.trigger_objects.get(&crate::ability::AbilityKey::Player));
        format!(
            "AddedOnce: {}, Amount: {}",
            target.cloned().unwrap_or_default(),
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::Amount)
                .cloned()
                .unwrap_or_default()
        )
    }
}
