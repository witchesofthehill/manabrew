use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerCounterAddedOnce {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub valid_player: Option<crate::parsing::CompiledSelector>,
    pub valid_entity: Option<crate::parsing::CompiledSelector>,
    pub counter_type: Option<String>,
    pub valid_source: Option<crate::parsing::CompiledSelector>,
    pub first_time_only: bool,
}

impl TriggerCounterAddedOnce {
    pub fn parse(
        valid_card: Option<crate::parsing::CompiledSelector>,
        valid_player: Option<crate::parsing::CompiledSelector>,
        valid_entity: Option<crate::parsing::CompiledSelector>,
        counter_type: Option<String>,
        valid_source: Option<crate::parsing::CompiledSelector>,
        first_time_only: bool,
    ) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card,
            valid_player,
            valid_entity,
            counter_type,
            valid_source,
            first_time_only,
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
        if let Some(filter) = &self.valid_entity {
            let matches = params
                .card
                .is_some_and(|card| trigger.matches_valid_card_filter(filter, card, game))
                || params.player.is_some_and(|player| {
                    trigger.matches_valid_player_filter(filter, player, game)
                });
            if !matches {
                return false;
            }
        }
        if !super::trigger::Trigger::matches_counter_type_filter(
            &self.counter_type,
            &params.counter_type,
        ) {
            return false;
        }
        if let Some(filter) = &self.valid_source {
            let Some(source) = params.source_player else {
                return false;
            };
            if !trigger.matches_valid_player_filter(filter, source, game) {
                return false;
            }
        }
        !self.first_time_only || params.first_time == Some(true)
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
