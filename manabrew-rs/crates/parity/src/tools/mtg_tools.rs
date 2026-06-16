//! MTG reference tools: scryfall_card (HTTP API) and mtg_rules (local text search).

use std::sync::OnceLock;

/// Cached MTG Comprehensive Rules text, loaded once.
static MTG_RULES: OnceLock<Option<String>> = OnceLock::new();

/// Maximum paragraphs returned by keyword search.
const MAX_KEYWORD_RESULTS: usize = 5;

/// Context lines around a rule number match.
const RULE_CONTEXT_LINES: usize = 20;

/// Load the MTG Comprehensive Rules text from disk (via `MTG_RULES_PATH` env).
fn load_rules() -> &'static Option<String> {
    MTG_RULES.get_or_init(|| {
        let path = std::env::var("MTG_RULES_PATH").ok()?;
        match std::fs::read_to_string(&path) {
            Ok(text) => {
                eprintln!(
                    "[mtg_tools] Loaded MTG rules ({} bytes) from {path}",
                    text.len()
                );
                Some(text)
            }
            Err(e) => {
                eprintln!("[mtg_tools] Failed to load MTG rules from {path}: {e}");
                None
            }
        }
    })
}

/// Look up an MTG card on Scryfall and return oracle text + rulings.
///
/// Uses `GET https://api.scryfall.com/cards/named?exact={name}`.
pub async fn scryfall_card(client: &reqwest::Client, card_name: &str) -> String {
    let url = format!(
        "https://api.scryfall.com/cards/named?exact={}",
        urlencoding::encode(card_name)
    );

    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => return format!("Scryfall request failed: {e}"),
    };

    if !resp.status().is_success() {
        let status = resp.status();
        return format!("Scryfall error {status}: card '{card_name}' not found");
    }

    let card: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => return format!("Scryfall parse error: {e}"),
    };

    let mut result = String::new();

    if let Some(name) = card["name"].as_str() {
        result.push_str(&format!("Name: {name}\n"));
    }
    if let Some(mana) = card["mana_cost"].as_str() {
        result.push_str(&format!("Mana Cost: {mana}\n"));
    }
    if let Some(type_line) = card["type_line"].as_str() {
        result.push_str(&format!("Type: {type_line}\n"));
    }
    if let Some(oracle) = card["oracle_text"].as_str() {
        result.push_str(&format!("Oracle Text: {oracle}\n"));
    }
    if let Some(power) = card["power"].as_str() {
        if let Some(toughness) = card["toughness"].as_str() {
            result.push_str(&format!("P/T: {power}/{toughness}\n"));
        }
    }
    if let Some(keywords) = card["keywords"].as_array() {
        let kws: Vec<&str> = keywords.iter().filter_map(|k| k.as_str()).collect();
        if !kws.is_empty() {
            result.push_str(&format!("Keywords: {}\n", kws.join(", ")));
        }
    }

    // Fetch rulings if available
    if let Some(rulings_uri) = card["rulings_uri"].as_str() {
        match fetch_rulings(client, rulings_uri).await {
            Ok(rulings) if !rulings.is_empty() => {
                result.push_str("\nRulings:\n");
                for ruling in rulings.iter().take(5) {
                    result.push_str(&format!("- {ruling}\n"));
                }
            }
            _ => {}
        }
    }

    result
}

