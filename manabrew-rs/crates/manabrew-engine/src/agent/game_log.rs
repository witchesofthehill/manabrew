use crate::ids::{CardId, PlayerId};

use super::notification::GameNotification;
use super::PlayerAgent;

#[derive(Debug, Clone)]
pub struct GameLogEvent {
    pub kind: GameLogKind,
    pub message: String,
    pub player: Option<PlayerId>,
    pub card: Option<CardId>,
    pub source_card: Option<CardId>,
    pub target_card: Option<CardId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GameLogKind {
    Info,
    Action,
    Stack,
    Priority,
    Rule,
    Warning,
}

pub fn notify_all_agents(agents: &mut [Box<dyn PlayerAgent>], event: GameLogEvent) {
    for agent in agents.iter_mut() {
        agent.notify(GameNotification::Event(event.clone()));
    }
}

/// Broadcast a `GameNotification` (other than `Event`) to every agent.
pub fn broadcast_notification(agents: &mut [Box<dyn PlayerAgent>], event: GameNotification) {
    for agent in agents.iter_mut() {
        agent.notify(event.clone());
    }
}

impl GameLogEvent {
    pub fn new(kind: GameLogKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            player: None,
            card: None,
            source_card: None,
            target_card: None,
        }
    }

    pub fn info(message: impl Into<String>) -> Self {
        Self::new(GameLogKind::Info, message)
    }

    pub fn action(message: impl Into<String>) -> Self {
        Self::new(GameLogKind::Action, message)
    }

    pub fn stack(message: impl Into<String>) -> Self {
        Self::new(GameLogKind::Stack, message)
    }

    pub fn priority(message: impl Into<String>) -> Self {
        Self::new(GameLogKind::Priority, message)
    }

    pub fn rule(message: impl Into<String>) -> Self {
        Self::new(GameLogKind::Rule, message)
    }

    pub fn warning(message: impl Into<String>) -> Self {
        Self::new(GameLogKind::Warning, message)
    }

    pub fn with_player(mut self, player: PlayerId) -> Self {
        self.player = Some(player);
        self
    }

    pub fn with_card(mut self, card: CardId) -> Self {
        self.card = Some(card);
        if self.source_card.is_none() {
            self.source_card = Some(card);
        }
        self
    }

    pub fn with_source_card(mut self, card: CardId) -> Self {
        self.source_card = Some(card);
        if self.card.is_none() {
            self.card = Some(card);
        }
        self
    }

    pub fn with_target_card(mut self, card: CardId) -> Self {
        self.target_card = Some(card);
        if self.card.is_none() {
            self.card = Some(card);
        }
        self
    }
}
