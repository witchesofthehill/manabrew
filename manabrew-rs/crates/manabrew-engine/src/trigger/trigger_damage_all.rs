use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerDamageAll {
    pub valid_source: Option<crate::parsing::CompiledSelector>,
    pub valid_target: Option<crate::parsing::CompiledSelector>,
}

impl TriggerDamageAll {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_source: params.selector_cloned(keys::VALID_SOURCE),
            valid_target: params.selector_cloned(keys::VALID_TARGET),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerDamageAll {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::DamageAll
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        trigger.matches_optional_valid_card_filter(&self.valid_source, params.damage_source, game)
            && trigger.matches_damage_target_filter(&self.valid_target, params, game, false)
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        // Java: sets DamageAmount (total), Sources (set of source cards), Targets (set of target entities)
        // from filtered CardDamageMap. We approximate with single source/target from params.
        // TODO: Java filters the damage map by ValidSource/ValidTarget and computes totals.
        if let Some(amount) = params.damage_amount {
            sa.set_triggering_object(crate::ability::AbilityKey::DamageAmount, amount.to_string());
        }
        if let Some(src) = params.damage_source {
            sa.set_triggering_object(crate::ability::AbilityKey::Sources, src.0.to_string());
        }
        if let Some(card) = params.damage_target_card {
            sa.set_triggering_object(crate::ability::AbilityKey::Targets, card.0.to_string());
        } else if let Some(player) = params.damage_target_player {
            sa.set_triggering_object(crate::ability::AbilityKey::Targets, player.0.to_string());
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        // Java: "Damage Source: " + Sources + ", Damaged: " + Targets + ", Amount: " + DamageAmount
        format!(
            "Damage Source: {}, Damaged: {}, Amount: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Sources)
                .unwrap_or(""),
            sa.get_triggering_object(crate::ability::AbilityKey::Targets)
                .unwrap_or(""),
            sa.get_triggering_object(crate::ability::AbilityKey::DamageAmount)
                .unwrap_or("")
        )
    }
}
