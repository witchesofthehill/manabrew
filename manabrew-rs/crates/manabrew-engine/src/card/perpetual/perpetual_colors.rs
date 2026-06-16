//! Java-parity perpetual color applicator.

use forge_foundation::ColorSet;

use crate::card::perpetual::perpetual_interface::PerpetualInterface;
use crate::card::perpetual::perpetual_record::PerpetualRecord;
use crate::card::Card;

#[derive(Debug, Clone)]
pub struct PerpetualColors {
    pub timestamp: i64,
    pub colors: ColorSet,
    pub overwrite: bool,
}

impl PerpetualInterface for PerpetualColors {
    fn get_timestamp(&self) -> i64 {
        self.timestamp
    }

    fn apply_effect(&self, card: &mut Card) {
        card.add_perpetual(PerpetualRecord::Colors {
            timestamp: self.timestamp,
            colors: self.colors,
            overwrite: self.overwrite,
        });
    }
}

pub fn apply_effect(card: &mut Card, color: ColorSet) {
    PerpetualColors {
        timestamp: 0,
        colors: color,
        overwrite: false,
    }
    .apply_effect(card);
}
