use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerPlaneswalkedTo {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
}

impl TriggerPlaneswalkedTo {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned_any(&[keys::VALID_CARDS, keys::VALID_CARD]),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerPlaneswalkedTo {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::Planeswalk
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        let _host_card = trigger.base.card_trait_base.host_card_id();
        let _host_controller = trigger.base.card_trait_base.host_controller(game);
        let Some(cards) = params.cards.as_ref() else {
            return self.valid_card.is_none();
        };

        cards.iter().any(|&cid| {
            trigger.matches_optional_valid_card_filter(&self.valid_card, Some(cid), game)
        })
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        if let Some(cards) = params.cards.as_ref() {
            let csv = cards
                .iter()
                .map(|c| c.0.to_string())
                .collect::<Vec<_>>()
                .join(",");
            sa.set_triggering_object(crate::ability::AbilityKey::Cards, &csv);
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "PlaneswalkedTo: {}",
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::Cards)
                .map(|s| s.as_str())
                .unwrap_or("")
        )
    }
}
