//! Keyword with both a cost and a numeric amount.
//!
//! Ported from Java's `KeywordWithCostAndAmount.java` in `forge/game/keyword/`.

use super::keyword_instance::{Keyword, KeywordInstanceData};
use super::keyword_with_cost_interface::KeywordWithCostTrait;

/// A keyword with both a cost and a numeric amount
/// (e.g. "Suspend:3:1 U U" = suspend 3 with cost 1UU).
#[derive(Debug, Clone)]
pub struct KeywordWithCostAndAmount {
    pub base: KeywordInstanceData,
    /// The cost string.
    pub cost_string: String,
    /// Whether the amount is variable (X).
    pub with_x: bool,
    /// The numeric amount.
    pub amount: i32,
}

impl KeywordWithCostAndAmount {
    /// Create a new keyword with cost and amount.
    pub fn new(keyword: Keyword, original: String) -> Self {
        Self {
            base: KeywordInstanceData::new(keyword, original),
            cost_string: String::new(),
            with_x: false,
            amount: 0,
        }
    }

    /// Get the amount.
    pub fn get_amount(&self) -> i32 {
        self.amount
    }

    /// Get the amount as display string.
    pub fn get_amount_string(&self) -> String {
        if self.with_x {
            "X".to_string()
        } else {
            self.amount.to_string()
        }
    }

    /// Get the display title.
    pub fn get_title(&self) -> String {
        format!("{}{}", self.get_title_without_cost(), self.cost_string)
    }

    /// Parse the details string.
    pub fn parse(&mut self, details: &str) {
        let k: Vec<&str> = details.split(':').collect();
        if k[0].starts_with('X') {
            self.with_x = true;
        } else {
            self.amount = k[0].parse::<i32>().unwrap_or(0);
        }
        if k.len() > 1 {
            self.cost_string = k[1].split('|').next().unwrap_or("").trim().to_string();
        }
    }

    /// Format reminder text with cost and amount.
    pub fn format_reminder_text(&self, reminder_text: &str) -> String {
        let format_str = if self.with_x {
            reminder_text
                .replace("%d", "%s")
                .replace("%1$d", "%1$s")
                .replace("%2$d", "%2$s")
        } else {
            reminder_text.to_string()
        };
        // Simple replacement: %s -> cost, %d or second -> amount
        format_str
            .replace("%s", &self.cost_string)
            .replace("%d", &self.amount.to_string())
            .replace("%1$s", &self.cost_string)
            .replace(
                "%2$s",
                &if self.with_x {
                    "X".to_string()
                } else {
                    self.amount.to_string()
                },
            )
            .replace("%1$d", &self.cost_string)
            .replace("%2$d", &self.amount.to_string())
    }
}

impl KeywordWithCostTrait for KeywordWithCostAndAmount {
    fn get_cost_string(&self) -> &str {
        &self.cost_string
    }

    fn get_title_without_cost(&self) -> String {
        format!("{} {}\u{2014}", self.base.keyword, self.get_amount_string())
    }
}
