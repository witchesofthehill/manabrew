//! Ninjutsu keyword implementation.
//!
//! Ported from Java's `Ninjutsu.java` in `forge/game/keyword/`.

use super::keyword_instance::Keyword;
use super::keyword_with_cost::KeywordWithCost;

/// Ninjutsu keyword data.
/// Pay cost, return an unblocked attacker: Put this card onto the battlefield
/// from your hand tapped and attacking.
#[derive(Debug, Clone)]
pub struct Ninjutsu {
    pub inner: KeywordWithCost,
    /// Whether this is commander ninjutsu (can also be used from command zone).
    pub commander: bool,
}

impl Ninjutsu {
    /// Create a new Ninjutsu keyword.
    pub fn new(original: String) -> Self {
        Self {
            inner: KeywordWithCost::new(Keyword::Ninjutsu, original),
            commander: false,
        }
    }

    /// Parse the details string.
    pub fn parse(&mut self, details: &str) {
        let mut cost_details = details;
        if details.contains(':') {
            let k: Vec<&str> = details.split(':').collect();
            cost_details = k[0];
            if k.len() > 1 && k[1] == "Commander" {
                self.commander = true;
            }
        }
        self.inner.parse(cost_details);
    }

    /// Format reminder text.
    pub fn format_reminder_text(&self, reminder_text: &str) -> String {
        let zone = if self.commander {
            "hand or the command zone"
        } else {
            "hand"
        };
        reminder_text
            .replace("%s", &self.inner.cost_string)
            .replace("%1$s", &self.inner.cost_string)
            .replace("%2$s", zone)
    }

    /// Get the display title.
    pub fn get_title(&self) -> String {
        self.inner.get_title()
    }
}
