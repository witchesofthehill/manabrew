//! DetachedCardEffect — card effect data structure.
//!
//! Mirrors Java's `DetachedCardEffect.java`.
//! Represents an effect that acts as its own card instead of being attached
//! to a card. Examples include Commander Effects and Emblem effects.

use crate::ids::{CardId, PlayerId};

/// A detached card effect — an effect card that is not attached to
/// any permanent but acts independently (e.g., commander zone effects, emblems).
#[derive(Debug, Clone)]
pub struct DetachedCardEffect {
    /// The ID of this effect "card" in the game state.
    pub id: CardId,
    /// The card this effect is linked to (if any).
    pub linked_card: Option<CardId>,
    /// The owner/controller of this effect.
    pub owner: PlayerId,
    /// Display name for this effect.
    pub name: String,
}

impl DetachedCardEffect {
    /// Create a new detached card effect linked to a source card.
    pub fn new(id: CardId, linked_card: CardId, owner: PlayerId, name: String) -> Self {
        Self {
            id,
            linked_card: Some(linked_card),
            owner,
            name,
        }
    }

    /// Create a new detached card effect with no linked card.
    pub fn new_unlinked(id: CardId, owner: PlayerId, name: String) -> Self {
        Self {
            id,
            linked_card: None,
            owner,
            name,
        }
    }

    /// Get the card to display in the UI (the linked card, if any).
    pub fn card_for_ui(&self) -> Option<CardId> {
        self.linked_card
    }
}
