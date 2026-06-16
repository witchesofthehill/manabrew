//! Java-parity perpetual P/T boost applicator.

use crate::card::perpetual::perpetual_interface::PerpetualInterface;
use crate::card::perpetual::perpetual_record::PerpetualRecord;
use crate::card::Card;

#[derive(Debug, Clone)]
pub struct PerpetualPtBoost {
    pub timestamp: i64,
    pub power: i32,
    pub toughness: i32,
}

impl PerpetualInterface for PerpetualPtBoost {
    fn get_timestamp(&self) -> i64 {
        self.timestamp
    }

    fn apply_effect(&self, card: &mut Card) {
        card.add_perpetual(PerpetualRecord::PtBoost {
            timestamp: self.timestamp,
            power: self.power,
            toughness: self.toughness,
        });
    }
}

pub fn apply_effect(card: &mut Card, power: i32, toughness: i32) {
    PerpetualPtBoost {
        timestamp: 0,
        power,
        toughness,
    }
    .apply_effect(card);
}
