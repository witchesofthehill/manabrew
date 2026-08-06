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
    pub valid_player: Option<crate::parsing::CompiledSelector>,
    pub valid_source: Option<crate::parsing::CompiledSelector>,
    pub counter_type: Option<String>,
    pub counter_amount: Option<String>,
}

impl TriggerCounterAdded {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
            valid_player: params.selector_cloned(keys::VALID_PLAYER),
            valid_source: params.selector_cloned(keys::VALID_SOURCE),
            counter_type: params.get_cloned(keys::COUNTER_TYPE),
            counter_amount: params.get_cloned("CounterAmount"),
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
        if !trigger.matches_optional_valid_card_filter(&self.valid_card, params.card, game) {
            return false;
        }
        if let Some(filter) = &self.valid_player {
            let Some(player) = params.player else {
                return false;
            };
            if !trigger.matches_valid_player_filter(filter, player, game) {
                return false;
            }
        }
        if let Some(filter) = &self.valid_source {
            let Some(source) = params.source_player else {
                return false;
            };
            if !trigger.matches_valid_player_filter(filter, source, game) {
                return false;
            }
        }
        super::trigger::Trigger::matches_counter_type_filter(
            &self.counter_type,
            &params.counter_type,
        ) && self.counter_amount.as_ref().is_none_or(|expected| {
            let Some(actual) = params.counter_amount else {
                return true;
            };
            let Some(operator) = expected.get(..2) else {
                return false;
            };
            let Ok(operand) = expected[2..].parse::<i32>() else {
                return false;
            };
            match operator {
                "EQ" => actual == operand,
                "NE" => actual != operand,
                "GE" => actual >= operand,
                "GT" => actual > operand,
                "LE" => actual <= operand,
                "LT" => actual < operand,
                _ => false,
            }
        })
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
            format!("AddedOnce: {c}")
        } else if let Some(p) = player {
            format!("AddedOnce: {p}")
        } else {
            String::new()
        }
    }
}
