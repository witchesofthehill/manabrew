use crate::ids::CardId;

/// Lightweight collection view for card ids.
/// Mirrors Java's marker interface `CardCollectionView`.
pub trait CardCollectionView {
    fn is_empty(&self) -> bool;
    fn len(&self) -> usize;
    fn as_slice(&self) -> &[CardId];
}
