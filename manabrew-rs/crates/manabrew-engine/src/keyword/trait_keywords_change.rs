//! Interface for keyword changes.
//!
//! Ported from Java's `IKeywordsChange.java` in `forge/game/keyword/`.

use super::keyword_collection::KeywordCollection;

/// Trait for objects that can apply keyword changes to a collection.
/// Mirrors Java's `IKeywordsChange` interface.
pub trait KeywordsChange: KeywordsChangeClone {
    /// Apply this change to a keyword collection.
    fn apply_keywords(&self, list: &mut KeywordCollection);

    /// Create a deep copy of this keywords change.
    /// Mirrors Java's `IKeywordsChange.copy(Card, boolean)`.
    fn copy(&self) -> Box<dyn KeywordsChange>;
}

/// Helper trait for cloning boxed `KeywordsChange` trait objects.
pub trait KeywordsChangeClone {
    fn clone_box(&self) -> Box<dyn KeywordsChange>;
}

impl<T: 'static + KeywordsChange + Clone> KeywordsChangeClone for T {
    fn clone_box(&self) -> Box<dyn KeywordsChange> {
        Box::new(self.clone())
    }
}

impl Clone for Box<dyn KeywordsChange> {
    fn clone(&self) -> Self {
        self.clone_box()
    }
}
