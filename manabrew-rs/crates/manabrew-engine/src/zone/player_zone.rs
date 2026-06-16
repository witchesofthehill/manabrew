//! PlayerZone — a zone owned by a specific player.
//!
//! Mirrors Java's `PlayerZone.java`.
//! Extends Zone with player ownership and activation filtering.

use forge_foundation::ZoneType;

use crate::ids::{CardId, PlayerId};

use super::Zone;

/// A zone owned by a specific player.
/// Mirrors Java's `PlayerZone` which extends `Zone`.
///
/// In Rust, we use composition rather than inheritance:
/// `PlayerZone` wraps a `Zone` and adds player-specific behavior.
///
/// Note: The engine's `GameState` stores zones as `HashMap<ZoneKey, Zone>`.
/// `PlayerZone` provides the ported Java API for zone-level card filtering;
/// callers that need card-state filtering (keywords, may-play) should use
/// `GameState` methods which have access to `CardInstance` data.
#[derive(Debug, Clone)]
pub struct PlayerZone {
    pub zone: Zone,
    pub player: PlayerId,
}

impl PlayerZone {
    pub fn new(zone_type: ZoneType, player: PlayerId) -> Self {
        PlayerZone {
            zone: Zone::new(zone_type, player),
            player,
        }
    }

    pub fn get_player(&self) -> PlayerId {
        self.player
    }

    /// Test whether a card in this zone passes a containment check.
    /// Mirrors Java's inner `OwnCardsActivationFilter.test()`.
    pub fn test(&self, card: CardId) -> bool {
        self.zone.contains(card)
    }

    /// Get cards the given player can potentially activate from this zone.
    /// Mirrors Java's `PlayerZone.getCardsPlayerCanActivate()`.
    ///
    /// This performs zone-level filtering:
    /// - Battlefield/Hand: owner sees all their cards
    /// - Library: only the top card is visible
    /// - Other zones: all cards returned (card-level keyword filtering
    ///   like Flashback/Retrace requires `GameState` access)
    pub fn get_cards_player_can_activate(&self, who: PlayerId) -> Vec<CardId> {
        let is_owner = who == self.player;
        let zone_type = self.zone.zone_type;

        // Battlefield and Hand: owner can activate everything
        if is_owner && (zone_type == ZoneType::Battlefield || zone_type == ZoneType::Hand) {
            return self.zone.cards.clone();
        }

        // Library: only the top card is accessible
        if zone_type == ZoneType::Library {
            return self.zone.cards.last().copied().into_iter().collect();
        }

        // Graveyard/Exile/Command: return all (card-level filtering needs GameState)
        self.zone.cards.clone()
    }
}

impl std::ops::Deref for PlayerZone {
    type Target = Zone;
    fn deref(&self) -> &Zone {
        &self.zone
    }
}

impl std::ops::DerefMut for PlayerZone {
    fn deref_mut(&mut self) -> &mut Zone {
        &mut self.zone
    }
}
