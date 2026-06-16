use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerClaimPrize {
    pub valid_player: Option<crate::parsing::CompiledSelector>,
    pub valid_card: Option<crate::parsing::CompiledSelector>,
}

impl TriggerClaimPrize {
    pub fn parse(
        valid_player: Option<crate::parsing::CompiledSelector>,
        valid_card: Option<crate::parsing::CompiledSelector>,
    ) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_player,
            valid_card,
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerClaimPrize {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::ClaimPrize
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        let _host_card = trigger.base.card_trait_base.host_card_id();
        let _host_controller = trigger.base.card_trait_base.host_controller(game);
        trigger.matches_optional_valid_player_filter(&self.valid_player, params.player, game)
            && trigger.matches_optional_valid_card_filter(&self.valid_card, params.card, game)
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
        if let Some(card) = params.card {
            sa.set_triggering_object(crate::ability::AbilityKey::Card, card.0.to_string());
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "Player: {}",
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::Player)
                .cloned()
                .unwrap_or_default()
        )
    }
}
