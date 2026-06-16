use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerAbilityActivated {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub valid_activating_player: Option<crate::parsing::CompiledSelector>,
}

impl TriggerAbilityActivated {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
            valid_activating_player: params.selector_cloned(keys::VALID_ACTIVATING_PLAYER),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerAbilityActivated {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::AbilityActivated
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        let _host_card = trigger.base.card_trait_base.host_card_id();
        let _host_controller = trigger.base.card_trait_base.host_controller(game);
        trigger.matches_optional_valid_card_filter(&self.valid_card, params.card, game)
            && trigger.matches_optional_valid_player_filter(
                &self.valid_activating_player,
                params.player,
                game,
            )
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        _sa: &mut SpellAbility,
        _params: &RunParams,
        _game: &GameState,
    ) {
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        _sa: &SpellAbility,
    ) -> String {
        String::new()
    }
}
