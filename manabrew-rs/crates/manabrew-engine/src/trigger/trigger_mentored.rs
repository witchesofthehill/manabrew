use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerMentored {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub valid_source: Option<crate::parsing::CompiledSelector>,
}

impl TriggerMentored {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
            valid_source: params.selector_cloned("ValidSource"),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerMentored {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::Mentored
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        trigger.matches_optional_valid_card_filter(&self.valid_card, params.card, game)
            && trigger.matches_optional_valid_card_filter(
                &self.valid_source,
                params.source_card.or(params.card2),
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
        if let Some(card) = params.card {
            sa.set_triggering_object(crate::ability::AbilityKey::Card, card.0.to_string());
        }
        if let Some(src) = params.source_card {
            sa.set_triggering_object(crate::ability::AbilityKey::Source, src.0.to_string());
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "Mentor: {}, Mentored: {}",
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::Source)
                .map(|s| s.as_str())
                .unwrap_or(""),
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::Card)
                .map(|s| s.as_str())
                .unwrap_or("")
        )
    }
}
