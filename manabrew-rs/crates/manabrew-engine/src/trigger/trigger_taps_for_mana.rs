use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::{Trigger, TriggerBehavior};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerTapsForMana {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub activator: Option<crate::parsing::CompiledSelector>,
    pub produced: Option<String>,
}

impl TriggerTapsForMana {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
            activator: params
                .selector_cloned(keys::ACTIVATOR)
                .or_else(|| params.selector_cloned(keys::VALID_ACTIVATOR)),
            produced: params.get_cloned(keys::PRODUCED),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerTapsForMana {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::TapsForMana
    }

    fn perform_test(&self, trigger: &Trigger, params: &RunParams, game: &GameState) -> bool {
        if !trigger.matches_optional_valid_card_filter(&self.valid_card, params.card, game) {
            return false;
        }
        if let Some(filter) = self.activator.as_ref() {
            let Some(player) = params.activator.or(params.player) else {
                return false;
            };
            if !trigger.matches_valid_player_filter(filter, player, game) {
                return false;
            }
        }
        if let Some(expected) = self.produced.as_ref() {
            let Some(actual) = params.produced.as_ref() else {
                return false;
            };
            if !actual.contains(expected) {
                return false;
            }
        }
        true
    }

    fn set_triggering_objects(
        &self,
        _trigger: &Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        if let Some(card) = params.card {
            sa.set_triggering_object(crate::ability::AbilityKey::Card, card.0.to_string());
        }
        if let Some(produced) = params.produced.as_ref() {
            sa.set_triggering_object(crate::ability::AbilityKey::Produced, produced);
        }
        if let Some(p) = params.activator {
            sa.set_triggering_object(crate::ability::AbilityKey::Activator, p.0.to_string());
        }
    }

    fn get_important_stack_objects(&self, _trigger: &Trigger, sa: &SpellAbility) -> String {
        format!(
            "TappedForMana: {} Produced: {}",
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::Card)
                .map(|s| s.as_str())
                .unwrap_or(""),
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::Produced)
                .map(|s| s.as_str())
                .unwrap_or("")
        )
    }
}
