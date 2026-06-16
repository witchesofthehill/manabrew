//! Zone module — game zones for cards.
//!
//! Mirrors Java's `forge.game.zone` package.

pub mod cost_payment_stack;
pub mod magic_stack;
pub mod player_zone;
pub mod player_zone_battlefield;
pub mod zone_store;
pub mod zone_type;

use forge_foundation::ZoneType;
use serde::{Deserialize, Serialize};

use crate::ids::{CardId, PlayerId};

// Re-exports
pub use cost_payment_stack::CostPaymentStack;
pub use player_zone::PlayerZone;
pub use player_zone_battlefield::PlayerZoneBattlefield;
pub use zone_store::ZoneStore;

/// A game zone owned by a specific player.
/// Each player has their own Hand, Library, Graveyard, etc.
/// Battlefield and Stack are shared but cards still track their controller.
///
/// Mirrors Java's `Zone.java`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Zone {
    pub zone_type: ZoneType,
    pub owner: PlayerId,
    pub cards: Vec<CardId>,
    /// Cards added this turn, keyed by their origin zone.
    #[serde(skip)]
    pub cards_added_this_turn: Vec<(ZoneType, CardId)>,
    /// Cards added last turn, keyed by their origin zone.
    #[serde(skip)]
    pub cards_added_last_turn: Vec<(ZoneType, CardId)>,

    // ── Battlefield-specific fields (mirrors Java's PlayerZoneBattlefield) ──
    /// Cards that have been melded (combined into a single permanent).
    /// Only meaningful when `zone_type == Battlefield`.
    #[serde(default)]
    pub melded_cards: Vec<CardId>,

    /// Whether entering-the-battlefield triggers are active.
    /// Mirrors Java's `PlayerZoneBattlefield.trigger` field.
    /// Only meaningful when `zone_type == Battlefield`.
    #[serde(default)]
    pub triggers_enabled: bool,
}

impl Zone {
    pub fn new(zone_type: ZoneType, owner: PlayerId) -> Self {
        Zone {
            zone_type,
            owner,
            cards: Vec::new(),
            cards_added_this_turn: Vec::new(),
            cards_added_last_turn: Vec::new(),
            melded_cards: Vec::new(),
            triggers_enabled: zone_type == ZoneType::Battlefield,
        }
    }

    pub fn add(&mut self, card: CardId) {
        self.cards.push(card);
    }

    pub fn add_to_top(&mut self, card: CardId) {
        self.cards.push(card);
    }

    pub fn add_to_bottom(&mut self, card: CardId) {
        self.cards.insert(0, card);
    }

    pub fn remove(&mut self, card: CardId) -> bool {
        if let Some(pos) = self.cards.iter().position(|&c| c == card) {
            self.cards.remove(pos);
            true
        } else {
            false
        }
    }

    /// Remove all cards from the zone.
    /// Mirrors Java's `Zone.removeAllCards()`.
    pub fn remove_all_cards(&mut self) {
        self.cards.clear();
    }

    /// Reorder a card to a specific index.
    /// Mirrors Java's `Zone.reorder()`.
    pub fn reorder(&mut self, card: CardId, index: usize) {
        if let Some(pos) = self.cards.iter().position(|&c| c == card) {
            self.cards.remove(pos);
            let idx = index.min(self.cards.len());
            self.cards.insert(idx, card);
        }
    }

    pub fn contains(&self, card: CardId) -> bool {
        self.cards.contains(&card)
    }

    /// Check if this zone is the given type.
    /// Mirrors Java's `Zone.is()`.
    pub fn is(&self, zone_type: ZoneType) -> bool {
        self.zone_type == zone_type
    }

    /// Number of cards in the zone.
    /// Mirrors Java's `Zone.size()`.
    pub fn size(&self) -> usize {
        self.cards.len()
    }

    pub fn len(&self) -> usize {
        self.cards.len()
    }

    pub fn is_empty(&self) -> bool {
        self.cards.is_empty()
    }

    /// Get the card at the given index.
    /// Mirrors Java's `Zone.get()`.
    pub fn get(&self, index: usize) -> Option<CardId> {
        self.cards.get(index).copied()
    }

    /// Take the top card (last element = top of library).
    pub fn take_top(&mut self) -> Option<CardId> {
        self.cards.pop()
    }

    /// Peek at the top card without removing it.
    pub fn peek_top(&self) -> Option<CardId> {
        self.cards.last().copied()
    }

    /// Reset turn tracking: move this-turn data to last-turn.
    /// Mirrors Java's `Zone.resetCardsAddedThisTurn()`.
    pub fn reset_cards_added_this_turn(&mut self) {
        self.cards_added_last_turn = std::mem::take(&mut self.cards_added_this_turn);
    }

    /// Provides an iterator over the cards in this zone.
    /// Mirrors Java's `Zone.iterator()`.
    pub fn iterator(&self) -> impl Iterator<Item = &CardId> {
        self.cards.iter()
    }

