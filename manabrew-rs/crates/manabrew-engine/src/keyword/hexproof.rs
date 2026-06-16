//! Hexproof keyword implementation.
//!
//! Ported from Java's `Hexproof.java` in `forge/game/keyword/`.

use super::keyword_instance::Keyword;
use super::keyword_with_type::KeywordWithType;

/// Hexproof keyword data.
/// This can't be the target of spells or abilities opponents control.
/// Can be qualified with "from" a type (e.g. "Hexproof from black").
#[derive(Debug, Clone)]
pub struct Hexproof {
    pub inner: KeywordWithType,
}

impl Hexproof {
    /// Create a new Hexproof keyword.
    pub fn new(original: String) -> Self {
        Self {
            inner: KeywordWithType::new(Keyword::Hexproof, original),
        }
    }

    /// Parse the details string.
    pub fn parse(&mut self, details: &str) {
        self.inner.parse(details);
    }

    /// Get the display title.
    pub fn get_title(&self) -> String {
        if self.inner.type_str.is_empty() {
            "Hexproof".to_string()
        } else {
            format!("Hexproof from {}", self.inner.desc_type)
        }
    }

    /// Format reminder text.
    pub fn format_reminder_text(&self, reminder_text: &str) -> String {
        if self.inner.type_str.is_empty() {
            "This can't be the target of spells or abilities your opponents control.".to_string()
        } else {
            reminder_text.replace("%s", &self.inner.desc_type)
        }
    }
}
