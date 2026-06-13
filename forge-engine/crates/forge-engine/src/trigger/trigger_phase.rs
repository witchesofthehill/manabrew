use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerPhase {
    pub phases: Vec<forge_foundation::PhaseType>,
    pub valid_player: Option<crate::parsing::CompiledSelector>,
}

impl TriggerPhase {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        let phases = params
            .get(keys::PHASE)
            .map(forge_foundation::PhaseType::parse_range)
            .unwrap_or_default();
        let valid_player = params.selector_cloned(keys::VALID_PLAYER);
        Box::new(Self {
            phases,
            valid_player,
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerPhase {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::Phase
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        let _host_controller = trigger.base.card_trait_base.host_controller(game);
        if !self.phases.is_empty() {
            let matches = params
                .phase
                .is_some_and(|phase| self.phases.contains(&phase));
            if !matches {
                return false;
            }
        }
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
            sa.set_triggering_object(crate::ability::AbilityKey::TriggeredPlayer, p);
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "Phase: {}",
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::Player)
                .map(|s| s.as_str())
                .unwrap_or("")
        )
    }
}
