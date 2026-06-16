use std::collections::HashMap;
use std::sync::RwLock;

use crate::read_draft_rankings::ReadDraftRankings;

#[derive(Debug, Default)]
pub struct DraftRankCache {
    by_set: RwLock<HashMap<String, HashMap<String, u32>>>,
}

impl DraftRankCache {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_set(&self, set_code: impl Into<String>, ranks: HashMap<String, u32>) {
        let mut guard = self.by_set.write().expect("DraftRankCache poisoned");
        guard.insert(set_code.into().to_lowercase(), ranks);
    }

    pub fn register_from_rnk(&self, set_code: impl Into<String>, body: &str) {
        self.register_set(set_code, ReadDraftRankings::parse(body));
    }

    pub fn rank(&self, set_code: &str, card_name: &str) -> Option<u32> {
        let guard = self.by_set.read().expect("DraftRankCache poisoned");
        guard
            .get(&set_code.to_lowercase())
            .and_then(|m| m.get(&card_name.to_lowercase()).copied())
    }

    pub fn best_rank(&self, card_name: &str) -> Option<u32> {
        let guard = self.by_set.read().expect("DraftRankCache poisoned");
        let mut best: Option<u32> = None;
        let needle = card_name.to_lowercase();
        for ranks in guard.values() {
            if let Some(r) = ranks.get(&needle).copied() {
                best = match best {
                    Some(prev) if prev <= r => Some(prev),
                    _ => Some(r),
                };
            }
        }
        best
    }

    pub fn loaded_sets(&self) -> Vec<String> {
        let guard = self.by_set.read().expect("DraftRankCache poisoned");
        guard.keys().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registers_and_looks_up() {
        let cache = DraftRankCache::new();
        cache.register_from_rnk("M11", "1|Lightning Bolt|C|M11\n2|Shock|C|M11\n");
        assert_eq!(cache.rank("m11", "Lightning Bolt"), Some(1));
        assert_eq!(cache.rank("M11", "Shock"), Some(2));
        assert!(cache.rank("M11", "Counterspell").is_none());
    }

    #[test]
    fn best_rank_takes_minimum_across_sets() {
        let cache = DraftRankCache::new();
        cache.register_from_rnk("M11", "5|Lightning Bolt|C|M11\n");
        cache.register_from_rnk("M21", "2|Lightning Bolt|C|M21\n");
        assert_eq!(cache.best_rank("Lightning Bolt"), Some(2));
    }
}
