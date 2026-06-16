//! Java-parity perpetual keyword applicator.

use crate::card::perpetual::perpetual_interface::PerpetualInterface;
use crate::card::perpetual::perpetual_record::PerpetualRecord;
use crate::card::Card;

#[derive(Debug, Clone)]
pub struct PerpetualKeywords {
    pub timestamp: i64,
    pub add_keywords: Vec<String>,
    pub remove_keywords: Vec<String>,
    pub remove_all: bool,
}

impl PerpetualInterface for PerpetualKeywords {
    fn get_timestamp(&self) -> i64 {
        self.timestamp
    }

    fn apply_effect(&self, card: &mut Card) {
        card.add_perpetual(PerpetualRecord::Keywords {
            timestamp: self.timestamp,
            add_keywords: self.add_keywords.clone(),
            remove_keywords: self.remove_keywords.clone(),
            remove_all: self.remove_all,
        });
    }
}

pub fn apply_effect(card: &mut Card, keyword: &str) {
    PerpetualKeywords {
        timestamp: 0,
        add_keywords: vec![keyword.to_string()],
        remove_keywords: Vec::new(),
        remove_all: false,
    }
    .apply_effect(card);
}
