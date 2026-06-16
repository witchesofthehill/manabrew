use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerEnlisted {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub valid_enlisted: Option<crate::parsing::CompiledSelector>,
}

impl TriggerEnlisted {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
            valid_enlisted: params.selector_cloned(keys::VALID_ENLISTED),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerEnlisted {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::Enlisted
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        trigger.matches_optional_valid_card_filter(&self.valid_card, params.card, game)
            && trigger.matches_optional_valid_card_filter(
                &self.valid_enlisted,
                params.enlisted,
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
        if let Some(enlisted) = params.enlisted {
            sa.set_triggering_object(crate::ability::AbilityKey::Enlisted, enlisted.0.to_string());
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "Enlisted: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Card)
                .unwrap_or_default()
        )
    }
}
