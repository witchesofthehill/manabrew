use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerCrewedSaddled {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub valid_crew: Option<crate::parsing::CompiledSelector>,
}

impl TriggerCrewedSaddled {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
            valid_crew: params.selector_cloned_any(&["ValidCrew", "ValidSaddled"]),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerCrewedSaddled {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::Crewed
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        let _host_card = trigger.base.card_trait_base.host_card_id();
        let _host_controller = trigger.base.card_trait_base.host_controller(game);
        if !trigger.matches_optional_valid_card_filter(&self.valid_card, params.card, game) {
            return false;
        }
        let Some(crews) = params.crew_cards.as_ref() else {
            return false;
        };
        crews.iter().any(|&cid| {
            trigger.matches_optional_valid_card_filter(&self.valid_crew, Some(cid), game)
        })
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        if let Some(card) = params.card {
            sa.set_triggering_object(crate::ability::AbilityKey::Card, card);
        }
        if let Some(crew) = params.crew_cards.as_ref() {
            sa.set_triggering_object(crate::ability::AbilityKey::Crew, crew.clone());
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        // Java uses two spaces between Card and Crew sections
        format!(
            "Card: {}  Crew: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Card)
                .unwrap_or(""),
            sa.get_triggering_object(crate::ability::AbilityKey::Crew)
                .unwrap_or("")
        )
    }
}
