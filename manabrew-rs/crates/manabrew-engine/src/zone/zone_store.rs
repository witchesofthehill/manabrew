use forge_foundation::ZoneType;

use crate::game_rng::GameRng;
use crate::ids::{CardId, PlayerId};

use super::{Zone, ZoneKey};

/// Zones allocated for each player at game creation.
///
/// This intentionally mirrors the previous `GameState::new` zone list. Zones
/// outside this set, including `ZoneType::None`, are not stored zones and keep
/// the old "Zone not found" behavior when accessed through `GameState::zone`.
pub const STORED_ZONE_TYPES: [ZoneType; 16] = [
    ZoneType::Hand,
    ZoneType::Library,
    ZoneType::Graveyard,
    ZoneType::Battlefield,
    ZoneType::Exile,
    ZoneType::Command,
    ZoneType::Sideboard,
    ZoneType::SchemeDeck,
    ZoneType::PlanarDeck,
    ZoneType::AttractionDeck,
    ZoneType::ContraptionDeck,
    ZoneType::Junkyard,
    ZoneType::Ante,
    ZoneType::ExtraHand,
    ZoneType::Subgame,
    ZoneType::Stack,
];

/// Fixed-index store for per-player zones.
///
/// The old representation was `HashMap<ZoneKey, Zone>`. Most callers already
/// route through `GameState::zone`, `zone_mut`, and `cards_in_zone`, so this
/// store preserves that API while avoiding hash lookup on hot zone access.
#[derive(Debug, Clone, Default)]
pub struct ZoneStore {
    zones: Vec<Zone>,
    card_locations: Vec<Option<ZoneKey>>,
    player_count: usize,
}

impl ZoneStore {
    pub fn new(players: &[PlayerId]) -> Self {
        let mut zones = Vec::with_capacity(players.len() * STORED_ZONE_TYPES.len());
        for &pid in players {
            for &zone_type in &STORED_ZONE_TYPES {
                zones.push(Zone::new(zone_type, pid));
            }
        }
        Self {
            zones,
            card_locations: Vec::new(),
            player_count: players.len(),
        }
    }

    pub fn get(&self, zone_type: ZoneType, owner: PlayerId) -> Option<&Zone> {
        self.index(zone_type, owner)
            .and_then(|index| self.zones.get(index))
    }

    pub fn get_mut(&mut self, zone_type: ZoneType, owner: PlayerId) -> Option<&mut Zone> {
        self.index(zone_type, owner)
            .and_then(|index| self.zones.get_mut(index))
    }

    pub fn remove_card(&mut self, zone_type: ZoneType, owner: PlayerId, card: CardId) -> bool {
        let removed = self
            .get_mut(zone_type, owner)
            .expect("Zone not found")
            .remove(card);
        if removed {
            self.clear_card_location(card, zone_type, owner);
        }
        removed
    }

    pub fn add_card_to_top(&mut self, zone_type: ZoneType, owner: PlayerId, card: CardId) {
        self.get_mut(zone_type, owner)
            .expect("Zone not found")
            .add_to_top(card);
        self.set_card_location(card, zone_type, owner);
    }

    pub fn add_card_to_bottom(&mut self, zone_type: ZoneType, owner: PlayerId, card: CardId) {
        self.get_mut(zone_type, owner)
            .expect("Zone not found")
            .add_to_bottom(card);
        self.set_card_location(card, zone_type, owner);
    }

    pub fn take_top_card(&mut self, zone_type: ZoneType, owner: PlayerId) -> Option<CardId> {
        let card = self
            .get_mut(zone_type, owner)
            .expect("Zone not found")
            .take_top()?;
        self.clear_card_location(card, zone_type, owner);
        Some(card)
    }

    pub fn reorder_card(
        &mut self,
        zone_type: ZoneType,
        owner: PlayerId,
        card: CardId,
        index: usize,
    ) {
        self.get_mut(zone_type, owner)
            .expect("Zone not found")
            .reorder(card, index);
    }

    pub fn move_cards_to_top(&mut self, zone_type: ZoneType, owner: PlayerId, cards: &[CardId]) {
        let zone = self.get_mut(zone_type, owner).expect("Zone not found");
        for card in cards {
            if let Some(pos) = zone.cards.iter().position(|&c| c == *card) {
                zone.cards.remove(pos);
            }
        }
        for card in cards {
            zone.cards.push(*card);
        }
    }

