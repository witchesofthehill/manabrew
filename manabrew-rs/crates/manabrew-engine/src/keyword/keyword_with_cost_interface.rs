//! Interface for keywords that have an associated cost.
//!
//! Ported from Java's `KeywordWithCostInterface.java` in `forge/game/keyword/`.

/// Trait for keywords that have an associated cost.
/// Mirrors Java's `KeywordWithCostInterface`.
pub trait KeywordWithCostTrait {
    /// Get the cost string.
    fn get_cost_string(&self) -> &str;

    /// Get the title without the cost portion.
    fn get_title_without_cost(&self) -> String;
}
