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
pub struct TriggerAttackerBlockedByCreature {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub valid_blocked: Option<crate::parsing::CompiledSelector>,
}

impl TriggerAttackerBlockedByCreature {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
            valid_blocked: params.selector_cloned(keys::VALID_BLOCKED),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerAttackerBlockedByCreature {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::AttackerBlockedByCreature
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        trigger.matches_optional_valid_card_filter(&self.valid_card, params.blocker, game)
            && trigger.matches_optional_valid_card_filter(
                &self.valid_blocked,
                params.blocked_attacker,
                game,
            )
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
        if let Some(blocker) = params.blocker {
            sa.set_triggering_object(crate::ability::AbilityKey::Blocker, blocker.0.to_string());
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "Attacker: {}, Blocker: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Attacker)
                .unwrap_or(""),
            sa.get_triggering_object(crate::ability::AbilityKey::Blocker)
                .unwrap_or("")
        )
    }
}
