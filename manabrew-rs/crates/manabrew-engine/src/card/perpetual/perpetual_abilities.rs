//! Java-parity perpetual abilities applicator.

use crate::card::card_trait_changes::CardTraitChanges;
use crate::card::perpetual::perpetual_interface::PerpetualInterface;
use crate::card::perpetual::perpetual_record::PerpetualRecord;
use crate::card::Card;

#[derive(Debug, Clone)]
pub struct PerpetualAbilities {
    pub timestamp: i64,
    pub changes: CardTraitChanges,
}

impl PerpetualInterface for PerpetualAbilities {
    fn get_timestamp(&self) -> i64 {
        self.timestamp
    }

    fn apply_effect(&self, card: &mut Card) {
        card.add_perpetual(PerpetualRecord::Abilities {
            timestamp: self.timestamp,
            changes: self.changes.clone(),
        });
    }
}

pub fn apply_effect(card: &mut Card, changes: &CardTraitChanges, timestamp: i64) {
    PerpetualAbilities {
        timestamp,
        changes: changes.clone(),
    }
    .apply_effect(card);
}
