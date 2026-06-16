use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerEnteredRoom {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub valid_room: Option<String>,
}

impl TriggerEnteredRoom {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
            valid_room: params.get_cloned("ValidRoom"),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerEnteredRoom {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::EnteredRoom
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        let _host_card = trigger.base.card_trait_base.host_card_id();
        let _host_controller = trigger.base.card_trait_base.host_controller(game);
        if !trigger.matches_optional_valid_card_filter(&self.valid_card, params.card, game) {
            return false;
        }
        if let Some(filter) = self.valid_room.as_ref() {
            let Some(room) = params.room_name.as_ref() else {
                return false;
            };
            return filter
                .split(',')
                .map(|s| s.trim())
                .any(|t| t.eq_ignore_ascii_case(room));
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
        if let Some(name) = params.room_name.as_ref() {
            sa.set_triggering_object(crate::ability::AbilityKey::RoomName, name);
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        sa.get_triggering_object(crate::ability::AbilityKey::RoomName)
            .map(|r| format!("Room: {}", r))
            .unwrap_or_default()
    }
}
