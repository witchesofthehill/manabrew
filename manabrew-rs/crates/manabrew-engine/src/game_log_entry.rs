use crate::game_log_entry_type::GameLogEntryType;

/// Immutable game log entry.
/// Mirrors Java `GameLogEntry`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GameLogEntry {
    pub entry_type: GameLogEntryType,
    pub indent: usize,
    pub message: String,
}

impl GameLogEntry {
    pub fn new(entry_type: GameLogEntryType, indent: usize, message: impl Into<String>) -> Self {
        Self {
            entry_type,
            indent,
            message: message.into(),
        }
    }
}
