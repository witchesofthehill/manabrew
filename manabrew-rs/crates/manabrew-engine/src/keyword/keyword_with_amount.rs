//! Keyword with a numeric amount parameter.
//!
//! Ported from Java's `KeywordWithAmount.java` in `forge/game/keyword/`.

use super::keyword_instance::{Keyword, KeywordInstanceData};

/// A keyword with a numeric amount (e.g. "Bushido 2", "Annihilator 4").
#[derive(Debug, Clone)]
pub struct KeywordWithAmount {
    pub base: KeywordInstanceData,
    /// The numeric amount.
    pub amount: i32,
    /// Whether the amount is "X" (variable).
    pub with_x: bool,
    /// Extra text after the X declaration.
    pub extra: String,
}

impl KeywordWithAmount {
    /// Create a new keyword with amount.
    pub fn new(keyword: Keyword, original: String) -> Self {
        Self {
            base: KeywordInstanceData::new(keyword, original),
            amount: 0,
            with_x: false,
            extra: String::new(),
        }
    }

    /// Get the amount.
    pub fn get_amount(&self) -> i32 {
        self.amount
    }

    /// Get the amount as a display string.
    pub fn get_amount_string(&self) -> String {
        if self.with_x {
            "X".to_string()
        } else {
            self.amount.to_string()
        }
    }

    /// Get the display title.
    pub fn get_title(&self) -> String {
        format!("{} {}", self.base.keyword, self.get_amount_string())
    }

    /// Parse the details string.
    pub fn parse(&mut self, details: &str) {
        if details.starts_with('X') {
            self.with_x = true;
            if details.contains(':') {
                if let Some(extra) = details.split(':').nth(1) {
                    self.extra = extra.to_string();
                }
            }
        } else if !details.is_empty() {
            let num_str = if details.contains(':') {
                details.split(':').next().unwrap_or("")
            } else {
                details
            };
            self.amount = num_str.parse::<i32>().unwrap_or(0);
        }
    }

    /// Format reminder text with the amount.
    pub fn format_reminder_text(&self, reminder_text: &str) -> String {
        if self.with_x {
            let result = reminder_text.replace("%d", "X").replace("%1$d", "X");
            if !self.extra.is_empty() && !self.extra.contains('$') {
                // Insert extra before the last character (typically '.')
                let len = result.len();
                if len > 0 {
                    let mut r = result[..len - 1].to_string();
                    r.push_str(&self.extra);
                    r.push_str(&result[len - 1..]);
                    return r;
                }
            }
            result
        } else {
            reminder_text
                .replace("%d", &self.amount.to_string())
                .replace("%1$d", &self.amount.to_string())
        }
    }
}
