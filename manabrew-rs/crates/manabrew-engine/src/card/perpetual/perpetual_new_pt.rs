//! Java-parity perpetual new P/T applicator.

use crate::card::perpetual::perpetual_interface::PerpetualInterface;
use crate::card::perpetual::perpetual_record::PerpetualRecord;
use crate::card::Card;

#[derive(Debug, Clone)]
pub struct PerpetualNewPt {
    pub timestamp: i64,
    pub power: Option<i32>,
    pub toughness: Option<i32>,
}

impl PerpetualInterface for PerpetualNewPt {
    fn get_timestamp(&self) -> i64 {
        self.timestamp
    }

    fn apply_effect(&self, card: &mut Card) {
        card.add_perpetual(PerpetualRecord::NewPt {
            timestamp: self.timestamp,
            power: self.power,
            toughness: self.toughness,
        });
    }
}

pub fn apply_effect(card: &mut Card, power: Option<i32>, toughness: Option<i32>) {
    PerpetualNewPt {
        timestamp: 0,
        power,
        toughness,
    }
    .apply_effect(card);
}
