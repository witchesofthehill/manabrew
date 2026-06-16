//! Compleated keyword implementation.
//!
//! Ported from Java's `Compleated.java` in `forge/game/keyword/`.

use super::keyword_instance::{Keyword, KeywordInstanceData};

/// Compleated keyword data.
/// This planeswalker enters with two fewer loyalty counters for each
/// Phyrexian mana symbol paid with life.
#[derive(Debug, Clone)]
pub struct Compleated {
    pub base: KeywordInstanceData,
}

impl Compleated {
    /// Create a new Compleated keyword.
    pub fn new(original: String) -> Self {
        Self {
            base: KeywordInstanceData::new(Keyword::Compleated, original),
        }
    }

    /// Parse the details string (no-op, simple keyword variant).
    pub fn parse(&mut self, _details: &str) {}

    /// Get the display title.
    pub fn get_title(&self) -> String {
        self.base.keyword.display_name().to_string()
    }

    /// Format reminder text.
    /// In Java this reads Phyrexian mana shards from the host card's mana cost.
    /// Simplified here to return the base reminder text.
    pub fn format_reminder_text(&self, reminder_text: &str) -> String {
        reminder_text.to_string()
    }
}
