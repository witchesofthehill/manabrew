use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerClashed {
    pub valid_player: Option<crate::parsing::CompiledSelector>,
    pub won: Option<bool>,
}

impl TriggerClashed {
    pub fn parse(
        valid_player: Option<crate::parsing::CompiledSelector>,
        won: Option<bool>,
    ) -> Box<dyn TriggerBehavior> {
        Box::new(Self { valid_player, won })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerClashed {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::Clashed
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        let _host_controller = trigger.base.card_trait_base.host_controller(game);
        if !trigger.matches_optional_valid_player_filter(&self.valid_player, params.player, game) {
            return false;
        }
        if let Some(expected) = self.won {
            return params.clash_won == Some(expected);
        }
        true
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        _sa: &mut SpellAbility,
        _params: &RunParams,
        _game: &GameState,
    ) {
        // Clash has no triggered variables
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        _sa: &SpellAbility,
    ) -> String {
        String::new()
    }
}
