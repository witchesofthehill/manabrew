use serde::{Deserialize, Serialize};

use crate::parsing::{keys, Params};
use crate::{event::RunParams, game::GameState, spellability::SpellAbility, trigger::TriggerType};

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerBecomeMonarch {
    pub valid_player: Option<crate::parsing::CompiledSelector>,
}

impl TriggerBecomeMonarch {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_player: params.selector_cloned(keys::VALID_PLAYER),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerBecomeMonarch {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::BecomeMonarch
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        let _host_controller = trigger.base.card_trait_base.host_controller(game);
        trigger.matches_optional_valid_player_filter(&self.valid_player, params.player, game)
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        if let Some(p) = params.player {
            sa.set_triggering_object(crate::ability::AbilityKey::Player, p.0.to_string());
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "Player: {}, ",
            sa.get_triggering_object(crate::ability::AbilityKey::Player)
                .unwrap_or("")
        )
    }
}
