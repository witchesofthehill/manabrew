use serde::{Deserialize, Serialize};
use strum_macros::{Display, EnumString};

/// Counter types commonly used in MTG.
/// Note: `Copy` is intentionally absent because the `Named(String)` variant
/// holds heap-allocated data. Use `.clone()` when an owned copy is needed.
#[derive(
    Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, EnumString, Display,
)]
pub enum CounterType {
    P1P1,
    M1M1,
    Poison,
    Loyalty,
    Charge,
    Quest,
    Study,
    Age,
    Fade,
    Time,
    Depletion,
    Storage,
    Mining,
    Brick,
    Level,
    Lore,
    Page,
    Dream,
    /// Catch-all for counter types not in the enum (e.g. SUPPLY, VERSE, LUCK).
    /// Stored as uppercase name for consistent comparison.
    Named(String),
}

/// Parse a counter type string to CounterType enum (case-insensitive).
/// Unknown types produce `CounterType::Named(UPPER)` instead of silently
/// falling back to P1P1, so cards like Stocking the Pantry get the correct
/// SUPPLY counters.
pub fn parse_counter_type(s: &str) -> CounterType {
    match s.to_uppercase().as_str() {
        "P1P1" | "+1/+1" => CounterType::P1P1,
        "M1M1" | "-1/-1" => CounterType::M1M1,
        "LOYALTY" => CounterType::Loyalty,
        "CHARGE" => CounterType::Charge,
        "QUEST" => CounterType::Quest,
        "STUDY" => CounterType::Study,
        "AGE" => CounterType::Age,
        "FADE" => CounterType::Fade,
        "TIME" => CounterType::Time,
        "DEPLETION" => CounterType::Depletion,
        "STORAGE" => CounterType::Storage,
        "MINING" => CounterType::Mining,
        "BRICK" => CounterType::Brick,
        "LEVEL" => CounterType::Level,
        "LORE" => CounterType::Lore,
        "PAGE" => CounterType::Page,
        "DREAM" => CounterType::Dream,
        other => CounterType::Named(other.to_string()),
    }
}

impl CounterType {
    /// Java parity helper for interface-style checks.
    pub fn is(&self, other: &CounterType) -> bool {
        self == other
    }

    /// Java parity helper for "keyword counter" classification.
    pub fn is_keyword_counter(&self) -> bool {
        matches!(self, CounterType::Named(_))
    }
}
