use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerCounterAddedAll {
    pub counter_type: Option<String>,
    pub valid: Option<crate::parsing::CompiledSelector>,
}

impl TriggerCounterAddedAll {
    pub fn parse(
        counter_type: Option<String>,
        valid: Option<crate::parsing::CompiledSelector>,
    ) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            counter_type,
            valid,
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerCounterAddedAll {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::CounterAddedAll
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        if !super::trigger::Trigger::matches_counter_type_filter(
            &self.counter_type,
            &params.counter_type,
        ) {
            return false;
        }

        let Some(valid_filter) = self.valid.as_ref() else {
            return true;
        };

        if let Some(cid) = params.object_card.or(params.card) {
            return trigger.matches_valid_card_filter(valid_filter, cid, game);
        }
        if let Some(pid) = params.object_player.or(params.player) {
            return trigger.matches_valid_player_filter(valid_filter, pid, game);
        }
        false
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        if let Some(cards) = params.cards.as_ref() {
            let csv = cards
                .iter()
                .map(|c| c.0.to_string())
                .collect::<Vec<_>>()
                .join(",");
            sa.set_triggering_object(crate::ability::AbilityKey::Objects, &csv);
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
            "Amount: {}",
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::Amount)
                .cloned()
                .unwrap_or_default()
        )
    }
}
