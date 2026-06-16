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
pub struct TriggerAttackerUnblockedOnce {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
}

impl TriggerAttackerUnblockedOnce {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerAttackerUnblockedOnce {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::AttackerUnblockedOnce
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
        // Java: sa.setTriggeringObjectsFrom(runParams, AbilityKey.AttackingPlayer, AbilityKey.Defenders);
        if let Some(p) = params.attacking_player {
            sa.set_triggering_object(crate::ability::AbilityKey::AttackingPlayer, p.0.to_string());
        }
        // Defenders combines both player and card defender IDs
        {
            let mut parts = Vec::new();
            if let Some(players) = params.defenders_player_ids.as_ref() {
                for p in players {
                    parts.push(p.0.to_string());
                }
            }
            if let Some(cards) = params.defenders_card_ids.as_ref() {
                for c in cards {
                    parts.push(c.0.to_string());
                }
            }
            if !parts.is_empty() {
                sa.set_triggering_object(crate::ability::AbilityKey::Defenders, parts.join(","));
            }
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "AttackingPlayer: {}, Defenders: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::AttackingPlayer)
                .unwrap_or(""),
            sa.get_triggering_object(crate::ability::AbilityKey::Defenders)
                .unwrap_or("")
        )
    }
}
