//! PlayerZoneBattlefield — battlefield zone with phasing filter and meld support.
//!
//! Mirrors Java's `PlayerZoneBattlefield.java`.

use forge_foundation::ZoneType;

use crate::game::GameState;
use crate::ids::{CardId, PlayerId};

use super::player_zone::PlayerZone;

/// The battlefield zone for a player, with support for melded cards
/// and phased-out card filtering.
/// Mirrors Java's `PlayerZoneBattlefield` which extends `PlayerZone`.
#[derive(Debug, Clone)]
pub struct PlayerZoneBattlefield {
    pub zone: PlayerZone,
    /// Cards that have been melded (combined into a single permanent).
    melded_cards: Vec<CardId>,
    /// Whether entering-the-battlefield triggers are active.
    trigger: bool,
}

impl PlayerZoneBattlefield {
    pub fn new(player: PlayerId) -> Self {
        PlayerZoneBattlefield {
            zone: PlayerZone::new(ZoneType::Battlefield, player),
            melded_cards: Vec::new(),
            trigger: true,
        }
    }

    /// Add a card to the battlefield zone.
    /// Mirrors Java's `PlayerZoneBattlefield.add()` which sets summoning sickness.
    pub fn add(&mut self, card: CardId) {
        self.zone.zone.add(card);
    }

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

    /// Get the melded cards.
    /// Mirrors Java's `PlayerZoneBattlefield.getMeldedCards()`.
    pub fn get_melded_cards(&self) -> &[CardId] {
        &self.melded_cards
    }

    /// Enable or disable entering-the-battlefield triggers.
    /// Mirrors Java's `PlayerZoneBattlefield.setTriggers()`.
    pub fn set_triggers(&mut self, enabled: bool) {
        self.trigger = enabled;
    }

    pub fn triggers_enabled(&self) -> bool {
        self.trigger
    }

    /// Get the cards on the battlefield, optionally filtering out phased-out cards.
    /// When `filter` is true, phased-out permanents are excluded.
    /// Mirrors Java's `PlayerZoneBattlefield.getCards(boolean)`.
    pub fn get_cards(&self, filter: bool, game: &GameState) -> Vec<CardId> {
        let cards = &self.zone.zone.cards;
        if !filter {
            return cards.clone();
        }
        // Check if any card is phased out before allocating a filtered list
        let has_phased = cards.iter().any(|&c| game.card(c).phased_out);
        if !has_phased {
            return cards.clone();
        }
        cards
            .iter()
            .copied()
            .filter(|&c| !game.card(c).phased_out)
            .collect()
    }
}

impl std::ops::Deref for PlayerZoneBattlefield {
    type Target = PlayerZone;
    fn deref(&self) -> &PlayerZone {
        &self.zone
    }
}

impl std::ops::DerefMut for PlayerZoneBattlefield {
    fn deref_mut(&mut self) -> &mut PlayerZone {
        &mut self.zone
    }
}
