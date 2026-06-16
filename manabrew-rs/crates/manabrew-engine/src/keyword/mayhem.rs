//! Mayhem keyword implementation.
//!
//! Ported from Java's `Mayhem.java` in `forge/game/keyword/`.

use super::keyword_instance::Keyword;
use super::keyword_with_cost::KeywordWithCost;

/// Mayhem keyword data.
/// You may cast this card from your graveyard for its cost if you discarded it this turn.
#[derive(Debug, Clone)]
pub struct Mayhem {
    pub inner: KeywordWithCost,
    /// Whether there is no cost (play for free from graveyard).
    pub no_cost: bool,
}

impl Mayhem {
    /// Create a new Mayhem keyword.
    pub fn new(original: String) -> Self {
        Self {
            inner: KeywordWithCost::new(Keyword::Mayhem, original),
            no_cost: false,
        }
    }

    /// Parse the details string.
    pub fn parse(&mut self, details: &str) {
        if details.is_empty() {
            self.no_cost = true;
        } else {
            self.inner.parse(details);
        }
    }

    /// Get the display title.
    pub fn get_title(&self) -> String {
        if self.no_cost {
            self.inner.base.keyword.display_name().to_string()
        } else {
            self.inner.get_title()
        }
    }

    /// Format reminder text.
    pub fn format_reminder_text(&self, reminder_text: &str) -> String {
        if self.no_cost {
            "You may play this card from your graveyard if you discarded it this turn. Timing rules still apply.".to_string()
        } else {
            self.inner.format_reminder_text(reminder_text)
        }
    }
}
