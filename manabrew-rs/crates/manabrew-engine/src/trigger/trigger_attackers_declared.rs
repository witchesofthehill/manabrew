use serde::{Deserialize, Serialize};

use crate::{
    event::RunParams,
    game::GameState,
    parsing::compare::compare_expr,
    parsing::{keys, Params},
    spellability::SpellAbility,
    trigger::TriggerType,
};

use super::trigger::TriggerBehavior;

fn attacked_target_matches(
    trigger: &super::trigger::Trigger,
    filter: &crate::parsing::CompiledSelector,
    params: &RunParams,
    game: &GameState,
) -> bool {
    params
        .attacked_card
        .is_some_and(|card_id| trigger.matches_valid_card_filter(filter, card_id, game))
        || params
            .attacked_player
            .is_some_and(|player_id| trigger.matches_valid_player_filter(filter, player_id, game))
        || params.defenders_card_ids.as_ref().is_some_and(|cards| {
            cards
                .iter()
                .copied()
                .any(|card_id| trigger.matches_valid_card_filter(filter, card_id, game))
        })
        || params.defenders_player_ids.as_ref().is_some_and(|players| {
            players
                .iter()
                .copied()
                .any(|player_id| trigger.matches_valid_player_filter(filter, player_id, game))
        })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerAttackersDeclared {
    pub valid_player: Option<crate::parsing::CompiledSelector>,
    pub valid_attackers: Option<crate::parsing::CompiledSelector>,
    pub valid_attackers_amount: Option<String>,
    pub attacked_target: Option<crate::parsing::CompiledSelector>,
    pub one_target: bool,
}

impl TriggerAttackersDeclared {
    pub fn parse(mode_str: &str, params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_player: params.selector_cloned_any(&[keys::ATTACKING_PLAYER, keys::VALID_PLAYER]),
            valid_attackers: params.selector_cloned(keys::VALID_ATTACKERS),
            valid_attackers_amount: params.get_cloned(keys::VALID_ATTACKERS_AMOUNT),
            attacked_target: params.selector_cloned("AttackedTarget"),
            one_target: mode_str == "AttackersDeclaredOneTarget",
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerAttackersDeclared {
    fn trigger_type(&self) -> TriggerType {
        if self.one_target {
            TriggerType::AttackersDeclaredOneTarget
        } else {
            TriggerType::AttackersDeclared
        }
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        if !trigger.matches_optional_valid_player_filter(
            &self.valid_player,
            params.attacking_player.or(params.player),
            game,
        ) {
            return false;
        }
        if let Some(filter) = &self.attacked_target {
            if !attacked_target_matches(trigger, filter, params, game) {
                return false;
            }
        }
        if self.valid_attackers.is_none()
            && self.valid_attackers_amount.is_none()
            && params.attacker_ids.is_none()
        {
            return true;
        }
        let Some(attacker_ids) = params.attacker_ids.as_ref() else {
            return false;
        };
        let matching_count = if let Some(filter) = &self.valid_attackers {
            attacker_ids
                .iter()
                .filter(|&&attacker| trigger.matches_valid_card_filter(filter, attacker, game))
                .count()
        } else {
            attacker_ids.len()
        };
        if let Some(amount_filter) = &self.valid_attackers_amount {
            return compare_expr(matching_count as i32, amount_filter);
        }
        matching_count > 0
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        // Java: sa.setTriggeringObject(AbilityKey.Attackers, attackers);
        if let Some(attacker_ids) = params.attacker_ids.as_ref() {
            let csv = attacker_ids
                .iter()
                .map(|c| c.0.to_string())
                .collect::<Vec<_>>()
                .join(",");
            sa.set_triggering_object(crate::ability::AbilityKey::Attackers, &csv);
        }
        // Java: sa.setTriggeringObject(AbilityKey.AttackedTarget, attackedTarget);
        // Combine defender players and defender cards into a single CSV
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
            if let Some(p) = params.attacked_player {
                if parts.is_empty() {
                    parts.push(p.0.to_string());
                }
            } else if let Some(c) = params.attacked_card {
                if parts.is_empty() {
                    parts.push(c.0.to_string());
                }
            }
            if !parts.is_empty() {
                sa.set_triggering_object(
                    crate::ability::AbilityKey::AttackedTarget,
                    parts.join(","),
                );
            }
        }
        // Java: sa.setTriggeringObjectsFrom(runParams, AbilityKey.AttackingPlayer);
        if let Some(p) = params.attacking_player {
            sa.set_triggering_object(crate::ability::AbilityKey::AttackingPlayer, p.0.to_string());
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "Number Attackers: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Attackers)
                .unwrap_or("")
        )
    }
}
