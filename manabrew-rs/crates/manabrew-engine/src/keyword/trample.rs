//! Trample keyword implementation.
//!
//! Ported from Java's `Trample.java` in `forge/game/keyword/`.

use super::keyword_instance::Keyword;
use super::keyword_with_type::KeywordWithType;

/// Trample keyword data.
/// This creature can deal excess combat damage to the player or planeswalker
/// it's attacking. Has a "trample over planeswalkers" variant.
#[derive(Debug, Clone)]
pub struct Trample {
    pub inner: KeywordWithType,
}

impl Trample {
    /// Create a new Trample keyword.
    pub fn new(original: String) -> Self {
        Self {
            inner: KeywordWithType::new(Keyword::Trample, original),
        }
    }

    /// Parse the details string.
    pub fn parse(&mut self, details: &str) {
        self.inner.parse(details);
    }

    /// Get the display title.
    pub fn get_title(&self) -> String {
        if !self.inner.type_str.is_empty() {
            "Trample over planeswalkers".to_string()
        } else {
            "Trample".to_string()
        }
    }

    /// Format reminder text.
    pub fn format_reminder_text(&self, reminder_text: &str) -> String {
        if !self.inner.type_str.is_empty() {
            "This creature can deal excess combat damage to the controller of the planeswalker it's attacking.".to_string()
        } else {
            reminder_text.to_string()
        }
    }
}
