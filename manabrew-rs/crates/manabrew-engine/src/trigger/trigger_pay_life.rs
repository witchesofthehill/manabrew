use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerPayLife {
    pub valid_player: Option<crate::parsing::CompiledSelector>,
}

impl TriggerPayLife {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_player: params.selector_cloned(keys::VALID_PLAYER),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerPayLife {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::PayLife
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
        if let Some(amount) = params.life_amount {
            sa.set_triggering_object(crate::ability::AbilityKey::LifeAmount, amount.to_string());
        }
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
            "Player: {}, PaidAmount: {}",
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::Player)
                .map(|s| s.as_str())
                .unwrap_or(""),
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::LifeAmount)
                .map(|s| s.as_str())
                .unwrap_or("")
        )
    }
}
