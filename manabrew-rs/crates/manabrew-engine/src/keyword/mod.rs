// Keyword module: infrastructure, types, and specific keyword implementations.
// Ported from Java's `forge/game/keyword/` package.

// Infrastructure
pub mod keyword_collection;
pub mod keyword_instance;
pub mod keyword_interface;
pub mod keywords_change;
pub mod trait_keywords_change;

// Type marker structs
pub mod keyword_with_amount;
pub mod keyword_with_cost;
pub mod keyword_with_cost_and_amount;
pub mod keyword_with_cost_and_type;
pub mod keyword_with_cost_interface;
pub mod keyword_with_type;
pub mod keyword_with_type_interface;
pub mod simple_keyword;

// Specific keyword implementations
pub mod amplify;
pub mod companion;
pub mod compleated;
pub mod craft;
pub mod devour;
pub mod emerge;
pub mod equip;
pub mod firebending;
pub mod hexproof;
pub mod kicker;
pub mod mayhem;
pub mod modular;
pub mod ninjutsu;
pub mod partner;
pub mod protection;
pub mod suspend;
pub mod trample;
pub mod vanishing;

// Re-export for parity: Keyword.java maps to this file.
pub use keyword_instance::Keyword;

/// Parse a keyword name string into a `Keyword` enum variant (case-insensitive).
/// Convenience re-export of [`Keyword::smart_value_of`].
/// Mirrors Java's `Keyword.smartValueOf(String)`.
pub fn smart_value_of(name: &str) -> Keyword {
    Keyword::smart_value_of(name)
}

// Keyword cost parsing utilities.
// Mirrors Java's KeywordInterface + specific keyword parsers.

/// Info about a card's kicker cost(s).
#[derive(Debug, Clone)]
pub struct KickerInfo {
    /// First kicker cost string (e.g. "1 R").
    pub cost1: String,
    /// Optional second kicker cost string for cards with two kicker costs.
    pub cost2: Option<String>,
}

/// Info about a card's escape cost.
#[derive(Debug, Clone)]
pub struct EscapeInfo {
    /// Mana cost for escape (e.g. "3 B B").
    pub mana_cost: String,
    /// Number of other cards to exile from graveyard.
    pub exile_count: i32,
}

/// Extract the cost portion from a single keyword string.
/// E.g. "Ward:2" with name "Ward" → Some("2").
/// Used by keyword_gen for inline cost extraction from individual keyword strings.
pub fn extract_keyword_cost_str<'a>(kw: &'a str, name: &str) -> Option<&'a str> {
    let prefix = format!("{}:", name);
    kw.strip_prefix(&prefix)
}

/// Parse a keyword cost from a card's keywords list.
/// E.g. keywords contains "Flashback:2 R", name = "Flashback" -> Some("2 R")
pub fn parse_keyword_cost(keywords: &[String], name: &str) -> Option<String> {
    let prefix = format!("{}:", name);
    for kw in keywords {
        if let Some(cost) = kw.strip_prefix(&prefix) {
            return Some(cost.to_string());
        }
    }
    None
}

// ── KeywordCollection-aware parsing functions ─────────────────────────
// These operate on KeywordCollection instead of &[String], providing
// the same parsing logic with proper separation of concerns.

/// Extract a keyword cost from a KeywordCollection.
/// E.g. collection contains "Flashback:2 R", name = "Flashback" → Some("2 R")
pub fn extract_keyword_cost(
    collection: &keyword_collection::KeywordCollection,
    name: &str,
) -> Option<String> {
    let prefix = format!("{}:", name);
    for kw in collection.iter_strings() {
        if let Some(cost) = kw.strip_prefix(&prefix) {
            return Some(cost.to_string());
        }
    }
    None
}

/// Extract a keyword cost from multiple collections (intrinsic + granted).
pub fn extract_keyword_cost_from_all<'a>(
    collections: impl IntoIterator<Item = &'a keyword_collection::KeywordCollection>,
    name: &str,
) -> Option<String> {
    let prefix = format!("{}:", name);
    for coll in collections {
        for kw in coll.iter_strings() {
            if let Some(cost) = kw.strip_prefix(&prefix) {
                return Some(cost.to_string());
            }
        }
    }
    None
}

/// Info about a card's suspend cost.
#[derive(Debug, Clone)]
pub struct SuspendInfo {
    pub mana_cost: String,
    pub time_counters: i32,
}

