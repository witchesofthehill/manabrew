use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerCountered {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub valid_cause: Option<crate::parsing::CompiledSelector>,
    pub valid_sa: Option<String>,
}

impl TriggerCountered {
    pub fn parse(
        valid_card: Option<crate::parsing::CompiledSelector>,
        valid_cause: Option<crate::parsing::CompiledSelector>,
        valid_sa: Option<String>,
    ) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card,
            valid_cause,
            valid_sa,
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerCountered {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::Countered
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
        if let Some(filter) = &self.valid_cause {
            if let Some(cause) = params.cause.as_ref() {
                let Some(cause_card) = cause.source else {
                    return false;
                };
                if !trigger.matches_valid_card_filter(filter, cause_card, game) {
                    return false;
                }
            } else {
                return false;
            }
        }
        if let Some(filter) = &self.valid_sa {
            if let Some(countered_sa) = params.spell_ability.as_ref() {
                if !trigger.matches_valid_sa_filter(filter, countered_sa) {
                    return false;
                }
            } else {
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
        // Java: sa.setTriggeringObjectsFrom(runParams, AbilityKey.Card, AbilityKey.Cause, AbilityKey.CounteredSA)
        if let Some(card) = params.card {
            sa.set_triggering_object(crate::ability::AbilityKey::Card, card.0.to_string());
        }
        // TODO: Java also sets Cause (SpellAbility) and CounteredSA (SpellAbility) from runParams.
        // Skipping Cause and CounteredSA for now since SpellAbility is complex and stored as object in Java.
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        // Java: "Countered: " + Card + ", Cause: " + Cause
        format!(
            "Countered: {}, Cause: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Card)
                .unwrap_or(""),
            sa.get_triggering_object(crate::ability::AbilityKey::Cause)
                .unwrap_or("")
        )
    }
}
