use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerCounterPlayerAddedAll {
    pub valid_source: Option<crate::parsing::CompiledSelector>,
    pub valid_object: Option<crate::parsing::CompiledSelector>,
    pub valid_object_to_source: Option<crate::parsing::CompiledSelector>,
}

impl TriggerCounterPlayerAddedAll {
    pub fn parse(
        valid_source: Option<crate::parsing::CompiledSelector>,
        valid_object: Option<crate::parsing::CompiledSelector>,
        valid_object_to_source: Option<crate::parsing::CompiledSelector>,
    ) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_source,
            valid_object,
            valid_object_to_source,
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerCounterPlayerAddedAll {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::CounterPlayerAddedAll
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        if let Some(filter) = &self.valid_source {
            let source_ok = if let Some(cid) = params.source_card.or(params.card) {
                trigger.matches_valid_card_filter(filter, cid, game)
            } else if let Some(pid) = params.source_player {
                trigger.matches_valid_player_filter(filter, pid, game)
            } else {
                false
            };
            if !source_ok {
                return false;
            }
        }

        if let Some(filter) = &self.valid_object {
            let object_ok = if let Some(cid) = params.object_card {
                trigger.matches_valid_card_filter(filter, cid, game)
            } else if let Some(pid) = params.object_player {
                trigger.matches_valid_player_filter(filter, pid, game)
            } else {
                false
            };
            if !object_ok {
                return false;
            }
        }

        if let Some(filter) = &self.valid_object_to_source {
            let Some(source_player) = params.source_player else {
                return false;
            };
            let object_ok = if let Some(pid) = params.object_player {
                trigger.matches_valid_player_filter_with_controller(filter, pid, source_player)
            } else if let Some(cid) = params.object_card {
                let card_controller = game.card(cid).controller;
                let raw_filter = filter.as_raw();
                if raw_filter.contains("YouCtrl") {
                    card_controller == source_player
                } else if raw_filter.contains("OppCtrl") {
                    card_controller != source_player
                } else {
                    trigger.matches_valid_card_filter(filter, cid, game)
                }
            } else {
                false
            };
            if !object_ok {
                return false;
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
        // Java: sa.setTriggeringObjectsFrom(runParams, AbilityKey.Source, AbilityKey.Object, AbilityKey.CounterMap)
        // Java also sets Amount = sum of CounterMap values
        if let Some(source) = params.source_player {
            sa.set_triggering_object(crate::ability::AbilityKey::Source, source.0.to_string());
        } else if let Some(source) = params.source_card {
            sa.set_triggering_object(crate::ability::AbilityKey::Source, source.0.to_string());
        }
        if let Some(obj) = params.object_card {
            sa.set_triggering_object(crate::ability::AbilityKey::Object, obj.0.to_string());
        } else if let Some(p) = params.object_player {
            sa.set_triggering_object(crate::ability::AbilityKey::Object, p.0.to_string());
        }
        // TODO: Java also sets CounterMap from runParams and computes Amount as sum of CounterMap values.
        // CounterMap is a Map<CounterType, Integer> in Java. Using counter_amount as approximation.
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
            "AddedOnce: {}: {}",
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::Source)
                .cloned()
                .unwrap_or_default(),
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::Object)
                .cloned()
                .unwrap_or_default()
        )
    }
}
