//! Firebending keyword implementation.
//!
//! Ported from Java's `Firebending.java` in `forge/game/keyword/`.

use super::keyword_instance::Keyword;
use super::keyword_with_amount::KeywordWithAmount;

/// Firebending keyword data.
/// Whenever this creature attacks, add red mana.
#[derive(Debug, Clone)]
pub struct Firebending {
    pub inner: KeywordWithAmount,
}

impl Firebending {
    /// Create a new Firebending keyword.
    pub fn new(original: String) -> Self {
        Self {
            inner: KeywordWithAmount::new(Keyword::Firebending, original),
        }
    }

    /// Parse the details string.
    pub fn parse(&mut self, details: &str) {
        self.inner.parse(details);
    }

    /// Format reminder text.
    pub fn format_reminder_text(&self, reminder_text: &str) -> String {
        let fire = if self.inner.with_x {
            "X {R}".to_string()
        } else {
            "{R}".repeat(self.inner.amount as usize)
        };
        reminder_text.replace("%s", &fire)
    }

    /// Get the display title.
    pub fn get_title(&self) -> String {
        self.inner.get_title()
    }
}
