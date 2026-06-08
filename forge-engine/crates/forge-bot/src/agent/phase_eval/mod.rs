//! Heuristic AI adapted from the phase-rs/phase `phase-ai` crate (Apache-2.0).
//! Reads only the agent protocol — and only public information: it caches the
//! latest `StateUpdate` view and never inspects opponents' hand contents (see
//! [`view::BotView::card_by_id`]). Specializes combat (attackers/blockers) with
//! a 1-ply damage-resolution lookahead and hostile/friendly targeting;
//! delegates every other decision to [`SimpleAi`].

mod combat;
mod eval;
mod targeting;
mod view;

use forge_agent_interface::game_view_dto::GameViewDto;
use forge_agent_interface::prompt::{AgentPrompt, AgentPromptInner, PlayerAction};

use super::{BotAgent, SimpleAi};

#[derive(Default)]
pub struct PhaseEvalAi {
    fallback: SimpleAi,
    latest_view: Option<GameViewDto>,
}

impl PhaseEvalAi {
    pub fn new() -> Self {
        Self::default()
    }
}

impl BotAgent for PhaseEvalAi {
    fn observe(&mut self, view: &GameViewDto) {
        self.latest_view = Some(view.clone());
    }

    fn decide(&mut self, prompt: AgentPrompt) -> Option<PlayerAction> {
        let me = prompt.deciding_player_id.clone();
        if let Some(view) = self.latest_view.as_ref() {
            match &prompt.input {
                AgentPromptInner::ChooseAttackers {
                    available_attacker_ids,
                    possible_defender_ids,
                    ..
                } => {
                    return Some(combat::choose_attackers(
                        &me,
                        view,
                        available_attacker_ids,
                        possible_defender_ids,
                    ))
                }
                AgentPromptInner::ChooseBlockers {
                    attacker_ids,
                    available_blocker_ids,
                    ..
                } => {
                    return Some(combat::choose_blockers(
                        &me,
                        view,
                        attacker_ids,
                        available_blocker_ids,
                    ))
                }
                AgentPromptInner::ChooseTargetPlayer {
                    valid_player_ids,
                    intent,
                    ..
                } => {
                    return Some(targeting::choose_target_player(
                        &me,
                        view,
                        valid_player_ids,
                        intent.is_hostile(),
                    ))
                }
                AgentPromptInner::ChooseTargetCard {
                    valid_card_ids,
                    intent,
                    ..
                } => {
                    return Some(targeting::choose_target_card(
                        &me,
                        view,
                        valid_card_ids,
                        intent.is_hostile(),
                    ))
                }
                _ => {}
            }
        }
        self.fallback.decide(prompt)
    }
}
