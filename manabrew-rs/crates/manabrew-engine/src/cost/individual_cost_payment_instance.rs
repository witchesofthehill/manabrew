//! Mirrors Java `IndividualCostPaymentInstance`.

use std::sync::atomic::{AtomicU64, Ordering};

use crate::cost::CostPart;
use crate::ids::CardId;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone)]
pub struct IndividualCostPaymentInstance {
    id: u64,
    cost: CostPart,
    payment_source: CardId,
}

impl IndividualCostPaymentInstance {
    pub fn new(cost: CostPart, payment_source: CardId) -> Self {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        Self {
            id,
            cost,
            payment_source,
        }
    }

    pub fn get_id(&self) -> u64 {
        self.id
    }

    pub fn get_cost(&self) -> &CostPart {
        &self.cost
    }

    pub fn get_payment_source(&self) -> CardId {
        self.payment_source
    }
}
