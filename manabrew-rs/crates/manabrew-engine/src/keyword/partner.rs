//! Partner keyword implementation.
//!
//! Ported from Java's `Partner.java` in `forge/game/keyword/`.

use super::keyword_instance::{Keyword, KeywordInstanceData};

/// Partner keyword data.
/// You can have two commanders if both have partner.
/// Also used for "Choose a Background", "Doctor's companion", etc.
#[derive(Debug, Clone)]
pub struct Partner {
    pub base: KeywordInstanceData,
    /// The specific partner name (for "Partner with X").
    pub with: Option<String>,
}

impl Partner {
    /// Create a new Partner keyword.
    pub fn new(keyword: Keyword, original: String) -> Self {
        Self {
            base: KeywordInstanceData::new(keyword, original),
            with: None,
        }
    }

    /// Parse the details string.
    pub fn parse(&mut self, details: &str) {
        if !details.is_empty() {
            self.with = Some(details.to_string());
        }
    }

    /// Get the display title.
    pub fn get_title(&self) -> String {
        if let Some(ref with) = self.with {
            format!("Partner \u{2014} {}", with)
        } else {
            self.base.keyword.display_name().to_string()
        }
    }

    /// Format reminder text.
    pub fn format_reminder_text(&self, reminder_text: &str) -> String {
        if self.with.is_some() {
            "You can have two commanders if both have this ability.".to_string()
        } else {
            reminder_text.to_string()
        }
    }
}
