//! Java-parity perpetual effect interface.

use crate::card::Card;

pub trait PerpetualInterface {
    fn get_timestamp(&self) -> i64;

    fn apply_effect(&self, card: &mut Card);
}
