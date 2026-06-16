use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::{Trigger, TriggerBehavior};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerFightOnce {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
}

impl TriggerFightOnce {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerFightOnce {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::FightOnce
    }

    fn perform_test(&self, trigger: &Trigger, params: &RunParams, game: &GameState) -> bool {
        let _host_card = trigger.base.card_trait_base.host_card_id();
        let _host_controller = trigger.base.card_trait_base.host_controller(game);
        trigger.matches_optional_valid_card_filter(&self.valid_card, params.card, game)
            || trigger.matches_optional_valid_card_filter(&self.valid_card, params.card2, game)
    }

    fn set_triggering_objects(
        &self,
        _trigger: &Trigger,
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
            sa.set_triggering_object(crate::ability::AbilityKey::Fighters, &csv);
        }
    }

    fn get_important_stack_objects(&self, _trigger: &Trigger, sa: &SpellAbility) -> String {
        // Java: "Fighter 1: " + fighters.get(0) + ", Fighter 2: " + fighters.get(1)
        let fighters_csv = sa
            .get_triggering_object(crate::ability::AbilityKey::Fighters)
            .unwrap_or_default();
        let parts: Vec<&str> = fighters_csv.split(',').collect();
        let f1 = parts.first().copied().unwrap_or("");
        let f2 = parts.get(1).copied().unwrap_or("");
        format!("Fighter 1: {}, Fighter 2: {}", f1, f2)
    }
}
