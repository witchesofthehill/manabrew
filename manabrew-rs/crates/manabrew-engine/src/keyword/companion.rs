//! Companion keyword implementation.
//!
//! Ported from Java's `Companion.java` in `forge/game/keyword/`.

use super::keyword_instance::{Keyword, KeywordInstanceData};

/// Companion keyword data.
/// Reveals a companion from outside the game if your deck meets the restriction.
#[derive(Debug, Clone)]
pub struct Companion {
    pub base: KeywordInstanceData,
    /// The deck restriction rule string.
    pub deck_restriction: Option<String>,
    /// Human-readable description.
    pub description: Option<String>,
    /// Special restriction rules (if restriction is "Special").
    pub special_rules: Option<String>,
}

impl Companion {
    /// Create a new Companion keyword.
    pub fn new(original: String) -> Self {
        Self {
            base: KeywordInstanceData::new(Keyword::Companion, original),
            deck_restriction: None,
            description: None,
            special_rules: None,
        }
    }

    /// Parse the details string.
    pub fn parse(&mut self, details: &str) {
        let split: Vec<&str> = details.split(':').collect();
        if split.len() < 2 {
            return;
        }

        self.deck_restriction = Some(split[0].to_string());

        if split[0] == "Special" && split.len() > 1 {
            self.special_rules = Some(split[1].to_string());
        }

        self.description = Some(split[split.len() - 1].to_string());
    }

    /// Whether this companion has a special restriction.
    pub fn has_special_restriction(&self) -> bool {
        self.special_rules.is_some()
    }

    /// Get the display title.
    pub fn get_title(&self) -> String {
        self.base.keyword.display_name().to_string()
    }
}
