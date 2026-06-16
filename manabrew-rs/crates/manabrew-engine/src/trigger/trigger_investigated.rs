use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::{Trigger, TriggerBehavior};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerInvestigated {
    pub valid_player: Option<crate::parsing::CompiledSelector>,
    pub first_time_only: bool,
}

impl TriggerInvestigated {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_player: params.selector_cloned(keys::VALID_PLAYER),
            first_time_only: params.has("FirstTime"),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerInvestigated {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::Investigated
    }

    fn perform_test(&self, trigger: &Trigger, params: &RunParams, game: &GameState) -> bool {
        let _host_controller = trigger.base.card_trait_base.host_controller(game);
        if !trigger.matches_optional_valid_player_filter(&self.valid_player, params.player, game) {
            return false;
        }
        if self.first_time_only && params.first_time != Some(true) {
            return false;
        }
        true
    }

    fn set_triggering_objects(
        &self,
        _trigger: &Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        if let Some(p) = params.player {
            sa.set_triggering_object(crate::ability::AbilityKey::Player, p.0.to_string());
        }
    }

    fn get_important_stack_objects(&self, _trigger: &Trigger, sa: &SpellAbility) -> String {
        format!(
            "Player: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Player)
                .unwrap_or_default()
        )
    }
}
