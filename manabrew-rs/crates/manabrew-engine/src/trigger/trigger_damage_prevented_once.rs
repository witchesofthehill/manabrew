use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerDamagePreventedOnce {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
}

impl TriggerDamagePreventedOnce {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerDamagePreventedOnce {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::DamagePreventedOnce
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        let _host_card = trigger.base.card_trait_base.host_card_id();
        let _host_controller = trigger.base.card_trait_base.host_controller(game);
        trigger.matches_optional_valid_card_filter(&self.valid_card, params.card, game)
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        if let Some(card) = params.damage_target_card {
            sa.set_triggering_object(crate::ability::AbilityKey::Target, card.0.to_string());
        } else if let Some(player) = params.damage_target_player {
            sa.set_triggering_object(crate::ability::AbilityKey::Target, player.0.to_string());
        }
        if let Some(amount) = params.damage_amount {
            sa.set_triggering_object(crate::ability::AbilityKey::DamageAmount, amount.to_string());
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        // Java: "Damage Target: " + Target + ", Amount: " + DamageAmount
        format!(
            "Damage Target: {}, Amount: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Target)
                .unwrap_or(""),
            sa.get_triggering_object(crate::ability::AbilityKey::DamageAmount)
                .unwrap_or("")
        )
    }
}
