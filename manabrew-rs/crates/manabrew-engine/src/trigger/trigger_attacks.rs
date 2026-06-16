use serde::{Deserialize, Serialize};

use crate::parsing::{keys, Params};
use crate::{event::RunParams, game::GameState, spellability::SpellAbility, trigger::TriggerType};

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerAttacks {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub alone: bool,
}

impl TriggerAttacks {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
            alone: params.is_true(keys::ALONE),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerAttacks {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::Attacks
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        if self.alone && params.num_attackers.unwrap_or(0) != 1 {
            return false;
        }
        trigger.matches_optional_valid_card_filter(&self.valid_card, params.attacker, game)
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        // Java: sa.setTriggeringObject(AbilityKey.Defender, runParams.get(AbilityKey.Attacked));
        if let Some(p) = params.attacked_player {
            sa.set_triggering_object(crate::ability::AbilityKey::Defender, p);
        } else if let Some(c) = params.attacked_card {
            sa.set_triggering_object(crate::ability::AbilityKey::Defender, c);
        }
        // Java: sa.setTriggeringObjectsFrom(runParams, AbilityKey.Attacker, AbilityKey.Defenders, AbilityKey.DefendingPlayer);
        if let Some(attacker) = params.attacker {
            sa.set_triggering_object(crate::ability::AbilityKey::Attacker, attacker);
        }
        // Defenders combines both player and card defender IDs
        match (
            params.defenders_player_ids.as_ref(),
            params.defenders_card_ids.as_ref(),
        ) {
            (Some(players), None) => {
                sa.set_triggering_object(crate::ability::AbilityKey::Defenders, players.clone());
            }
            (None, Some(cards)) => {
                sa.set_triggering_object(crate::ability::AbilityKey::Defenders, cards.clone());
            }
            (Some(players), Some(cards)) => {
                let mut parts: Vec<String> = players.iter().map(|p| p.0.to_string()).collect();
                parts.extend(cards.iter().map(|c| c.0.to_string()));
                sa.set_triggering_object(crate::ability::AbilityKey::Defenders, parts.join(","));
            }
            (None, None) => {}
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
        format!(
            "Attacker: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Attacker)
                .unwrap_or("")
        )
    }
}
