//! Devour keyword implementation.
//!
//! Ported from Java's `Devour.java` in `forge/game/keyword/`.

use super::keyword_instance::Keyword;
use super::keyword_with_amount::KeywordWithAmount;
use super::keyword_with_type_interface::KeywordWithTypeTrait;

/// Devour keyword data.
/// As this creature enters, you may sacrifice creatures. It enters with
/// +1/+1 counters for each creature sacrificed.
#[derive(Debug, Clone)]
pub struct Devour {
    pub inner: KeywordWithAmount,
    /// The type to devour (default "Creature").
    pub type_str: Option<String>,
    /// Human-readable type description.
    pub desc_type: String,
    /// Plural type for reminder text.
    pub reminder_type: String,
    /// Extra text.
    pub extra: Option<String>,
}

impl Devour {
    /// Create a new Devour keyword.
    pub fn new(original: String) -> Self {
        Self {
            inner: KeywordWithAmount::new(Keyword::Devour, original),
            type_str: None,
            desc_type: "Creature".to_string(),
            reminder_type: "creatures".to_string(),
            extra: None,
        }
    }

    /// Parse the details string.
    pub fn parse(&mut self, details: &str) {
        let d: Vec<&str> = details.split(':').collect();
        if d[0].starts_with('X') {
            self.inner.with_x = true;
        } else {
            self.inner.amount = d[0].parse::<i32>().unwrap_or(0);
        }
        if d.len() > 1 && !d[1].is_empty() {
            self.type_str = Some(d[1].to_string());
            self.desc_type = d[1].to_string();
            // Simple pluralization
            self.reminder_type = format!("{}s", d[1].to_lowercase());
        }
        if d.len() > 2 {
            self.extra = Some(d[2].to_string());
        }
    }

    /// Get the display title.
    pub fn get_title(&self) -> String {
        let mut sb = self.inner.base.keyword.display_name().to_string();
        if self.type_str.is_some() {
            sb.push(' ');
            sb.push_str(&self.desc_type);
        }
        sb.push(' ');
        sb.push_str(&self.inner.get_amount_string());
        if let Some(ref extra) = self.extra {
            sb.push_str(extra);
        }
        sb
    }

    /// Format reminder text.
    pub fn format_reminder_text(&self, reminder_text: &str) -> String {
        if self.inner.with_x {
            reminder_text
                .replace("%d", "X")
                .replace("%1$d", "X")
                .replace("%1$s", "X")
                .replace("%2$s", &self.reminder_type)
                .replace("%s", "X")
        } else {
            reminder_text
                .replace("%d", &self.inner.amount.to_string())
                .replace("%1$d", &self.inner.amount.to_string())
                .replace("%1$s", &self.inner.amount.to_string())
                .replace("%2$s", &self.reminder_type)
                .replace("%s", &self.inner.amount.to_string())
        }
    }
}

impl KeywordWithTypeTrait for Devour {
    fn get_valid_type(&self) -> &str {
        self.type_str.as_deref().unwrap_or("Creature")
    }

    fn get_type_description(&self) -> &str {
        &self.desc_type
    }
}
