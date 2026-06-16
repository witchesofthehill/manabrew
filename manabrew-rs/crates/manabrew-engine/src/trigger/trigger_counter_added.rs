use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerCounterAdded {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub counter_type: Option<String>,
}

impl TriggerCounterAdded {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
            counter_type: params.get_cloned(keys::COUNTER_TYPE),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerCounterAdded {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::CounterAdded
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
        if let Some(p) = params.player {
            sa.set_triggering_object(crate::ability::AbilityKey::Player, p.0.to_string());
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        let card = sa.get_triggering_object(crate::ability::AbilityKey::Card);
        let player = sa.get_triggering_object(crate::ability::AbilityKey::Player);
        if let Some(c) = card {
            format!("AddedOnce: {}", c)
        } else if let Some(p) = player {
            format!("AddedOnce: {}", p)
        } else {
            String::new()
        }
    }
}
