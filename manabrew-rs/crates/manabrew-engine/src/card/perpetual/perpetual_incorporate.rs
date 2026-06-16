//! Java-parity perpetual incorporate applicator.

use crate::card::perpetual::perpetual_interface::PerpetualInterface;
use crate::card::perpetual::perpetual_record::PerpetualRecord;
use crate::card::Card;
use forge_foundation::ManaCost;

#[derive(Debug, Clone)]
pub struct PerpetualIncorporate {
    pub timestamp: i64,
    pub incorporate: ManaCost,
}

impl PerpetualInterface for PerpetualIncorporate {
    fn get_timestamp(&self) -> i64 {
        self.timestamp
    }

    fn apply_effect(&self, card: &mut Card) {
        card.add_perpetual(PerpetualRecord::Incorporate {
            timestamp: self.timestamp,
            incorporate: self.incorporate.clone(),
        });
    }
}

pub fn apply_effect(card: &mut Card, mana_cost: &str) {
    let incorporate = ManaCost::parse(mana_cost);
    PerpetualIncorporate {
        timestamp: 0,
        incorporate,
    }
    .apply_effect(card);
}
