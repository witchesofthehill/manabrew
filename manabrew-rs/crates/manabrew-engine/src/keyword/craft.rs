//! Craft keyword implementation.
//!
//! Ported from Java's `Craft.java` in `forge/game/keyword/`.

use super::keyword_instance::Keyword;
use super::keyword_with_cost::KeywordWithCost;

/// Craft keyword data.
/// Pay cost, exile this artifact and other materials: Return transformed.
#[derive(Debug, Clone)]
pub struct Craft {
    pub inner: KeywordWithCost,
    /// The mana portion of the cost.
    pub mana_string: String,
    /// Description of what to exile.
    pub exile_string: String,
}

impl Craft {
    /// Create a new Craft keyword.
    pub fn new(original: String) -> Self {
        Self {
            inner: KeywordWithCost::new(Keyword::Craft, original),
            mana_string: "Mana?".to_string(),
            exile_string: "Exile?".to_string(),
        }
    }

    /// Parse the details string.
    pub fn parse(&mut self, details: &str) {
        let k: Vec<&str> = details.split(':').collect();
        if !k.is_empty() {
            self.inner.parse(k[0]);
            self.mana_string = k[0].to_string();
        }
        if k.len() > 2 {
            self.exile_string = format!(
                "Exile {} from among permanents you control and/or cards in your graveyard",
                k[2]
            );
        }
    }

    /// Format reminder text.
    pub fn format_reminder_text(&self, reminder_text: &str) -> String {
        let cost_desc = format!(
            "{}, Exile this artifact, {}",
            self.mana_string, self.exile_string
        );
        reminder_text.replace("%s", &cost_desc)
    }

    /// Get the display title.
    pub fn get_title(&self) -> String {
        self.inner.get_title()
    }
}
