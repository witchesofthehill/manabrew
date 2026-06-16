use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerDamageDoneOnceByController {
    pub valid_source: Option<crate::parsing::CompiledSelector>,
    pub valid_target: Option<crate::parsing::CompiledSelector>,
    pub combat_damage_only: bool,
}

impl TriggerDamageDoneOnceByController {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_source: params.selector_cloned(keys::VALID_SOURCE),
            valid_target: params.selector_cloned(keys::VALID_TARGET),
            combat_damage_only: params.is_true(keys::COMBAT_DAMAGE),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerDamageDoneOnceByController {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::DamageDoneOnceByController
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
        if !trigger.matches_damage_target_filter(&self.valid_target, params, game, true) {
            return false;
        }
        trigger.matches_optional_valid_card_filter(&self.valid_source, params.damage_source, game)
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
        if let Some(src) = params.damage_source {
            sa.set_triggering_object(crate::ability::AbilityKey::Source, src.0.to_string());
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        // Java: if Target != null { "Damaged: " + Target + ", " } + "Damage Source: " + Source
        let target = sa
            .get_triggering_object(crate::ability::AbilityKey::Target)
            .unwrap_or("");
        if target.is_empty() {
            format!(
                "Damage Source: {}",
                sa.get_triggering_object(crate::ability::AbilityKey::Source)
                    .unwrap_or("")
            )
        } else {
            format!(
                "Damaged: {}, Damage Source: {}",
                target,
                sa.get_triggering_object(crate::ability::AbilityKey::Source)
                    .unwrap_or("")
            )
        }
    }
}
