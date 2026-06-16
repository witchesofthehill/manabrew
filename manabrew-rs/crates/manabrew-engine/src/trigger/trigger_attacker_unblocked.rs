use serde::{Deserialize, Serialize};

use crate::{
    event::RunParams,
    game::GameState,
    parsing::{keys, Params},
    spellability::SpellAbility,
    trigger::TriggerType,
};

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerAttackerUnblocked {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
}

impl TriggerAttackerUnblocked {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerAttackerUnblocked {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::AttackerUnblocked
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        trigger.matches_optional_valid_card_filter(&self.valid_card, params.attacker, game)
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        if let Some(attacker) = params.attacker {
            sa.set_triggering_object(crate::ability::AbilityKey::Attacker, attacker.0.to_string());
        }
        if let Some(c) = params.attacked_card {
            sa.set_triggering_object(crate::ability::AbilityKey::Defender, c.0.to_string());
        } else if let Some(p) = params.attacked_player {
            sa.set_triggering_object(crate::ability::AbilityKey::Defender, p.0.to_string());
        }
        if let Some(p) = params.defending_player {
            sa.set_triggering_object(crate::ability::AbilityKey::DefendingPlayer, p.0.to_string());
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "Attacker: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Attacker)
                .unwrap_or("")
        )
    }
}