/// Parse suspend info from a KeywordCollection.
/// Format: "Suspend:MANA_COST:TIME_COUNTERS" e.g. "Suspend:1 U:3"
pub fn extract_suspend(collection: &keyword_collection::KeywordCollection) -> Option<SuspendInfo> {
    for kw in collection.iter_strings() {
        if let Some(rest) = kw.strip_prefix("Suspend:") {
            if let Some(colon_pos) = rest.rfind(':') {
                return Some(SuspendInfo {
                    mana_cost: rest[..colon_pos].trim().to_string(),
                    time_counters: rest[colon_pos + 1..].trim().parse().unwrap_or(0),
                });
            }
        }
    }
    None
}

/// Parse escape info from a KeywordCollection.
pub fn extract_escape(collection: &keyword_collection::KeywordCollection) -> Option<EscapeInfo> {
    for kw in collection.iter_strings() {
        if let Some(rest) = kw.strip_prefix("Escape:") {
            if let Some(last_colon) = rest.rfind(':') {
                return Some(EscapeInfo {
                    mana_cost: rest[..last_colon].trim().to_string(),
                    exile_count: rest[last_colon + 1..].trim().parse().unwrap_or(0),
                });
            }
        }
    }
    None
}

/// Parse kicker info from a KeywordCollection.
pub fn extract_kicker(collection: &keyword_collection::KeywordCollection) -> Option<KickerInfo> {
    for kw in collection.iter_strings() {
        if let Some(rest) = kw.strip_prefix("Kicker:") {
            let parts: Vec<&str> = rest.splitn(2, ':').collect();
            return Some(if parts.len() == 2 {
                KickerInfo {
                    cost1: parts[0].to_string(),
                    cost2: Some(parts[1].to_string()),
                }
            } else {
                KickerInfo {
                    cost1: rest.to_string(),
                    cost2: None,
                }
            });
        }
    }
    None
}

/// Parse kicker info from keywords.
/// Supports single kicker ("Kicker:1 R") and double kicker ("Kicker:1 R:1 G").
pub fn parse_kicker(keywords: &[String]) -> Option<KickerInfo> {
    for kw in keywords {
        if let Some(rest) = kw.strip_prefix("Kicker:") {
            // Check for double kicker (two costs separated by ":")
            // E.g. "1 R:1 G"
            let parts: Vec<&str> = rest.splitn(2, ':').collect();
            if parts.len() == 2 {
                return Some(KickerInfo {
                    cost1: parts[0].to_string(),
                    cost2: Some(parts[1].to_string()),
                });
            } else {
                return Some(KickerInfo {
                    cost1: rest.to_string(),
                    cost2: None,
                });
            }
        }
    }
    None
}

/// Parse escape info from keywords.
/// Format: "Escape:MANA_COST:EXILE_COUNT" e.g. "Escape:3 B B:4"
pub fn parse_escape(keywords: &[String]) -> Option<EscapeInfo> {
    for kw in keywords {
        if let Some(rest) = kw.strip_prefix("Escape:") {
            // Split from right to find the exile count (last segment)
            if let Some(last_colon) = rest.rfind(':') {
                let mana_cost = &rest[..last_colon];
                let exile_str = &rest[last_colon + 1..];
                let exile_count = exile_str.parse::<i32>().unwrap_or(0);
                return Some(EscapeInfo {
                    mana_cost: mana_cost.to_string(),
                    exile_count,
                });
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_keyword_cost() {
        let keywords = vec!["Flashback:2 R".to_string(), "Flying".to_string()];
        assert_eq!(
            parse_keyword_cost(&keywords, "Flashback"),
            Some("2 R".to_string())
        );
        assert_eq!(parse_keyword_cost(&keywords, "Evoke"), None);
    }

    #[test]
    fn test_parse_kicker_single() {
        let keywords = vec!["Kicker:1 R".to_string()];
        let info = parse_kicker(&keywords).unwrap();
        assert_eq!(info.cost1, "1 R");
        assert!(info.cost2.is_none());
    }

    #[test]
    fn test_parse_kicker_double() {
        let keywords = vec!["Kicker:1 R:1 G".to_string()];
        let info = parse_kicker(&keywords).unwrap();
        assert_eq!(info.cost1, "1 R");
        assert_eq!(info.cost2, Some("1 G".to_string()));
    }

    #[test]
    fn test_parse_escape() {
        let keywords = vec!["Escape:3 B B:4".to_string()];
        let info = parse_escape(&keywords).unwrap();
        assert_eq!(info.mana_cost, "3 B B");
        assert_eq!(info.exile_count, 4);
    }
}
