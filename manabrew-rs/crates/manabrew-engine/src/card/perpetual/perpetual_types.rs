//! Java-parity perpetual type applicator.

use crate::card::perpetual::perpetual_interface::PerpetualInterface;
use crate::card::perpetual::perpetual_record::PerpetualRecord;
use crate::card::Card;

#[derive(Debug, Clone)]
pub struct PerpetualTypes {
    pub timestamp: i64,
    pub add_types: Vec<String>,
}

impl PerpetualInterface for PerpetualTypes {
    fn get_timestamp(&self) -> i64 {
        self.timestamp
    }

    fn apply_effect(&self, card: &mut Card) {
        card.add_perpetual(PerpetualRecord::Types {
            timestamp: self.timestamp,
            add_types: self.add_types.clone(),
        });
    }
}

pub fn apply_effect(card: &mut Card, ty: &str) {
    PerpetualTypes {
        timestamp: 0,
        add_types: vec![ty.to_string()],
    }
    .apply_effect(card);
}
