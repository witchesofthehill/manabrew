//! Amplify keyword implementation.
//!
//! Ported from Java's `Amplify.java` in `forge/game/keyword/`.

use super::keyword_instance::Keyword;
use super::keyword_with_amount::KeywordWithAmount;

/// Amplify keyword data.
/// As this creature enters, put +1/+1 counters on it for each matching creature card revealed.
#[derive(Debug, Clone)]
pub struct Amplify {
    pub inner: KeywordWithAmount,
}

impl Amplify {
    /// Create a new Amplify keyword.
    pub fn new(original: String) -> Self {
        Self {
            inner: KeywordWithAmount::new(Keyword::Amplify, original),
        }
    }

    /// Parse the details string.
    pub fn parse(&mut self, details: &str) {
        self.inner.parse(details);
    }

    /// Format reminder text.
    /// Overrides the base to include creature type information.
    pub fn format_reminder_text(&self, reminder_text: &str) -> String {
        let type_desc = "creature"; // In Java this reads from the host card's creature types
        reminder_text
            .replace("%d", &self.inner.amount.to_string())
            .replace("%1$d", &self.inner.amount.to_string())
            .replace("%s", type_desc)
    }
}
