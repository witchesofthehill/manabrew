use crate::ids::CardId;

use super::card_collection_view::CardCollectionView;

/// Card id collection utility mirroring Java's `CardCollection`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CardCollection {
    cards: Vec<CardId>,
}

impl CardCollection {
    pub const EMPTY: Self = Self { cards: Vec::new() };

    pub fn new() -> Self {
        Self { cards: Vec::new() }
    }

    pub fn push(&mut self, card: CardId) {
        self.cards.push(card);
    }

    pub fn extend<I: IntoIterator<Item = CardId>>(&mut self, iter: I) {
        self.cards.extend(iter);
    }

    pub fn iter(&self) -> impl Iterator<Item = &CardId> {
        self.cards.iter()
    }

    /// Combine multiple views preserving their view order and card order.
    pub fn combine(views: &[&dyn CardCollectionView]) -> CardCollection {
        let mut out = CardCollection::new();
        for v in views {
            if v.is_empty() {
                continue;
            }
            out.extend(v.as_slice().iter().copied());
        }
        out
    }

    /// Return a shallow-copy sub-list in `[from_index, to_index)`.
    pub fn sub_list(&self, from_index: usize, to_index: usize) -> CardCollection {
        let end = to_index.min(self.cards.len());
        let start = from_index.min(end);
        CardCollection::from_iter(self.cards[start..end].iter().copied())
    }

    /// Return a filtered copy of this collection.
    pub fn filter<F>(&self, test: F) -> CardCollection
    where
        F: Fn(&CardId) -> bool,
    {
        CardCollection::from_iter(self.cards.iter().copied().filter(test))
    }
}

impl FromIterator<CardId> for CardCollection {
    fn from_iter<I: IntoIterator<Item = CardId>>(iter: I) -> Self {
        Self {
            cards: iter.into_iter().collect(),
        }
    }
}

impl CardCollectionView for CardCollection {
    fn is_empty(&self) -> bool {
        self.cards.is_empty()
    }

    fn len(&self) -> usize {
        self.cards.len()
    }

    fn as_slice(&self) -> &[CardId] {
        &self.cards
    }
}
