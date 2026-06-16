//! Emerge keyword implementation.
//!
//! Ported from Java's `Emerge.java` in `forge/game/keyword/`.

use super::keyword_instance::Keyword;
use super::keyword_with_cost::KeywordWithCost;
use super::keyword_with_cost_interface::KeywordWithCostTrait;
use super::keyword_with_type_interface::KeywordWithTypeTrait;

/// Emerge keyword data.
/// You may cast this spell by sacrificing a creature and paying the emerge cost
/// reduced by that creature's mana value.
#[derive(Debug, Clone)]
pub struct Emerge {
    pub inner: KeywordWithCost,
    /// The type to sacrifice (default "Creature").
    pub type_str: Option<String>,
    /// Human-readable type description.
    pub desc_type: String,
}

impl Emerge {
    /// Create a new Emerge keyword.
    pub fn new(original: String) -> Self {
        Self {
            inner: KeywordWithCost::new(Keyword::Emerge, original),
            type_str: None,
            desc_type: "creature".to_string(),
        }
    }

    /// Parse the details string.
    pub fn parse(&mut self, details: &str) {
        let k: Vec<&str> = details.split(':').collect();
        self.inner.cost_string = k[0].to_string();
        if k.len() >= 2 {
            self.type_str = Some(k[1].to_string());
            self.desc_type = k[1].to_lowercase();
        }
    }

    /// Get the display title.
    pub fn get_title(&self) -> String {
        format!(
            "{} {}",
            self.get_title_without_cost(),
            self.inner.cost_string
        )
    }

    /// Format reminder text.
    pub fn format_reminder_text(&self, reminder_text: &str) -> String {
        reminder_text
            .replace("%s", &self.inner.cost_string)
            .replace("%1$s", &self.inner.cost_string)
            .replace("%2$s", &self.desc_type)
    }
}

impl KeywordWithCostTrait for Emerge {
    fn get_cost_string(&self) -> &str {
        &self.inner.cost_string
    }

    fn get_title_without_cost(&self) -> String {
        let mut sb = "Emerge".to_string();
        if self.type_str.is_some() {
            sb.push_str(" from ");
            sb.push_str(&self.desc_type);
        }
        sb
    }
}

impl KeywordWithTypeTrait for Emerge {
    fn get_valid_type(&self) -> &str {
        self.type_str.as_deref().unwrap_or("Creature")
    }

    fn get_type_description(&self) -> &str {
        &self.desc_type
    }
}
