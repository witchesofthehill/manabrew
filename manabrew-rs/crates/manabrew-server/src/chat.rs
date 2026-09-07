use std::collections::VecDeque;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::protocol::{ChatMessage, CHAT_HISTORY_MAX_AGE_MS, CHAT_HISTORY_MAX_MESSAGES};

#[derive(Debug, Default)]
pub struct ChatHistory {
    messages: VecDeque<ChatMessage>,
}

impl ChatHistory {
    pub fn push(&mut self, message: ChatMessage) {
        self.prune(message.sent_at_ms);
        self.messages.push_back(message);
        while self.messages.len() > CHAT_HISTORY_MAX_MESSAGES {
            self.messages.pop_front();
        }
    }

    pub fn snapshot(&mut self) -> Vec<ChatMessage> {
        self.prune(unix_time_ms());
        self.messages.iter().cloned().collect()
    }

    fn prune(&mut self, now_ms: u64) {
        let cutoff = now_ms.saturating_sub(CHAT_HISTORY_MAX_AGE_MS);
        while self.messages.front().is_some_and(|m| m.sent_at_ms < cutoff) {
            self.messages.pop_front();
        }
    }
}

pub fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}
