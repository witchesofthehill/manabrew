//! Keyword collection management.
//!
//! Ported from Java's `KeywordCollection.java` in `forge/game/keyword/`.

use std::collections::HashMap;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

use super::keyword_instance::{Keyword, KeywordInstanceData};

/// A collection of keyword instances on a card.
/// Mirrors Java's `KeywordCollection` which uses a Multimap<Keyword, KeywordInterface>.
///
/// Serializes as a `Vec<String>` of original keyword strings for backward compatibility.
#[derive(Debug, Clone, Default)]
pub struct KeywordCollection {
    /// Map from keyword enum to list of keyword instance original strings.
    map: HashMap<Keyword, Vec<KeywordInstanceData>>,
}

impl Serialize for KeywordCollection {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.as_string_list().serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for KeywordCollection {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let strings: Vec<String> = Vec::deserialize(deserializer)?;
        let mut coll = KeywordCollection::new();
        for s in &strings {
            coll.add(s);
        }
        Ok(coll)
    }
}

impl KeywordCollection {
    /// Create a new empty keyword collection.
    pub fn new() -> Self {
        Self {
            map: HashMap::new(),
        }
    }

    /// Build a `KeywordCollection` from a `Vec<String>`.
    pub fn from_strings(strings: &[String]) -> Self {
        let mut coll = Self::new();
        for s in strings {
            coll.add(s);
        }
        coll
    }

    /// Whether the collection contains any instance of the given keyword.
    pub fn contains_keyword(&self, keyword: Keyword) -> bool {
        self.map.contains_key(&keyword)
    }

    /// Whether the collection is empty.
    pub fn is_empty(&self) -> bool {
        self.map.values().all(|v| v.is_empty())
    }

    /// Total number of keyword instances.
    pub fn size(&self) -> usize {
        self.map.values().map(|v| v.len()).sum()
    }

    /// Get the total amount for a keyword (sum of all instances).
    pub fn get_amount(&self, keyword: Keyword) -> i32 {
        self.map
            .get(&keyword)
            .map(|instances| instances.len() as i32)
            .unwrap_or(0)
    }

    /// Insert a keyword instance data. Returns true if it was added.
    pub fn insert(&mut self, inst: KeywordInstanceData) -> bool {
        let keyword = inst.keyword;
        let list = self.map.entry(keyword).or_default();
        if keyword.is_multiple_redundant() {
            // Check if already present
            for existing in list.iter() {
                if existing.original == inst.original {
                    return false;
                }
            }
        }
        list.push(inst);
        true
    }

    /// Add a keyword from a string, parsing it into the appropriate type.
    pub fn add(&mut self, k: &str) -> bool {
        let (keyword, _details) = parse_keyword_string(k);
        let inst = KeywordInstanceData::new(keyword, k.to_string());
        self.insert(inst)
    }

