use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerDrawn {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub valid_player: Option<crate::parsing::CompiledSelector>,
    pub number: Option<i32>,
}

impl TriggerDrawn {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
            valid_player: params.selector_cloned(keys::VALID_PLAYER),
            number: params.as_i32(keys::NUMBER),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerDrawn {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::Drawn
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        let _host_card = trigger.base.card_trait_base.host_card_id();
        let host_controller = trigger.base.card_trait_base.host_controller(game);
        if let Some(n) = self.number {
            let drawn_count = params.drawn_this_turn_snapshot.unwrap_or_else(|| {
                let player = params.player.unwrap_or(host_controller);
                game.player(player).drawn_this_turn
            });
            if drawn_count != n {
                return false;
            }
        }
        trigger.matches_optional_valid_card_filter(&self.valid_card, params.card, game)
            && trigger.matches_optional_valid_player_filter(&self.valid_player, params.player, game)
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
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

    fn drawn_number(&self) -> Option<i32> {
        self.number
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "Player: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Player)
                .unwrap_or_default()
        )
    }
}
