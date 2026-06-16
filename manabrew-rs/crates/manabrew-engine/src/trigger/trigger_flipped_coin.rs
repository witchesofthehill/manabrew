use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::{Trigger, TriggerBehavior};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerFlippedCoin {
    pub valid_player: Option<crate::parsing::CompiledSelector>,
    pub valid_result: Option<String>,
}

impl TriggerFlippedCoin {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_player: params.selector_cloned(keys::VALID_PLAYER),
            valid_result: params.get_cloned(keys::VALID_RESULT),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerFlippedCoin {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::FlippedCoin
    }

    fn perform_test(&self, trigger: &Trigger, params: &RunParams, game: &GameState) -> bool {
        let _host_controller = trigger.base.card_trait_base.host_controller(game);
        if !trigger.matches_optional_valid_player_filter(&self.valid_player, params.player, game) {
            return false;
        }
        if let Some(filter) = self.valid_result.as_ref() {
            let Some(won) = params.coin_flip_won else {
                return false;
            };
            let f = filter.trim();
            if (f.eq_ignore_ascii_case("Win") || f.eq_ignore_ascii_case("Heads")) && !won {
                return false;
            }
            if (f.eq_ignore_ascii_case("Lose") || f.eq_ignore_ascii_case("Tails")) && won {
                return false;
            }
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
