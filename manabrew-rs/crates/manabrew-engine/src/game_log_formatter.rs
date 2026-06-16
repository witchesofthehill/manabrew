use crate::game_log_entry::GameLogEntry;
use crate::game_log_entry_type::GameLogEntryType;

/// Log formatter interface.
/// Mirrors Java `GameLogFormatter`.
pub trait GameLogFormatter: Send + Sync {
    fn format(&self, entry: &GameLogEntry) -> String;
}

/// Console-oriented formatter with stable indentation and category labels.
pub struct ConsoleGameLogFormatter;

impl ConsoleGameLogFormatter {
    const ANSI_RESET: &'static str = "\x1b[0m";
    const ANSI_WHITE: &'static str = "\x1b[37m";
    const ANSI_GREY: &'static str = "\x1b[90m";
    const ANSI_LIGHT_GREY: &'static str = "\x1b[37m";
    const ANSI_GREEN: &'static str = "\x1b[32m";
    const ANSI_YELLOW: &'static str = "\x1b[33m";
    const ANSI_BLUE: &'static str = "\x1b[34m";

    fn indent_prefix(level: usize) -> String {
        let mut out = String::new();
        for ancestor_depth in 0..level {
            out.push_str(Self::color_for_depth(ancestor_depth));
            out.push('|');
            out.push_str(Self::ANSI_RESET);
            out.push_str("  ");
        }
        out
    }

    fn label(entry_type: GameLogEntryType) -> &'static str {
        match entry_type {
            GameLogEntryType::TurnBegin => "TURN",
            GameLogEntryType::TurnSkip => "TURN",
            GameLogEntryType::PhaseBegin => "PHASE",
            GameLogEntryType::PriorityWaiting => "WAIT",
            GameLogEntryType::PriorityResponse => "RESP",
            GameLogEntryType::PriorityPass => "PASS",
            GameLogEntryType::StackPush => "STACK",
            GameLogEntryType::StackResolve => "STACK",
            GameLogEntryType::Mulligan => "MULL",
            GameLogEntryType::Info => "INFO",
        }
    }

    fn color_for_depth(depth: usize) -> &'static str {
        match depth % 4 {
            0 => Self::ANSI_WHITE,
            1 => Self::ANSI_YELLOW,
            2 => Self::ANSI_BLUE,
            _ => Self::ANSI_GREY,
        }
    }

    fn color_for_entry(entry_type: GameLogEntryType) -> &'static str {
        match entry_type {
            GameLogEntryType::TurnBegin | GameLogEntryType::TurnSkip => Self::ANSI_WHITE,
            GameLogEntryType::PhaseBegin => Self::ANSI_YELLOW,
            GameLogEntryType::PriorityPass => Self::ANSI_GREY,
            GameLogEntryType::PriorityResponse => Self::ANSI_GREEN,
            GameLogEntryType::StackPush | GameLogEntryType::StackResolve => Self::ANSI_BLUE,
            GameLogEntryType::Info => Self::ANSI_LIGHT_GREY,
            _ => Self::ANSI_GREEN,
        }
    }
}

impl GameLogFormatter for ConsoleGameLogFormatter {
    fn format(&self, entry: &GameLogEntry) -> String {
        let indent = Self::indent_prefix(entry.indent);
        let line_color = Self::color_for_entry(entry.entry_type);
        let payload = format!("-- [{}] {}", Self::label(entry.entry_type), entry.message);
        format!("{indent}{line_color}{payload}{}", Self::ANSI_RESET)
    }
}