    /// Shuffle the cards in this zone using the provided RNG.
    /// Mirrors Java's `Zone.shuffle()`.
    ///
    /// All game randomness must flow through the game's RNG for
    /// deterministic replay and parity testing.
    pub fn shuffle(&mut self, rng: &mut dyn crate::game_rng::GameRng) {
        rng.shuffle_cards(&mut self.cards);
    }

    // ── Battlefield-specific methods ────────────────────────────────

    /// Add a card to the melded cards list.
    /// Mirrors Java's `PlayerZoneBattlefield.addToMelded()`.
    pub fn add_to_melded(&mut self, card: CardId) {
        self.melded_cards.push(card);
    }

    /// Remove a card from the melded cards list.
    /// Mirrors Java's `PlayerZoneBattlefield.removeFromMelded()`.
    pub fn remove_from_melded(&mut self, card: CardId) {
        if let Some(pos) = self.melded_cards.iter().position(|&c| c == card) {
            self.melded_cards.remove(pos);
        }
    }

    // ── LKI tracking ────────────────────────────────────────────────

    /// Get the cards in this zone.
    /// The `_filter` parameter is ignored for non-battlefield zones (they always
    /// return the full list). Battlefield filtering is handled by
    /// `PlayerZoneBattlefield::get_cards()`.
    /// Mirrors Java's `Zone.getCards(boolean)`.
    pub fn get_cards(&self, _filter: bool) -> &[CardId] {
        &self.cards
    }

    /// Get cards that were added to this zone this turn from the given origin zone.
    /// Mirrors Java's `Zone.getCardsAddedThisTurn(ZoneType)`.
    pub fn get_cards_added_this_turn(&self, origin: ZoneType) -> Vec<CardId> {
        self.cards_added_this_turn
            .iter()
            .filter(|(z, _)| *z == origin)
            .map(|(_, c)| *c)
            .collect()
    }

    /// Get cards that were added to this zone last turn from the given origin zone.
    /// Mirrors Java's `Zone.getCardsAddedLastTurn(ZoneType)`.
    pub fn get_cards_added_last_turn(&self, origin: ZoneType) -> Vec<CardId> {
        self.cards_added_last_turn
            .iter()
            .filter(|(z, _)| *z == origin)
            .map(|(_, c)| *c)
            .collect()
    }

    /// Check whether a specific card was added to this zone this turn from
    /// the given origin zone.
    /// Mirrors Java's `Zone.isCardAddedThisTurn(Card, ZoneType)`.
    pub fn is_card_added_this_turn(&self, card: CardId, origin: ZoneType) -> bool {
        self.cards_added_this_turn
            .iter()
            .any(|(z, c)| *z == origin && *c == card)
    }

    /// Create a shallow copy of this zone for last-known-information purposes.
    /// The returned zone has the same type, owner, and card list.
    /// Mirrors Java's `Zone.getLKICopy()`.
    pub fn get_lki_copy(&self) -> Zone {
        Zone {
            zone_type: self.zone_type,
            owner: self.owner,
            cards: self.cards.clone(),
            cards_added_this_turn: Vec::new(),
            cards_added_last_turn: Vec::new(),
            melded_cards: Vec::new(),
            triggers_enabled: self.triggers_enabled,
        }
    }

    /// Save last-known-information for a card entering this zone.
    /// Mirrors Java's `Zone.saveLKI()`.
    pub fn save_lki(&mut self, card: CardId, origin_zone: ZoneType) {
        if origin_zone == self.zone_type {
            return;
        }
        self.cards_added_this_turn.push((origin_zone, card));
    }
}

/// Key for looking up a zone: (zone_type, owner).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ZoneKey {
    pub zone_type: ZoneType,
    pub owner: PlayerId,
}

impl ZoneKey {
    pub fn new(zone_type: ZoneType, owner: PlayerId) -> Self {
        ZoneKey { zone_type, owner }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zone_add_remove() {
        let mut z = Zone::new(ZoneType::Hand, PlayerId(0));
        z.add(CardId(1));
        z.add(CardId(2));
        assert_eq!(z.size(), 2);
        assert!(z.contains(CardId(1)));
        z.remove(CardId(1));
        assert_eq!(z.size(), 1);
        assert!(!z.contains(CardId(1)));
    }

    #[test]
    fn zone_reorder() {
        let mut z = Zone::new(ZoneType::Library, PlayerId(0));
        z.add(CardId(1));
        z.add(CardId(2));
        z.add(CardId(3));
        z.reorder(CardId(3), 0);
        assert_eq!(z.get(0), Some(CardId(3)));
    }

    #[test]
    fn zone_is() {
        let z = Zone::new(ZoneType::Graveyard, PlayerId(0));
        assert!(z.is(ZoneType::Graveyard));
        assert!(!z.is(ZoneType::Hand));
    }

    #[test]
    fn reset_cards_added() {
        let mut z = Zone::new(ZoneType::Battlefield, PlayerId(0));
        z.save_lki(CardId(1), ZoneType::Hand);
        assert_eq!(z.cards_added_this_turn.len(), 1);
        z.reset_cards_added_this_turn();
        assert!(z.cards_added_this_turn.is_empty());
        assert_eq!(z.cards_added_last_turn.len(), 1);
    }
}
