//! Protection keyword implementation.
//!
//! Ported from Java's `Protection.java` in `forge/game/keyword/`.

use super::keyword_instance::{Keyword, KeywordInstanceData};

/// Protection keyword data.
/// This creature can't be blocked, targeted, dealt damage, or
/// equipped/enchanted by the specified quality.
#[derive(Debug, Clone)]
pub struct Protection {
    pub base: KeywordInstanceData,
    /// What this creature has protection from (e.g. "red", "creatures").
    pub from_what: String,
}

impl Protection {
    /// Create a new Protection keyword.
    pub fn new(original: String) -> Self {
        // Extract "from what" from the original string if possible.
        // E.g. "Protection from red" -> "red"
        let from_what = if let Some(rest) = original.strip_prefix("Protection from ") {
            rest.to_string()
        } else {
            String::new()
        };
        Self {
            base: KeywordInstanceData::new(Keyword::Protection, original),
            from_what,
        }
    }

    /// Parse the details string.
    pub fn parse(&mut self, _details: &str) {
        // In Java, parse is a no-op. The from_what is set from the original string.
    }

    /// Get the display title.
    pub fn get_title(&self) -> String {
        format!("Protection from {}", self.from_what)
    }

    /// Format reminder text.
    pub fn format_reminder_text(&self, reminder_text: &str) -> String {
        reminder_text.replace("%s", &self.from_what)
    }
}