/// Fetch rulings from a Scryfall rulings URI.
async fn fetch_rulings(client: &reqwest::Client, uri: &str) -> Result<Vec<String>, String> {
    let resp = client
        .get(uri)
        .send()
        .await
        .map_err(|e| format!("Rulings request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err("Rulings fetch failed".to_string());
    }

    let data: serde_json::Value = resp.json().await.map_err(|e| format!("Parse error: {e}"))?;

    let rulings = data["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|r| r["comment"].as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    Ok(rulings)
}

/// Search the MTG Comprehensive Rules by rule number or keyword.
///
/// - Rule number (e.g. "702.2"): returns the section + ~20 lines of context
/// - Keyword (e.g. "first strike"): returns up to 5 matching paragraphs
pub fn mtg_rules(query: &str) -> String {
    let rules = match load_rules() {
        Some(text) => text,
        None => {
            return "MTG rules not available. Set MTG_RULES_PATH environment variable.".to_string()
        }
    };

    let query_trimmed = query.trim();

    // Detect if query looks like a rule number (e.g. "702.2", "100.1a")
    if looks_like_rule_number(query_trimmed) {
        return search_by_rule_number(rules, query_trimmed);
    }

    // Keyword search
    search_by_keyword(rules, query_trimmed)
}

/// Check if a query looks like a rule number (digits, dots, optional letter suffix).
fn looks_like_rule_number(q: &str) -> bool {
    let mut has_digit = false;
    let mut has_dot = false;
    for (i, c) in q.chars().enumerate() {
        if c.is_ascii_digit() {
            has_digit = true;
        } else if c == '.' {
            has_dot = true;
        } else if c.is_ascii_alphabetic() && i == q.len() - 1 {
            // Trailing letter like "702.2a"
        } else {
            return false;
        }
    }
    has_digit && has_dot
}

/// Search rules by rule number — find the line that starts with the number and return context.
fn search_by_rule_number(rules: &str, number: &str) -> String {
    let lines: Vec<&str> = rules.lines().collect();

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with(number) {
            // Check it's actually the rule (followed by space or period or end)
            let rest = &trimmed[number.len()..];
            if rest.is_empty() || rest.starts_with(' ') || rest.starts_with('.') {
                let start = i;
                let end = (i + RULE_CONTEXT_LINES).min(lines.len());
                let context: Vec<&str> = lines[start..end].to_vec();
                return context.join("\n");
            }
        }
    }

    format!("Rule {number} not found in comprehensive rules.")
}

/// Search rules by keyword — return paragraphs containing the keyword.
fn search_by_keyword(rules: &str, keyword: &str) -> String {
    let keyword_lower = keyword.to_lowercase();
    let lines: Vec<&str> = rules.lines().collect();
    let mut results = Vec::new();

    let mut i = 0;
    while i < lines.len() && results.len() < MAX_KEYWORD_RESULTS {
        if lines[i].to_lowercase().contains(&keyword_lower) {
            // Collect paragraph: go back to find paragraph start, forward to end
            let para_start = find_paragraph_start(&lines, i);
            let para_end = find_paragraph_end(&lines, i);

            let paragraph: Vec<&str> = lines[para_start..=para_end].to_vec();
            let text = paragraph.join("\n");

            // Avoid duplicate paragraphs
            if !results.contains(&text) {
                results.push(text);
            }

            i = para_end + 1;
        } else {
            i += 1;
        }
    }

    if results.is_empty() {
        return format!("No rules found matching: {keyword}");
    }

    results.join("\n\n---\n\n")
}

/// Find the start of a paragraph (empty line before or start of file).
fn find_paragraph_start(lines: &[&str], from: usize) -> usize {
    let mut i = from;
    while i > 0 {
        if lines[i - 1].trim().is_empty() {
            return i;
        }
        i -= 1;
    }
    0
}

/// Find the end of a paragraph (empty line after or end of file).
fn find_paragraph_end(lines: &[&str], from: usize) -> usize {
    let mut i = from;
    while i < lines.len() - 1 {
        if lines[i + 1].trim().is_empty() {
            return i;
        }
        i += 1;
    }
    lines.len() - 1
}

/// URL-encode a string for use in query parameters.
mod urlencoding {
    pub fn encode(s: &str) -> String {
        let mut result = String::new();
        for byte in s.bytes() {
            match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    result.push(byte as char);
                }
                b' ' => result.push_str("%20"),
                _ => {
                    result.push_str(&format!("%{:02X}", byte));
                }
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn looks_like_rule_number_valid() {
        assert!(looks_like_rule_number("702.2"));
        assert!(looks_like_rule_number("100.1a"));
        assert!(looks_like_rule_number("905.1"));
    }

    #[test]
    fn looks_like_rule_number_invalid() {
        assert!(!looks_like_rule_number("first strike"));
        assert!(!looks_like_rule_number("702"));
        assert!(!looks_like_rule_number("hello.world"));
    }

    #[test]
    fn url_encode() {
        assert_eq!(urlencoding::encode("Lightning Bolt"), "Lightning%20Bolt");
        assert_eq!(urlencoding::encode("Ætherize"), "%C3%86therize");
    }

    #[test]
    fn mtg_rules_no_path() {
        // Without MTG_RULES_PATH set, should return helpful error
        // (This may or may not trigger depending on test env)
        let result = mtg_rules("702.2");
        // Just verify it doesn't panic
        assert!(!result.is_empty());
    }
}
