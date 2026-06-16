//! IllegalAbilityException — error type for invalid abilities.
//!
//! Mirrors Java's `IllegalAbilityException.java`.

use std::fmt;

/// Error raised when an ability cannot be resolved or is malformed.
#[derive(Debug, Clone)]
pub struct IllegalAbilityException {
    pub message: String,
}

impl IllegalAbilityException {
    /// Create from a descriptive message.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    /// Create from a spell ability description and effect name.
    pub fn with_effect(sa_desc: &str, effect_name: &str) -> Self {
        Self {
            message: format!("{} (effect {})", sa_desc, effect_name),
        }
    }
}

impl fmt::Display for IllegalAbilityException {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "IllegalAbilityException: {}", self.message)
    }
}

impl std::error::Error for IllegalAbilityException {}
