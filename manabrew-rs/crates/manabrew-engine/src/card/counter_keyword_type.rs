use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use super::CounterType;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CounterKeywordType {
    pub keyword: String,
    pub desc: Option<String>,
}

impl CounterKeywordType {
    /// Java parity: cached factory for keyword counter wrappers.
    pub fn get(s: &str) -> CounterKeywordType {
        static CACHE: OnceLock<Mutex<HashMap<String, CounterKeywordType>>> = OnceLock::new();
        let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
        let mut lock = cache.lock().expect("counter keyword cache poisoned");
        if let Some(existing) = lock.get(s) {
            return existing.clone();
        }
        let created = CounterKeywordType {
            keyword: s.to_string(),
            desc: if Self::is_keyword_counter(s) {
                Some(s.to_string())
            } else {
                None
            },
        };
        lock.insert(s.to_string(), created.clone());
        created
    }

    pub fn is(counter: &CounterType) -> bool {
        match counter {
            CounterType::Named(name) => Self::is_keyword_counter(name),
            _ => false,
        }
    }

    fn is_keyword_counter(keyword: &str) -> bool {
        matches!(
            keyword,
            "Flying"
                | "First Strike"
                | "Double Strike"
                | "Deathtouch"
                | "Decayed"
                | "Exalted"
                | "Haste"
                | "Hexproof"
                | "Indestructible"
                | "Lifelink"
                | "Menace"
                | "Reach"
                | "Shadow"
                | "Trample"
                | "Vigilance"
        ) || keyword.starts_with("Hexproof:")
            || keyword.starts_with("Trample:")
    }
}
