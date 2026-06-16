use forge_foundation::ZoneType;

use crate::ids::{CardId, PlayerId};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DelayedReveal {
    pub cards: Vec<CardId>,
    pub owner: Option<PlayerId>,
    pub zone: Vec<ZoneType>,
    pub message_prefix: Option<String>,
}

impl DelayedReveal {
    pub fn for_zone(cards: Vec<CardId>, owner: PlayerId, zone: ZoneType) -> Self {
        Self {
            cards,
            owner: Some(owner),
            zone: vec![zone],
            message_prefix: None,
        }
    }

    pub fn remove(&mut self, card_id: CardId) -> bool {
        let before = self.cards.len();
        self.cards.retain(|&cid| cid != card_id);
        before != self.cards.len()
    }
}
