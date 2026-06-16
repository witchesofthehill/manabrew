//! Java-parity perpetual mana-cost applicator.

use crate::card::perpetual::perpetual_interface::PerpetualInterface;
use crate::card::perpetual::perpetual_record::PerpetualRecord;
use crate::card::Card;
use forge_foundation::ManaCost;

#[derive(Debug, Clone)]
pub struct PerpetualManaCost {
    pub timestamp: i64,
    pub mana_cost: ManaCost,
}

impl PerpetualInterface for PerpetualManaCost {
    fn get_timestamp(&self) -> i64 {
        self.timestamp
    }

    fn apply_effect(&self, card: &mut Card) {
        card.add_perpetual(PerpetualRecord::ManaCost {
            timestamp: self.timestamp,
            mana_cost: self.mana_cost.clone(),
        });
    }
}

pub fn apply_effect(card: &mut Card, mana_cost: &str) {
    let parsed = ManaCost::parse(mana_cost);
    PerpetualManaCost {
        timestamp: 0,
        mana_cost: parsed,
    }
    .apply_effect(card);
}
