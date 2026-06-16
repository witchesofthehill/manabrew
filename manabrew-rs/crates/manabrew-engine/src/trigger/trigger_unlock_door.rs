use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::{Trigger, TriggerBehavior};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerUnlockDoor {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub valid_player: Option<crate::parsing::CompiledSelector>,
    pub this_door: bool,
}

impl TriggerUnlockDoor {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
            valid_player: params.selector_cloned(keys::VALID_PLAYER),
            this_door: params.is_true("ThisDoor"),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerUnlockDoor {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::UnlockDoor
    }

    fn perform_test(&self, trigger: &Trigger, params: &RunParams, game: &GameState) -> bool {
        let host_card = trigger.base.card_trait_base.host_card_id();
        let _host_controller = trigger.base.card_trait_base.host_controller(game);
        if !trigger.matches_optional_valid_card_filter(&self.valid_card, params.card, game) {
            return false;
        }
        if !trigger.matches_optional_valid_player_filter(&self.valid_player, params.player, game) {
            return false;
        }
        if self.this_door && params.card != Some(host_card) {
            return false;
        }
        if self.this_door {
            if let Some(trigger_state) = trigger.base.card_trait_base.get_card_state_name() {
                let Some(run_state) = params
                    .card_state_name
                    .as_deref()
                    .and_then(forge_foundation::CardStateName::from_str_compat)
                else {
                    return false;
                };
                if run_state != trigger_state {
                    return false;
                }
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
        if let Some(card) = params.card {
            sa.set_triggering_object(crate::ability::AbilityKey::Card, card.0.to_string());
        }
        if let Some(p) = params.player {
            sa.set_triggering_object(crate::ability::AbilityKey::Player, p.0.to_string());
        }
    }

    fn get_important_stack_objects(&self, _trigger: &Trigger, sa: &SpellAbility) -> String {
        format!(
            "Player: {}, Card: {}",
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::Player)
                .map(|s| s.as_str())
                .unwrap_or(""),
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::Card)
                .map(|s| s.as_str())
                .unwrap_or("")
        )
    }
}
