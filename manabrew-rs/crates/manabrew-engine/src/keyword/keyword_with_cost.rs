//! Keyword with a cost parameter.
//!
//! Ported from Java's `KeywordWithCost.java` in `forge/game/keyword/`.

use super::keyword_instance::{Keyword, KeywordInstanceData};
use super::keyword_with_cost_interface::KeywordWithCostTrait;

/// A keyword with an associated cost (e.g. "Flashback:2 R", "Equip:3").
#[derive(Debug, Clone)]
pub struct KeywordWithCost {
    pub base: KeywordInstanceData,
    /// The cost string.
    pub cost_string: String,
}

impl KeywordWithCost {
    /// Create a new keyword with cost.
    pub fn new(keyword: Keyword, original: String) -> Self {
        Self {
            base: KeywordInstanceData::new(keyword, original),
            cost_string: String::new(),
        }
    }

    /// Get the display title.
    pub fn get_title(&self) -> String {
        format!("{} {}", self.get_title_without_cost(), self.cost_string)
    }

    /// Parse the details string.
    pub fn parse(&mut self, details: &str) {
        let all_details: Vec<&str> = details.split(':').collect();
        // Take first part, split on '|' and trim.
        self.cost_string = all_details[0]
            .split('|')
            .next()
            .unwrap_or("")
            .trim()
            .to_string();
    }

    /// Format reminder text with the cost.
    pub fn format_reminder_text(&self, reminder_text: &str) -> String {
        if reminder_text.contains('%') {
            reminder_text.replace("%s", &self.cost_string)
        } else {
            reminder_text.to_string()
        }
    }
}

impl KeywordWithCostTrait for KeywordWithCost {
    fn get_cost_string(&self) -> &str {
        &self.cost_string
    }

    fn get_title_without_cost(&self) -> String {
        self.base.keyword.display_name().to_string()
    }
}