    /// Add all keywords from string iterator.
    pub fn add_all<'a>(&mut self, keywords: impl IntoIterator<Item = &'a str>) {
        for k in keywords {
            self.add(k);
        }
    }

    /// Remove all instances whose original string starts with the given prefix.
    pub fn remove(&mut self, keyword: &str) -> bool {
        let mut result = false;
        for list in self.map.values_mut() {
            let before = list.len();
            list.retain(|inst| !inst.original.starts_with(keyword));
            if list.len() != before {
                result = true;
            }
        }
        result
    }

    /// Remove all instances of a keyword enum variant.
    pub fn remove_all(&mut self, keyword: Keyword) -> bool {
        self.map
            .remove(&keyword)
            .map(|v| !v.is_empty())
            .unwrap_or(false)
    }

    /// Remove keywords matching any of the given strings.
    pub fn remove_strings<'a>(&mut self, keywords: impl IntoIterator<Item = &'a str>) -> bool {
        let mut result = false;
        for k in keywords {
            if self.remove(k) {
                result = true;
            }
        }
        result
    }

    /// Clear all keywords.
    pub fn clear(&mut self) {
        self.map.clear();
    }

    /// Check if collection contains a keyword by exact original string match.
    pub fn contains_string(&self, keyword: &str) -> bool {
        self.map
            .values()
            .any(|list| list.iter().any(|inst| inst.original == keyword))
    }

    /// Check if collection contains a keyword by case-insensitive original string match.
    pub fn contains_string_ignore_case(&self, keyword: &str) -> bool {
        self.map.values().any(|list| {
            list.iter()
                .any(|inst| inst.original.eq_ignore_ascii_case(keyword))
        })
    }

    /// Check if any keyword's original string starts with the given prefix.
    pub fn any_starts_with(&self, prefix: &str) -> bool {
        self.map
            .values()
            .any(|list| list.iter().any(|inst| inst.original.starts_with(prefix)))
    }

    /// Check if any keyword's original string starts with the given prefix (case-insensitive).
    pub fn any_starts_with_ignore_case(&self, prefix: &str) -> bool {
        let lower = prefix.to_lowercase();
        self.map.values().any(|list| {
            list.iter()
                .any(|inst| inst.original.to_lowercase().starts_with(&lower))
        })
    }

    /// Find the first keyword whose original string starts with the given prefix.
    pub fn find_with_prefix(&self, prefix: &str) -> Option<&str> {
        for list in self.map.values() {
            for inst in list {
                if inst.original.starts_with(prefix) {
                    return Some(&inst.original);
                }
            }
        }
        None
    }

    /// Iterate over original keyword strings.
    pub fn iter_strings(&self) -> impl Iterator<Item = &str> {
        self.map
            .values()
            .flat_map(|v| v.iter().map(|inst| inst.original.as_str()))
    }

    /// Retain only keywords matching a predicate on the original string.
    pub fn retain<F: Fn(&str) -> bool>(&mut self, f: F) {
        for list in self.map.values_mut() {
            list.retain(|inst| f(&inst.original));
        }
        // Remove empty entries
        self.map.retain(|_, v| !v.is_empty());
    }

    /// Extend this collection with keywords from another collection.
    pub fn extend(&mut self, other: impl IntoIterator<Item = String>) {
        for s in other {
            self.add(&s);
        }
    }

    /// Get all keyword instance data as a flat list.
    pub fn get_values(&self) -> Vec<&KeywordInstanceData> {
        self.map.values().flat_map(|v| v.iter()).collect()
    }

    /// Get all keyword instances for a specific keyword.
    pub fn get_values_for(&self, keyword: Keyword) -> Vec<&KeywordInstanceData> {
        self.map
            .get(&keyword)
            .map(|v| v.iter().collect())
            .unwrap_or_default()
    }

    /// Check if the collection contains a keyword by string prefix match.
    /// Mirrors Java's `KeywordCollection.contains(String)`.
    pub fn contains(&self, keyword: &str) -> bool {
        self.map
            .values()
            .any(|list| list.iter().any(|inst| inst.original.starts_with(keyword)))
    }

    /// Insert all keyword instance data from a slice.
    /// Mirrors Java's `KeywordCollection.insertAll(Iterable<KeywordInterface>)`.
    pub fn insert_all(&mut self, keywords: &[KeywordInstanceData]) {
        for inst in keywords {
            self.insert(inst.clone());
        }
    }

    /// Remove all instances of a specific keyword string (exact match).
    /// Mirrors Java's `KeywordCollection.removeInstances(Keyword, String)`.
    pub fn remove_instances(&mut self, keyword: &str) {
        for list in self.map.values_mut() {
            list.retain(|inst| inst.original != keyword);
        }
        self.map.retain(|_, v| !v.is_empty());
    }

    /// Apply a batch of keyword additions and removals.
    /// Mirrors Java's `KeywordCollection.applyChanges(KeywordsChange)`.
    pub fn apply_changes(&mut self, additions: &[String], removals: &[String]) {
        for r in removals {
            self.remove(r);
        }
        for a in additions {
            self.add(a);
        }
    }

    /// Iterate over keyword strings. Alias for `iter_strings` for parity
    /// with Java's `KeywordCollection.iterator()`.
    pub fn iterator(&self) -> impl Iterator<Item = &str> {
        self.iter_strings()
    }

    /// Get all keywords as a list of original strings.
    pub fn as_string_list(&self) -> Vec<String> {
        self.map
            .values()
            .flat_map(|v| v.iter().map(|inst| inst.original.clone()))
            .collect()
    }
}

