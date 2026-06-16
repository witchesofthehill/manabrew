//! Kicker keyword implementation.
//!
//! Ported from Java's `Kicker.java` in `forge/game/keyword/`.

use super::keyword_instance::Keyword;
use super::keyword_with_cost::KeywordWithCost;

/// Kicker keyword data.
/// You may pay an additional cost as you cast this spell.
/// Supports single and double kicker.
#[derive(Debug, Clone)]
pub struct Kicker {
    pub inner: KeywordWithCost,
    /// Optional second kicker cost (for double kicker cards).
    pub cost2: Option<String>,
}

impl Kicker {
    /// Create a new Kicker keyword.
    pub fn new(original: String) -> Self {
        Self {
            inner: KeywordWithCost::new(Keyword::Kicker, original),
            cost2: None,
        }
    }

    /// Parse the details string.
    pub fn parse(&mut self, details: &str) {
        let parts: Vec<&str> = details.split(':').collect();
        self.inner.parse(parts[0]);
        if parts.len() > 1 {
            self.cost2 = Some(parts[1].to_string());
        }
    }

    /// Format reminder text.
    pub fn format_reminder_text(&self, reminder_text: &str) -> String {
        if let Some(ref cost2) = self.cost2 {
            format!(
                "You may pay an additional {} and/or {} as you cast this spell.",
                self.inner.cost_string, cost2
            )
        } else {
            self.inner.format_reminder_text(reminder_text)
        }
    }

    /// Get the display title.
    pub fn get_title(&self) -> String {
        self.inner.get_title()
    }
}
