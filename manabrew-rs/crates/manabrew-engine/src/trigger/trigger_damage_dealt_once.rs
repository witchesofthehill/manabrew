use serde::{Deserialize, Serialize};

use crate::card::card_damage_map::DamageTarget;
use crate::event::RunParams;
use crate::game::GameState;
use crate::ids::CardId;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerDamageDealtOnce {
    pub valid_source: Option<crate::parsing::CompiledSelector>,
    pub valid_target: Option<crate::parsing::CompiledSelector>,
    pub combat_damage_only: bool,
}

impl TriggerDamageDealtOnce {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_source: params.selector_cloned(keys::VALID_SOURCE),
            valid_target: params.selector_cloned(keys::VALID_TARGET),
            combat_damage_only: params.is_true(keys::COMBAT_DAMAGE),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerDamageDealtOnce {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::DamageDealtOnce
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
        if let Some(src) = params.damage_source {
            sa.set_triggering_object(crate::ability::AbilityKey::Source, src.0.to_string());
        }
        if let Some(amount) = params.damage_amount {
            sa.set_triggering_object(crate::ability::AbilityKey::DamageAmount, amount.to_string());
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
        // Java: "Damage Source: " + Source + ", Damaged: " + Targets + ", Amount: " + DamageAmount
        format!(
            "Damage Source: {}, Damaged: {}, Amount: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Source)
                .unwrap_or(""),
            sa.get_triggering_object(crate::ability::AbilityKey::Targets)
                .unwrap_or(""),
            sa.get_triggering_object(crate::ability::AbilityKey::DamageAmount)
                .unwrap_or("")
        )
    }
}

/// Returns the total damage amount from the damage map.
/// Java: TriggerDamageDealtOnce.getDamageAmount
///
/// Note: The Java version filters entries by ValidTarget param; this standalone
/// function passes all entries through. Filtering will be added when trigger
/// param context is available.
pub fn get_damage_amount(params: &RunParams) -> i32 {
    match params.damage_map.as_ref() {
        Some(map) => map.total_amount(),
        None => 0,
    }
}

/// Returns the damage target card IDs from the damage map.
/// Java: TriggerDamageDealtOnce.getDamageTargets
///
/// Note: The Java version filters entries by ValidTarget param; this standalone
/// function returns all target card IDs. Filtering will be added when trigger
/// param context is available.
pub fn get_damage_targets(params: &RunParams) -> Vec<CardId> {
    match params.damage_map.as_ref() {
        Some(map) => {
            let mut targets = Vec::new();
            for (_, target, _) in map.entries() {
                if let DamageTarget::Card(cid) = target {
                    if !targets.contains(&cid) {
                        targets.push(cid);
                    }
                }
            }
            targets
        }
        None => Vec::new(),
    }
}
