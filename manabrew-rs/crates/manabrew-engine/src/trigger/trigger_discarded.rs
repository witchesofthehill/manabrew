use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerDiscarded {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub valid_player: Option<crate::parsing::CompiledSelector>,
    pub valid_cause: Option<crate::parsing::CompiledSelector>,
}

impl TriggerDiscarded {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
            valid_player: params.selector_cloned(keys::VALID_PLAYER),
            valid_cause: params.selector_cloned(keys::VALID_CAUSE),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerDiscarded {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::Discarded
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
        if !trigger.matches_optional_valid_player_filter(&self.valid_player, params.player, game) {
            return false;
        }
        if let Some(filter) = self.valid_cause.as_ref() {
            let Some(cause_sa) = params.cause.as_ref() else {
                return false;
            };
            let Some(cause_card) = cause_sa.source else {
                return false;
            };
            if !trigger.matches_valid_card_filter(filter, cause_card, game) {
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
        // Java: sa.setTriggeringObjectsFrom(runParams, AbilityKey.Card, AbilityKey.Cause);
        if let Some(card) = params.card {
            sa.set_triggering_object(crate::ability::AbilityKey::Card, card.0.to_string());
        }
        // TODO: AbilityKey.Cause is a SpellAbility in Java, cannot be stored as String easily
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        // Java: "Discarded: " + Card + ", Cause: " + Cause
        format!(
            "Discarded: {}, Cause: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Card)
                .unwrap_or_default(),
            sa.get_triggering_object(crate::ability::AbilityKey::Cause)
                .unwrap_or_default()
        )
    }
}