    pub fn move_cards_to_bottom(&mut self, zone_type: ZoneType, owner: PlayerId, cards: &[CardId]) {
        let zone = self.get_mut(zone_type, owner).expect("Zone not found");
        for card in cards {
            if let Some(pos) = zone.cards.iter().position(|&c| c == *card) {
                zone.cards.remove(pos);
            }
        }
        for card in cards.iter().rev() {
            zone.cards.insert(0, *card);
        }
    }

    pub fn replace_cards(&mut self, zone_type: ZoneType, owner: PlayerId, cards: Vec<CardId>) {
        let previous = {
            let zone = self.get_mut(zone_type, owner).expect("Zone not found");
            std::mem::replace(&mut zone.cards, cards)
        };
        for card in previous {
            self.clear_card_location(card, zone_type, owner);
        }
        let current = self
            .get(zone_type, owner)
            .expect("Zone not found")
            .cards
            .clone();
        for card in current {
            self.set_card_location(card, zone_type, owner);
        }
    }

    pub fn shuffle_cards(&mut self, zone_type: ZoneType, owner: PlayerId, rng: &mut dyn GameRng) {
        self.get_mut(zone_type, owner)
            .expect("Zone not found")
            .shuffle(rng);
    }

    pub fn shuffle_cards_with_rand<R: rand::Rng + ?Sized>(
        &mut self,
        zone_type: ZoneType,
        owner: PlayerId,
        rng: &mut R,
    ) {
        use rand::seq::SliceRandom;

        self.get_mut(zone_type, owner)
            .expect("Zone not found")
            .cards
            .shuffle(rng);
    }

    pub fn save_lki(&mut self, zone_type: ZoneType, owner: PlayerId, card: CardId, from: ZoneType) {
        self.get_mut(zone_type, owner)
            .expect("Zone not found")
            .save_lki(card, from);
    }

    pub fn card_location(&self, card: CardId) -> Option<ZoneKey> {
        self.card_locations.get(card.index()).copied().flatten()
    }

    pub fn values_mut(&mut self) -> impl Iterator<Item = &mut Zone> {
        self.zones.iter_mut()
    }

    pub fn iter(&self) -> impl Iterator<Item = (ZoneKey, &Zone)> {
        self.zones
            .iter()
            .map(|zone| (ZoneKey::new(zone.zone_type, zone.owner), zone))
    }

    pub fn len(&self) -> usize {
        self.zones.len()
    }

    pub fn is_empty(&self) -> bool {
        self.zones.is_empty()
    }

    fn index(&self, zone_type: ZoneType, owner: PlayerId) -> Option<usize> {
        if owner.index() >= self.player_count {
            return None;
        }
        let zone_index = stored_zone_index(zone_type)?;
        Some(owner.index() * STORED_ZONE_TYPES.len() + zone_index)
    }

    fn set_card_location(&mut self, card: CardId, zone_type: ZoneType, owner: PlayerId) {
        self.ensure_card_location_slot(card);
        self.card_locations[card.index()] = Some(ZoneKey::new(zone_type, owner));
    }

    fn clear_card_location(&mut self, card: CardId, zone_type: ZoneType, owner: PlayerId) {
        let Some(slot) = self.card_locations.get_mut(card.index()) else {
            return;
        };
        if *slot == Some(ZoneKey::new(zone_type, owner)) {
            *slot = None;
        }
    }

    fn ensure_card_location_slot(&mut self, card: CardId) {
        let len = card.index() + 1;
        if self.card_locations.len() < len {
            self.card_locations.resize(len, None);
        }
    }
}

fn stored_zone_index(zone_type: ZoneType) -> Option<usize> {
    match zone_type {
        ZoneType::Hand => Some(0),
        ZoneType::Library => Some(1),
        ZoneType::Graveyard => Some(2),
        ZoneType::Battlefield => Some(3),
        ZoneType::Exile => Some(4),
        ZoneType::Command => Some(5),
        ZoneType::Sideboard => Some(6),
        ZoneType::SchemeDeck => Some(7),
        ZoneType::PlanarDeck => Some(8),
        ZoneType::AttractionDeck => Some(9),
        ZoneType::ContraptionDeck => Some(10),
        ZoneType::Junkyard => Some(11),
        ZoneType::Ante => Some(12),
        ZoneType::ExtraHand => Some(13),
        ZoneType::Subgame => Some(14),
        ZoneType::Stack => Some(15),
        ZoneType::Flashback | ZoneType::Merged | ZoneType::None => None,
    }
}
