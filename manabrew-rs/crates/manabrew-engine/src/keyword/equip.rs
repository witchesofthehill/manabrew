//! Equip keyword implementation.
//!
//! Ported from Java's `Equip.java` in `forge/game/keyword/`.

use super::keyword_instance::Keyword;
use super::keyword_with_cost::KeywordWithCost;

/// Equip keyword data.
/// Attach to target creature you control. Equip only as a sorcery.
#[derive(Debug, Clone)]
pub struct Equip {
    pub inner: KeywordWithCost,
    /// The type of permanent that can be equipped (default "creature").
    pub equip_type: String,
}

impl Equip {
    /// Create a new Equip keyword.
    pub fn new(original: String) -> Self {
        Self {
            inner: KeywordWithCost::new(Keyword::Equip, original),
            equip_type: "creature".to_string(),
        }
    }

    /// Parse the details string.
    pub fn parse(&mut self, details: &str) {
        let k: Vec<&str> = details.split(':').collect();
        self.inner.parse(k[0]);
        if k.len() > 2 {
            self.equip_type = k[2].to_string();
        }
    }

    /// Get the valid description (the equip target type).
    pub fn get_valid_description(&self) -> &str {
        &self.equip_type
    }

    /// Format reminder text.
    pub fn format_reminder_text(&self, reminder_text: &str) -> String {
        reminder_text
            .replace("%s", &self.inner.cost_string)
            .replace("%1$s", &self.inner.cost_string)
            .replace("%2$s", &self.equip_type)
    }

    /// Get the display title.
    pub fn get_title(&self) -> String {
        self.inner.get_title()
    }
}
