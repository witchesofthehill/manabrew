//! Decision strategies for a bot. The lifecycle in `BotState` is fixed; the
//! AI plugged into it is not.
//!
//! To add a new agent: define a struct implementing [`BotAgent`], add a
//! variant to [`AgentKind`], and wire it in [`AgentKind::build`]. The room
//! picks which agent to spawn via the `agent` field of the bot config.

use forge_agent_interface::agent_impl::Responder;
use forge_agent_interface::prompt::{AgentPrompt, PlayerAction};
use serde::{Deserialize, Serialize};

pub mod simple_ai;
pub use simple_ai::SimpleAi;

/// A bot's decision strategy. Each call to `decide` may consult per-bot state
/// (anti-loop memoization, opening-hand plans, …) — hence `&mut self`.
pub trait BotAgent: Send {
    /// `None` means no action for this prompt — only the display-only/terminal
    /// kinds (`StateUpdate`, `GameOver`); every decision prompt yields `Some`
    /// (an explicit `Pass` yields priority). Callers supply their own fallback.
    fn decide(&mut self, prompt: AgentPrompt) -> Option<PlayerAction>;
}

/// Wire-level selector for which built-in agent the bot should use.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum AgentKind {
    #[default]
    Simple,
}

impl AgentKind {
    pub fn build(self) -> Box<dyn BotAgent + Send> {
        match self {
            AgentKind::Simple => Box::<SimpleAi>::default(),
        }
    }
}

pub struct BotResponder {
    agent: Box<dyn BotAgent + Send>,
}

impl BotResponder {
    pub fn new(agent: Box<dyn BotAgent + Send>) -> Self {
        Self { agent }
    }
}

impl Default for BotResponder {
    fn default() -> Self {
        Self::new(AgentKind::default().build())
    }
}

impl Responder for BotResponder {
    fn respond(&mut self, prompt: AgentPrompt) -> PlayerAction {
        self.agent
            .decide(prompt)
            .unwrap_or(PlayerAction::Pass { until_phase: None })
    }
}