/// Parse a keyword string into a (Keyword, details) pair.
/// Mirrors Java's `Keyword.getKeywordDetails`.
pub(crate) fn parse_keyword_string(k: &str) -> (Keyword, String) {
    if k.contains(':') {
        let parts: Vec<&str> = k.splitn(2, ':').collect();
        let keyword = Keyword::smart_value_of(parts[0]);
        let mut details = parts[1].to_string();
        // Remove flavor text
        if let Some(idx) = details.find(":Flavor ") {
            details.truncate(idx);
        }
        (keyword, details)
    } else if k.contains(' ') {
        // Try full string first (e.g. "First Strike", "Double Strike")
        let keyword = Keyword::smart_value_of(k);
        if keyword != Keyword::Undefined {
            return (keyword, String::new());
        }
        // Try first word (e.g. "Enchant creature")
        let parts: Vec<&str> = k.splitn(2, ' ').collect();
        let keyword = Keyword::smart_value_of(parts[0]);
        if keyword != Keyword::Undefined {
            (keyword, parts[1].to_string())
        } else {
            (Keyword::Undefined, k.to_string())
        }
    } else {
        let keyword = Keyword::smart_value_of(k);
        (keyword, String::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_simple_keyword() {
        let mut coll = KeywordCollection::new();
        assert!(coll.add("Flying"));
        assert!(coll.contains_keyword(Keyword::Flying));
        assert!(coll.contains_string("Flying"));
    }

    #[test]
    fn test_redundant_keyword_not_added_twice() {
        let mut coll = KeywordCollection::new();
        assert!(coll.add("Flying"));
        assert!(!coll.add("Flying"));
        assert_eq!(coll.size(), 1);
    }

    #[test]
    fn test_keyword_with_cost() {
        let mut coll = KeywordCollection::new();
        assert!(coll.add("Kicker:1 R"));
        assert!(coll.contains_keyword(Keyword::Kicker));
    }

    #[test]
    fn test_remove_keyword() {
        let mut coll = KeywordCollection::new();
        coll.add("Flying");
        coll.add("Haste");
        assert!(coll.remove("Flying"));
        assert!(!coll.contains_string("Flying"));
        assert!(coll.contains_string("Haste"));
    }

    #[test]
    fn test_clear() {
        let mut coll = KeywordCollection::new();
        coll.add("Flying");
        coll.add("Haste");
        coll.clear();
        assert!(coll.is_empty());
    }

    #[test]
    fn test_contains_string_ignore_case() {
        let mut coll = KeywordCollection::new();
        coll.add("Flying");
        assert!(coll.contains_string_ignore_case("flying"));
        assert!(coll.contains_string_ignore_case("FLYING"));
        assert!(!coll.contains_string_ignore_case("Haste"));
    }

    #[test]
    fn test_any_starts_with() {
        let mut coll = KeywordCollection::new();
        coll.add("Protection from red");
        assert!(coll.any_starts_with("Protection from "));
        assert!(!coll.any_starts_with("Flying"));
    }

    #[test]
    fn test_iter_strings() {
        let mut coll = KeywordCollection::new();
        coll.add("Flying");
        coll.add("Haste");
        let strings: Vec<&str> = coll.iter_strings().collect();
        assert_eq!(strings.len(), 2);
        assert!(strings.contains(&"Flying"));
        assert!(strings.contains(&"Haste"));
    }

    #[test]
    fn test_retain() {
        let mut coll = KeywordCollection::new();
        coll.add("Flying");
        coll.add("Haste");
        coll.add("Menace");
        coll.retain(|k| k != "Menace");
        assert!(coll.contains_string("Flying"));
        assert!(coll.contains_string("Haste"));
        assert!(!coll.contains_string("Menace"));
    }

    #[test]
    fn test_serde_roundtrip() {
        let mut coll = KeywordCollection::new();
        coll.add("Flying");
        coll.add("Haste");
        let json = serde_json::to_string(&coll).unwrap();
        let deserialized: KeywordCollection = serde_json::from_str(&json).unwrap();
        assert!(deserialized.contains_keyword(Keyword::Flying));
        assert!(deserialized.contains_keyword(Keyword::Haste));
    }
}
