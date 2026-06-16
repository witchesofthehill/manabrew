//! Suspend keyword implementation.
//!
//! Ported from Java's `Suspend.java` in `forge/game/keyword/`.

use super::keyword_instance::Keyword;
use super::keyword_with_cost_and_amount::KeywordWithCostAndAmount;

/// Suspend keyword data.
/// Pay cost and exile with time counters. Remove one each upkeep.
/// When the last is removed, cast without paying mana cost.
#[derive(Debug, Clone)]
pub struct Suspend {
    pub inner: KeywordWithCostAndAmount,
    /// Whether this suspend has no cost and no amount (intrinsic suspend).
    pub without_cost_and_amount: bool,
}

impl Suspend {
    /// Create a new Suspend keyword.
    pub fn new(original: String) -> Self {
        Self {
            inner: KeywordWithCostAndAmount::new(Keyword::Suspend, original),
            without_cost_and_amount: false,
        }
    }

    /// Parse the details string.
    pub fn parse(&mut self, details: &str) {
        if details.is_empty() {
            self.without_cost_and_amount = true;
        } else {
            self.inner.parse(details);
        }
    }

    /// Get the display title.
    pub fn get_title(&self) -> String {
        if self.without_cost_and_amount {
            self.inner.base.keyword.display_name().to_string()
        } else {
            self.inner.get_title()
        }
    }

    /// Format reminder text.
    pub fn format_reminder_text(&self, reminder_text: &str) -> String {
        if self.without_cost_and_amount {
            "At the beginning of its owner's upkeep, remove a time counter from that card. When the last is removed, the player plays it without paying its mana cost. If it's a creature, it has haste.".to_string()
        } else {
            self.inner.format_reminder_text(reminder_text)
        }
    }
}
