//! Changed-word replacement table (Java parity: `CardChangedWords`).

use std::collections::{BTreeMap, HashMap};

#[derive(Debug, Clone)]
struct WordHolder {
    old_word: String,
    new_word: String,
    clear: bool,
}

impl WordHolder {
    fn clear_entry() -> Self {
        Self {
            old_word: String::new(),
            new_word: String::new(),
            clear: true,
        }
    }

    fn replacement(old_word: &str, new_word: &str) -> Self {
        Self {
            old_word: old_word.to_string(),
            new_word: new_word.to_string(),
            clear: false,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct CardChangedWords {
    map: BTreeMap<(u64, u64), WordHolder>,
    is_dirty: bool,
    result_cache: HashMap<String, String>,
}

impl CardChangedWords {
    pub fn add_empty(&mut self, timestamp: u64, static_id: u64) -> u64 {
        self.map
            .insert((timestamp, static_id), WordHolder::clear_entry());
        self.is_dirty = true;
        timestamp
    }

    pub fn add(
        &mut self,
        timestamp: u64,
        static_id: u64,
        original_word: &str,
        new_word: &str,
    ) -> u64 {
        self.map.insert(
            (timestamp, static_id),
            WordHolder::replacement(original_word, new_word),
        );
        self.is_dirty = true;
        timestamp
    }

    pub fn remove(&mut self, timestamp: u64, static_id: u64) -> bool {
        let removed = self.map.remove(&(timestamp, static_id)).is_some();
        if removed {
            self.is_dirty = true;
        }
        removed
    }

    pub fn clear(&mut self) {
        self.map.clear();
        self.result_cache.clear();
        self.is_dirty = true;
    }

    pub fn resolved_map(&mut self) -> &HashMap<String, String> {
        if self.is_dirty {
            self.result_cache.clear();
            for holder in self.map.values() {
                if holder.clear {
                    self.result_cache.clear();
                    continue;
                }

                let replacements: Vec<(String, String)> = self
                    .result_cache
                    .iter()
                    .filter(|(_, v)| v.as_str() == holder.old_word)
                    .map(|(k, _)| (k.clone(), holder.new_word.clone()))
                    .collect();
                for (k, v) in replacements {
                    self.result_cache.insert(k, v);
                }

                self.result_cache
                    .insert(holder.old_word.clone(), holder.new_word.clone());
            }
            self.is_dirty = false;
        }
        &self.result_cache
    }
}
