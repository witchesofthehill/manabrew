use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerDestroyed {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub valid_causer: Option<crate::parsing::CompiledSelector>,
}

impl TriggerDestroyed {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
            valid_causer: params.selector_cloned("ValidCauser"),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerDestroyed {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::Destroyed
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        trigger.matches_optional_valid_card_filter(&self.valid_card, params.card, game)
            && trigger.matches_optional_valid_card_filter(
                &self.valid_causer,
                params
                    .causer
                    .or(params.cause_card)
                    .or_else(|| params.cause.as_ref().and_then(|sa| sa.source)),
                game,
            )
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        // Java: sa.setTriggeringObjectsFrom(runParams, AbilityKey.Card, AbilityKey.Causer)
        if let Some(card_id) = params.card {
            sa.set_triggering_object(crate::ability::AbilityKey::Card, card_id.0.to_string());
        }
        if let Some(causer) = params.causer {
            sa.set_triggering_object(crate::ability::AbilityKey::Causer, causer.0.to_string());
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        // Java: "Destroyed: " + Card + ", Destroyer: " + Causer
        format!(
            "Destroyed: {}, Destroyer: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Card)
                .unwrap_or(""),
            sa.get_triggering_object(crate::ability::AbilityKey::Causer)
                .unwrap_or("")
        )
    }
}
