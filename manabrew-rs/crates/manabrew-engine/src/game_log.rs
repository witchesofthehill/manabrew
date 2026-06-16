use crate::game_log_entry::GameLogEntry;
use crate::game_log_entry_type::GameLogEntryType;
use crate::game_log_formatter::{ConsoleGameLogFormatter, GameLogFormatter};

/// Engine game logger.
/// Mirrors Java `GameLog`.
pub struct GameLog {
    enabled: bool,
    formatter: Box<dyn GameLogFormatter>,
}

impl Default for GameLog {
    fn default() -> Self {
        Self::new()
    }
}

impl GameLog {
    pub fn new() -> Self {
        Self {
            enabled: Self::enabled_from_env(),
            formatter: Box::new(ConsoleGameLogFormatter),
        }
    }

    pub fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    pub fn log(&self, entry_type: GameLogEntryType, indent: usize, message: impl Into<String>) {
        if !self.enabled {
            return;
        }
        let entry = GameLogEntry::new(entry_type, indent, message);
        eprintln!("{}", self.formatter.format(&entry));
    }

    fn enabled_from_env() -> bool {
        match std::env::var("manabrew_engine_GAME_LOG") {
            Ok(value) => {
                let v = value.trim().to_ascii_lowercase();
                !(v == "0" || v == "false" || v == "off")
            }
            Err(_) => false,
        }
    }
}
