//! Interface for keywords that have a type parameter.
//!
//! Ported from Java's `KeywordWithTypeInterface.java` in `forge/game/keyword/`.

/// Trait for keywords that reference a type (e.g. Protection from red, Landwalk).
/// Mirrors Java's `KeywordWithTypeInterface`.
pub trait KeywordWithTypeTrait {
    /// Get the valid type string used for game logic matching.
    fn get_valid_type(&self) -> &str;

    /// Get the human-readable type description.
    fn get_type_description(&self) -> &str;
}
