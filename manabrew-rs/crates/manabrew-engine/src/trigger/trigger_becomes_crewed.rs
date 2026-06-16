use serde::{Deserialize, Serialize};

use super::trigger::TriggerBehavior;
use crate::{
    event::RunParams, game::GameState, parsing::compare::compare_expr, parsing::Params,
    spellability::SpellAbility, trigger::TriggerType,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerBecomesCrewed {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub valid_crew: Option<crate::parsing::CompiledSelector>,
    pub first_time_crewed: bool,
    pub valid_crew_amount: Option<String>,
}

impl TriggerBecomesCrewed {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned("ValidCard"),
            valid_crew: params.selector_cloned("ValidCrew"),
            first_time_crewed: params.has("FirstTimeCrewed"),
            valid_crew_amount: params.get_cloned("ValidCrewAmount"),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerBecomesCrewed {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::BecomesCrewed
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
        if !crews.iter().any(|&cid| {
            trigger.matches_optional_valid_card_filter(&self.valid_crew, Some(cid), game)
        }) {
            return false;
        }
        if self.first_time_crewed && params.first_time != Some(true) {
            return false;
        }
        if let Some(amount_filter) = &self.valid_crew_amount {
            if !compare_expr(crews.len() as i32, amount_filter) {
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
        if let Some(card) = params.card {
            sa.set_triggering_object(crate::ability::AbilityKey::Card, card.0.to_string());
        }
        if let Some(crew) = params.crew_cards.as_ref() {
            let csv = crew
                .iter()
                .map(|c| c.0.to_string())
                .collect::<Vec<_>>()
                .join(",");
            sa.set_triggering_object(crate::ability::AbilityKey::Crew, &csv);
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "Vehicle: {}  Crew: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Card)
                .unwrap_or(""),
            sa.get_triggering_object(crate::ability::AbilityKey::Crew)
                .unwrap_or("")
        )
    }
}
