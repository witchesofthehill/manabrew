//! Keyword with both a cost and a type parameter.
//!
//! Ported from Java's `KeywordWithCostAndType.java` in `forge/game/keyword/`.

use super::keyword_instance::{Keyword, KeywordInstanceData};
use super::keyword_with_cost_interface::KeywordWithCostTrait;
use super::keyword_with_type_interface::KeywordWithTypeTrait;

/// A keyword with both a cost and a type
/// (e.g. "Splice onto Arcane:2 U U", "TypeCycling:Basic:1").
#[derive(Debug, Clone)]
pub struct KeywordWithCostAndType {
    pub base: KeywordInstanceData,
    /// The cost string.
    pub cost_string: String,
    /// The type for matching.
    pub type_str: String,
    /// Human-readable type description.
    pub desc_type: String,
    /// Type description for reminder text.
    pub reminder_type: String,
}

impl KeywordWithCostAndType {
    /// Create a new keyword with cost and type.
    pub fn new(keyword: Keyword, original: String) -> Self {
        Self {
            base: KeywordInstanceData::new(keyword, original),
            cost_string: String::new(),
            type_str: String::new(),
            desc_type: String::new(),
            reminder_type: String::new(),
        }
    }

    /// Get the display title.
    pub fn get_title(&self) -> String {
        format!("{} {}", self.get_title_without_cost(), self.cost_string)
    }

    /// Parse the details string.
    pub fn parse(&mut self, details: &str) {
        let k: Vec<&str> = details.split(':').collect();
        self.type_str = k[0].to_string();
        if k.len() > 1 {
            self.cost_string = k[1].to_string();
        }
        if k.len() > 2 {
            self.desc_type = k[2].to_string();
            self.reminder_type = k[2].to_string();
        } else {
            self.desc_type = match self.type_str.as_str() {
                "Basic" => "basic land".to_string(),
                _ => self.type_str.clone(),
            };
            self.reminder_type = self.desc_type.clone();
        }
    }

    /// Format reminder text.
    pub fn format_reminder_text(&self, reminder_text: &str) -> String {
        reminder_text
            .replace("%s", &self.cost_string)
            .replace("%1$s", &self.cost_string)
            .replace("%2$s", &self.reminder_type)
    }
}

impl KeywordWithCostTrait for KeywordWithCostAndType {
    fn get_cost_string(&self) -> &str {
        &self.cost_string
    }

    fn get_title_without_cost(&self) -> String {
        if self.base.keyword == Keyword::Splice {
            format!("Splice onto {}", self.desc_type)
        } else {
            format!("{}cycling", self.desc_type)
        }
    }
}

impl KeywordWithTypeTrait for KeywordWithCostAndType {
    fn get_valid_type(&self) -> &str {
        &self.type_str
    }

    fn get_type_description(&self) -> &str {
        &self.desc_type
    }
}
