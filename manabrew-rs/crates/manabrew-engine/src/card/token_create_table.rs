use std::collections::HashMap;

use crate::ids::{CardId, PlayerId};

/// Compact token creation accumulator.
/// Mirrors Java's table shape: owner x token -> amount.
#[derive(Debug, Default, Clone)]
pub struct TokenCreateTable {
    data: HashMap<(PlayerId, CardId), i32>,
}

impl TokenCreateTable {
    /// Add `amount` created tokens for `(owner, token)` and return new total.
    pub fn add(&mut self, owner: PlayerId, token: CardId, amount: i32) -> i32 {
        let entry = self.data.entry((owner, token)).or_insert(0);
        *entry += amount;
        *entry
    }
}
