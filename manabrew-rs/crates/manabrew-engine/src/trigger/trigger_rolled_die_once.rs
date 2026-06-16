use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::compare::compare_expr;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerRolledDieOnce {
    pub valid_player: Option<crate::parsing::CompiledSelector>,
    pub valid_result: Option<String>,
    pub valid_sides: Option<String>,
    pub rolled_to_visit_attractions: bool,
}

impl TriggerRolledDieOnce {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_player: params.selector_cloned(keys::VALID_PLAYER),
            valid_result: params.get_cloned(keys::VALID_RESULT),
            valid_sides: params.get_cloned(keys::VALID_SIDES),
            rolled_to_visit_attractions: params.has("RolledToVisitAttractions"),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerRolledDieOnce {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::RolledDieOnce
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
        if self.rolled_to_visit_attractions && params.rolled_to_visit_attractions != Some(true) {
            return false;
        }
        if let Some(filter) = self.valid_result.as_ref() {
            let Some(result) = params.die_result else {
                return false;
            };
            if !compare_expr(result, filter) {
                return false;
            }
        }
        if let Some(filter) = self.valid_sides.as_ref() {
            let Some(sides) = params.die_sides else {
                return false;
            };
            if !compare_expr(sides, filter) {
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
        if let Some(result) = params.die_result {
            sa.set_triggering_object(crate::ability::AbilityKey::Result, result.to_string());
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
            "Player: {}, Result: {}",
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::Player)
                .map(|s| s.as_str())
                .unwrap_or(""),
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::Result)
                .map(|s| s.as_str())
                .unwrap_or("")
        )
    }
}
