use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerDamageDone {
    pub valid_source: Option<crate::parsing::CompiledSelector>,
    pub valid_target: Option<crate::parsing::CompiledSelector>,
    pub combat_damage_only: bool,
}

impl TriggerDamageDone {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_source: params.selector_cloned(keys::VALID_SOURCE),
            valid_target: params.selector_cloned(keys::VALID_TARGET),
            combat_damage_only: params.is_true(keys::COMBAT_DAMAGE),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerDamageDone {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::DamageDone
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        if self.combat_damage_only && params.is_combat_damage != Some(true) {
            return false;
        }
        trigger.matches_optional_valid_card_filter(&self.valid_source, params.damage_source, game)
            && trigger.matches_damage_target_filter(&self.valid_target, params, game, true)
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        // Java: sa.setTriggeringObject(AbilityKey.Source, CardCopyService.getLKICopy(DamageSource))
        // TODO: Java uses CardCopyService.getLKICopy for the source. We just use the ID directly.
        if let Some(src) = params.damage_source {
            sa.set_triggering_object(crate::ability::AbilityKey::Source, src);
        }
        if let Some(card) = params.damage_target_card {
            sa.set_triggering_object(crate::ability::AbilityKey::Target, card);
            sa.set_triggering_object(crate::ability::AbilityKey::TargetCard, card);
        } else if let Some(player) = params.damage_target_player {
            sa.set_triggering_object(crate::ability::AbilityKey::Target, player);
            sa.set_triggering_object(crate::ability::AbilityKey::TargetPlayer, player);
        }
        // TODO: Java also sets Cause (SpellAbility) from runParams.
        // Skipping Cause for now since SpellAbility is complex and stored as object in Java.
        if let Some(amount) = params.damage_amount {
            sa.set_triggering_object(crate::ability::AbilityKey::DamageAmount, amount.to_string());
        }
        if let Some(p) = params.defending_player {
            sa.set_triggering_object(crate::ability::AbilityKey::DefendingPlayer, p);
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        // Java: "Damage Source: " + Source + ", Damaged: " + Target + ", Amount: " + DamageAmount
        format!(
            "Damage Source: {}, Damaged: {}, Amount: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Source)
                .unwrap_or(""),
            sa.get_triggering_object(crate::ability::AbilityKey::Target)
                .unwrap_or(""),
            sa.get_triggering_object(crate::ability::AbilityKey::DamageAmount)
                .unwrap_or("")
        )
    }
}
