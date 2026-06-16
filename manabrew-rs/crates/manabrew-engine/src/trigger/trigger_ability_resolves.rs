use serde::{Deserialize, Serialize};

use super::trigger::TriggerBehavior;
use crate::{
    event::RunParams, game::GameState, parsing::Params, spellability::SpellAbility,
    trigger::TriggerType,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerAbilityResolves {
    pub valid_spell_ability: Option<String>,
    pub valid_source: Option<crate::parsing::CompiledSelector>,
}

impl TriggerAbilityResolves {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_spell_ability: params.get_cloned("ValidSpellAbility"),
            valid_source: params.selector_cloned("ValidSource"),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerAbilityResolves {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::AbilityResolves
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        let Some(sa) = params.spell_ability.as_ref() else {
            return false;
        };
        if let Some(filter) = &self.valid_spell_ability {
            if !trigger.matches_valid_sa_filter(filter, sa) {
                return false;
            }
        }
        trigger.matches_optional_valid_card_filter(&self.valid_source, params.card, game)
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        if let Some(card) = params.card {
            sa.set_triggering_object(crate::ability::AbilityKey::Source, card.0.to_string());
        }
        // SpellAbility is a complex object, skip for now
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "SpellAbility: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::SpellAbility)
                .unwrap_or("")
        )
    }
}
