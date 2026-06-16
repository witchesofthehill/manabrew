use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::{Trigger, TriggerBehavior};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerExplores {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub valid_explored: Option<crate::parsing::CompiledSelector>,
}

impl TriggerExplores {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
            valid_explored: params.selector_cloned("ValidExplored"),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerExplores {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::Explored
    }

    fn perform_test(&self, trigger: &Trigger, params: &RunParams, game: &GameState) -> bool {
        trigger.matches_optional_valid_card_filter(&self.valid_card, params.card, game)
            && trigger.matches_optional_valid_card_filter(
                &self.valid_explored,
                params.explored,
                game,
            )
    }

    fn set_triggering_objects(
        &self,
        _trigger: &Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        // Java: sa.setTriggeringObject(AbilityKey.Explorer, runParams.get(AbilityKey.Card));
        //       if (runParams.containsKey(AbilityKey.Explored)) sa.setTriggeringObjectsFrom(runParams, AbilityKey.Explored);
        if let Some(card_id) = params.card {
            sa.set_triggering_object(crate::ability::AbilityKey::Explorer, card_id.0.to_string());
        }
        if let Some(explored) = params.explored {
            sa.set_triggering_object(crate::ability::AbilityKey::Explored, explored.0.to_string());
        }
    }

    fn get_important_stack_objects(&self, _trigger: &Trigger, sa: &SpellAbility) -> String {
        // Java: "Explorer: " + Explorer + optional ", Explored: " + Explored
        let mut sb = format!(
            "Explorer: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Explorer)
                .unwrap_or_default()
        );
        if let Some(explored) = sa.get_triggering_object(crate::ability::AbilityKey::Explored) {
            sb.push_str(&format!(", Explored: {}", explored));
        }
        sb
    }
}
