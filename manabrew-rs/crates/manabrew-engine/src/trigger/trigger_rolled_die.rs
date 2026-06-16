use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::compare::compare_expr;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerRolledDie {
    pub valid_player: Option<crate::parsing::CompiledSelector>,
    pub valid_result: Option<String>,
    pub valid_sides: Option<String>,
    pub number: Option<i32>,
    pub natural: bool,
    pub rolled_to_visit_attractions: bool,
}

impl TriggerRolledDie {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_player: params.selector_cloned(keys::VALID_PLAYER),
            valid_result: params.get_cloned(keys::VALID_RESULT),
            valid_sides: params.get_cloned(keys::VALID_SIDES),
            number: params.get("Number").and_then(|n| n.parse::<i32>().ok()),
            natural: params.is_true("Natural"),
            rolled_to_visit_attractions: params.has("RolledToVisitAttractions"),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerRolledDie {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::RolledDie
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
            let result = if self.natural {
                params.natural_result
            } else {
                params.die_result
            };
            let Some(result) = result else {
                return false;
            };
            if !matches_die_filter(filter, result, params.die_sides) {
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
        if let Some(expected_number) = self.number {
            if params.number != Some(expected_number) {
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

fn matches_die_filter(filter: &str, result: i32, sides: Option<i32>) -> bool {
    for entry in filter
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
    {
        if entry.eq_ignore_ascii_case("Highest") {
            if sides == Some(result) {
                return true;
            }
            continue;
        }
        if let Ok(value) = entry.parse::<i32>() {
            if value == result {
                return true;
            }
            continue;
        }
        if entry.len() >= 3 && compare_expr(result.max(0), entry) {
            return true;
        }
    }
    false
}
