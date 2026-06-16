//! Vanishing keyword implementation.
//!
//! Ported from Java's `Vanishing.java` in `forge/game/keyword/`.

use super::keyword_instance::Keyword;
use super::keyword_with_amount::KeywordWithAmount;

/// Vanishing keyword data.
/// This permanent enters with time counters. Remove one each upkeep.
/// When the last is removed, sacrifice it.
#[derive(Debug, Clone)]
pub struct Vanishing {
    pub inner: KeywordWithAmount,
    /// Whether this vanishing has no amount (just the upkeep trigger).
    pub without_amount: bool,
}

impl Vanishing {
    /// Create a new Vanishing keyword.
    pub fn new(original: String) -> Self {
        Self {
            inner: KeywordWithAmount::new(Keyword::Vanishing, original),
            without_amount: false,
        }
    }

    /// Parse the details string.
    pub fn parse(&mut self, details: &str) {
        if details.is_empty() {
            self.without_amount = true;
        } else {
            self.inner.parse(details);
        }
    }

    /// Get the display title.
    pub fn get_title(&self) -> String {
        if self.without_amount {
            self.inner.base.keyword.display_name().to_string()
        } else {
            self.inner.get_title()
        }
    }

    /// Format reminder text.
    pub fn format_reminder_text(&self, reminder_text: &str) -> String {
        if self.without_amount {
            "At the beginning of your upkeep, remove a time counter from this enchantment. When the last is removed, sacrifice it.".to_string()
        } else {
            self.inner.format_reminder_text(reminder_text)
        }
    }
}
