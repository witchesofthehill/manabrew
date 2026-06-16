//! Keyword with a type parameter.
//!
//! Ported from Java's `KeywordWithType.java` in `forge/game/keyword/`.

use super::keyword_instance::{Keyword, KeywordInstanceData};
use super::keyword_with_type_interface::KeywordWithTypeTrait;

/// A keyword with a type parameter (e.g. "Protection from red", "Landwalk:Swamp").
#[derive(Debug, Clone)]
pub struct KeywordWithType {
    pub base: KeywordInstanceData,
    /// The type for matching.
    pub type_str: String,
    /// Human-readable type description.
    pub desc_type: String,
    /// Type description used in reminder text.
    pub reminder_type: String,
}

impl KeywordWithType {
    /// Create a new keyword with type.
    pub fn new(keyword: Keyword, original: String) -> Self {
        Self {
            base: KeywordInstanceData::new(keyword, original),
            type_str: String::new(),
            desc_type: String::new(),
            reminder_type: String::new(),
        }
    }

    /// Get the display title.
    pub fn get_title(&self) -> String {
        format!("{} {}", self.base.keyword, self.desc_type)
    }

    /// Parse the details string.
    pub fn parse(&mut self, details: &str) {
        if details.contains(':') {
            let k: Vec<&str> = details.split(':').collect();
            match self.base.keyword {
                Keyword::Affinity
                | Keyword::BandsWith
                | Keyword::Enchant
                | Keyword::Hexproof
                | Keyword::Landwalk => {
                    self.type_str = k[0].to_string();
                    self.desc_type = k[1].to_string();
                }
                _ => {
                    self.type_str = k[1].to_string();
                    self.desc_type = k[0].to_string();
                }
            }
        } else {
            self.type_str = details.to_string();
            self.desc_type = details.to_string();
        }

        // Special reminder type handling
        if self.desc_type.eq_ignore_ascii_case("Outlaw") {
            self.reminder_type = "Assassin, Mercenary, Pirate, Rogue, and/or Warlock".to_string();
        } else if self.type_str.eq_ignore_ascii_case("historic permanent") {
            self.reminder_type = "artifact, legendary, and/or Saga permanent".to_string();
        } else {
            self.reminder_type = self.desc_type.clone();
        }
    }

    /// Format reminder text.
    pub fn format_reminder_text(&self, reminder_text: &str) -> String {
        reminder_text.replace("%s", &self.reminder_type)
    }
}

impl KeywordWithTypeTrait for KeywordWithType {
    fn get_valid_type(&self) -> &str {
        &self.type_str
    }

    fn get_type_description(&self) -> &str {
        &self.desc_type
    }
}
