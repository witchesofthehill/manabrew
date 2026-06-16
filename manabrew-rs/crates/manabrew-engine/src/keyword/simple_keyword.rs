//! Simple keyword implementation (no parameters).
//!
//! Ported from Java's `SimpleKeyword.java` in `forge/game/keyword/`.

use super::keyword_instance::{Keyword, KeywordInstanceData};

/// A keyword with no additional parameters.
/// Examples: Flying, Haste, Deathtouch, etc.
#[derive(Debug, Clone)]
pub struct SimpleKeyword {
    pub base: KeywordInstanceData,
}

impl SimpleKeyword {
    /// Create a new simple keyword.
    pub fn new(keyword: Keyword, original: String) -> Self {
        Self {
            base: KeywordInstanceData::new(keyword, original),
        }
    }

    /// Get the display title.
    pub fn get_title(&self) -> String {
        self.base.keyword.display_name().to_string()
    }

    /// Parse details (no-op for simple keywords).
    pub fn parse(&mut self, _details: &str) {
        // Simple keywords have no details to parse.
    }

    /// Format reminder text (returned as-is for simple keywords).
    pub fn format_reminder_text(&self, reminder_text: &str) -> String {
        reminder_text.to_string()
    }
}
