use crate::ids::CardId;
use serde::{Deserialize, Serialize};

/// View representation of a static ability for UI display.
/// Mirrors Java's `StaticAbilityView`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StaticAbilityView {
    pub host_card: Option<CardId>,
    pub description: String,
}

impl StaticAbilityView {
    pub fn new(host_card: Option<CardId>, description: String) -> Self {
        Self {
            host_card,
            description,
        }
    }

    pub fn get_host_card(&self) -> Option<CardId> {
        self.host_card
    }

    pub fn get_description(&self) -> &str {
        &self.description
    }
}

impl std::fmt::Display for StaticAbilityView {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.description)
    }
}
