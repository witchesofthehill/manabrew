use std::collections::HashMap;

use crate::ids::{CardId, PlayerId};
use crate::spellability::SpellAbility;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct ActivationKey {
    source: Option<CardId>,
    hash: u64,
}

/// Rust parity utility for Java's `ActivationTable`.
#[derive(Debug, Default, Clone)]
pub struct ActivationTable {
    data: HashMap<ActivationKey, Vec<PlayerId>>,
}

impl ActivationTable {
    fn key_for(sa: &SpellAbility) -> ActivationKey {
        // Use stable fields to identify "same" ability invocations.
        // Java tracks original/root ability identity; this is the nearest
        // equivalent in the current Rust engine.
        let mut hash = 1469598103934665603u64; // FNV offset
        for b in sa.ability_text.as_bytes() {
            hash ^= *b as u64;
            hash = hash.wrapping_mul(1099511628211);
        }
        ActivationKey {
            source: sa.source,
            hash,
        }
    }

    /// Add a single activation instance for this spell ability.
    pub fn add(&mut self, sa: &SpellAbility) {
        let key = Self::key_for(sa);
        self.data.entry(key).or_default().push(sa.activating_player);
    }

    /// Return activation count for this spell ability.
    pub fn get(&self, sa: &SpellAbility) -> usize {
        let key = Self::key_for(sa);
        self.data.get(&key).map_or(0, Vec::len)
    }

    /// Return activators recorded for this spell ability.
    pub fn get_activators(&self, sa: &SpellAbility) -> Vec<PlayerId> {
        let key = Self::key_for(sa);
        self.data.get(&key).cloned().unwrap_or_default()
    }

    pub fn clear(&mut self) {
        self.data.clear();
    }
}
