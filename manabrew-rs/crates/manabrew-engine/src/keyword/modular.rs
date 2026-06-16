//! Modular keyword implementation.
//!
//! Ported from Java's `Modular.java` in `forge/game/keyword/`.

use super::keyword_instance::Keyword;
use super::keyword_with_amount::KeywordWithAmount;

/// Modular keyword data.
/// This creature enters with +1/+1 counters. When it dies, you may put
/// its +1/+1 counters on target artifact creature.
/// Has a special "Sunburst" variant.
#[derive(Debug, Clone)]
pub struct Modular {
    pub inner: KeywordWithAmount,
    /// Whether this is the Sunburst variant.
    pub sunburst: bool,
}

impl Modular {
    /// Create a new Modular keyword.
    pub fn new(original: String) -> Self {
        Self {
            inner: KeywordWithAmount::new(Keyword::Modular, original),
            sunburst: false,
        }
    }

    /// Parse the details string.
    pub fn parse(&mut self, details: &str) {
        if details == "Sunburst" {
            self.sunburst = true;
        } else {
            self.inner.parse(details);
        }
    }

    /// Get the display title.
    pub fn get_title(&self) -> String {
        if self.sunburst {
            "Modular\u{2014}Sunburst".to_string()
        } else {
            self.inner.get_title()
        }
    }

    /// Get the amount string.
    pub fn get_amount_string(&self) -> String {
        if self.sunburst {
            "Sunburst".to_string()
        } else {
            self.inner.get_amount_string()
        }
    }

    /// Format reminder text.
    pub fn format_reminder_text(&self, reminder_text: &str) -> String {
        if self.sunburst {
            "This enters with a +1/+1 counter on it for each color of mana spent to cast it. When it dies, you may put its +1/+1 counters on target artifact creature.".to_string()
        } else {
            self.inner.format_reminder_text(reminder_text)
        }
    }
}
