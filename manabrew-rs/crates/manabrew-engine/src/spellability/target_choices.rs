//! Target choices for spell abilities.
//!
//! Mirrors Java's `spellability/TargetChoices.java` — a container holding
//! the actual selected targets for a spell ability.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::ids::{CardId, PlayerId};

/// Targets chosen for a single ability in the SubAbility chain.
/// Mirrors Java's `TargetChoices` which holds selected targets (cards, players, stack entries).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TargetChoices {
    pub target_player: Option<PlayerId>,
    #[serde(default)]
    pub additional_target_players: Vec<PlayerId>,
    pub target_card: Option<CardId>,
    /// Zone timestamp captured when `target_card` was chosen.
    /// Used to preserve object identity across zone changes (CR 400.7).
    #[serde(default)]
    pub target_card_zone_timestamp: Option<u64>,
    /// ID of a targeted stack entry (for Counter effects).
    pub target_stack_entry: Option<u32>,
    /// Divided damage/effect allocation per target card.
    /// Mirrors Java's `TargetChoices.dividedMap`.
    #[serde(skip)]
    pub divided_map: HashMap<CardId, i32>,
}

impl TargetChoices {
    /// Collect all targeted players for this node.
    pub fn all_target_players(&self) -> Vec<PlayerId> {
        let mut players = Vec::new();
        if let Some(player) = self.target_player {
            players.push(player);
        }
        for &player in &self.additional_target_players {
            if !players.contains(&player) {
                players.push(player);
            }
        }
        players
    }

    /// Collect all targeted cards for this node.
    pub fn all_target_cards(&self) -> Vec<CardId> {
        let mut cards = Vec::new();
        if let Some(card) = self.target_card {
            cards.push(card);
        }
        for &card in self.divided_map.keys() {
            if !cards.contains(&card) {
                cards.push(card);
            }
        }
        cards
    }

    /// Add a target (card and/or player).
    /// Mirrors Java's `TargetChoices.add(GameObject)`.
    pub fn add(&mut self, target_card: Option<CardId>, target_player: Option<PlayerId>) {
        if let Some(card) = target_card {
            self.target_card = Some(card);
            // Caller can override with the actual captured timestamp if available.
            self.target_card_zone_timestamp = None;
        }
        if let Some(player) = target_player {
            if self.target_player.is_none() {
                self.target_player = Some(player);
            } else if self.target_player != Some(player)
                && !self.additional_target_players.contains(&player)
            {
                self.additional_target_players.push(player);
            }
        }
    }

    /// Remove a card target.
    /// Mirrors Java's `TargetChoices.remove(Card)`.
    pub fn remove(&mut self, card: CardId) {
        if self.target_card == Some(card) {
            self.target_card = None;
            self.target_card_zone_timestamp = None;
        }
        self.divided_map.remove(&card);
    }

    /// Clear all targets.
    /// Mirrors Java's `TargetChoices.removeAll()`.
    pub fn remove_all(&mut self) {
        self.target_card = None;
        self.target_card_zone_timestamp = None;
        self.target_player = None;
        self.additional_target_players.clear();
        self.target_stack_entry = None;
        self.divided_map.clear();
    }

    /// Check if a card is targeted.
    /// Mirrors Java's `TargetChoices.contains(Card)`.
    pub fn contains(&self, card: CardId) -> bool {
        self.target_card == Some(card) || self.divided_map.contains_key(&card)
    }

    /// Replace one card target with another.
    /// Mirrors Java's `TargetChoices.replaceTargetCard(Card, Card)`.
    pub fn replace_target_card(&mut self, old: CardId, new: CardId) {
        if self.target_card == Some(old) {
            self.target_card = Some(new);
            self.target_card_zone_timestamp = None;
            // Move divided allocation if present
            if let Some(amount) = self.divided_map.remove(&old) {
                self.divided_map.insert(new, amount);
            }
        } else if let Some(amount) = self.divided_map.remove(&old) {
            self.divided_map.insert(new, amount);
        }
    }

    /// Returns controllers that changed for targeted cards.
    /// Mirrors Java's `TargetChoices.forEachControllerChanged()`.
    /// Currently returns an empty vec since controller-change tracking
    /// is handled at the game state level.
    pub fn for_each_controller_changed(&self) -> Vec<PlayerId> {
        Vec::new()
    }

    /// Add a divided damage/effect allocation for a target card.
    /// Mirrors Java's `TargetChoices.addDividedAllocation(Card, int)`.
    pub fn add_divided_allocation(&mut self, card: CardId, amount: i32) {
        self.divided_map.insert(card, amount);
    }

    /// Clone this target choices.
    /// Mirrors Java's `TargetChoices.copy()`.
    pub fn copy(&self) -> Self {
        self.clone()
    }
}
