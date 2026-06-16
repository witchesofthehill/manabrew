use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::Params;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::{Trigger, TriggerBehavior};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerVote {}

impl TriggerVote {
    pub fn parse(_params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {})
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerVote {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::Vote
    }

    fn perform_test(&self, _trigger: &Trigger, _params: &RunParams, _game: &GameState) -> bool {
        true
    }

    fn set_triggering_objects(
        &self,
        trigger: &Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        game: &GameState,
    ) {
        let host_controller = trigger.base.card_trait_base.host_controller(game);
        let Some(all_votes) = params.all_votes.as_ref() else {
            return;
        };

        let mut same = Vec::new();
        let mut diff = Vec::new();
        for (_, voters) in all_votes {
            let host_voted_here = voters.contains(&host_controller);
            for &player in voters {
                if player == host_controller || game.opponent_of(host_controller) != player {
                    continue;
                }
                let bucket = if host_voted_here {
                    &mut same
                } else {
                    &mut diff
                };
                if !bucket.contains(&player) {
                    bucket.push(player);
                }
            }
        }

        if !same.is_empty() {
            let csv = same
                .iter()
                .map(|player_id| player_id.0.to_string())
                .collect::<Vec<_>>()
                .join(",");
            sa.set_triggering_object(crate::ability::AbilityKey::OpponentVotedSame, &csv);
        }
        if !diff.is_empty() {
            let csv = diff
                .iter()
                .map(|player_id| player_id.0.to_string())
                .collect::<Vec<_>>()
                .join(",");
            sa.set_triggering_object(crate::ability::AbilityKey::OpponentVotedDiff, &csv);
        }
    }

    fn get_important_stack_objects(&self, _trigger: &Trigger, _sa: &SpellAbility) -> String {
        String::new()
    }
}
