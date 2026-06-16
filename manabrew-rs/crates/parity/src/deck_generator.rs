//! Random deck generation for fuzz parity testing.
//!
//! Generates deterministic decks from a `CardPool` using `JavaRandom` so that
//! the same seed produces identical decks on both the Rust and Java sides.

use crate::card_pool::{CardPool, PoolCard};
use crate::java_random::JavaRandom;
use forge_foundation::color::Color;

/// A deck specification: list of (card_name, count) pairs.
pub type DeckSpec = Vec<(String, usize)>;

/// All five Magic colors for random selection.
const ALL_COLORS: [Color; 5] = [
    Color::White,
    Color::Blue,
    Color::Black,
    Color::Red,
    Color::Green,
];

/// All ten two-color pairs, in a fixed order for deterministic selection.
const COLOR_PAIRS: [(Color, Color); 10] = [
    (Color::White, Color::Blue),
    (Color::White, Color::Black),
    (Color::White, Color::Red),
    (Color::White, Color::Green),
    (Color::Blue, Color::Black),
    (Color::Blue, Color::Red),
    (Color::Blue, Color::Green),
    (Color::Black, Color::Red),
    (Color::Black, Color::Green),
    (Color::Red, Color::Green),
];

/// Generate a random 40-card deck from the pool using the given RNG.
///
/// Algorithm:
/// 1. Pick 1-2 colors
/// 2. Choose 16-18 basic lands for those colors
/// 3. Fill remaining slots with spells from the pool
/// 4. Sort alphabetically for deterministic comparison
pub fn generate_deck(rng: &mut JavaRandom, pool: &CardPool) -> DeckSpec {
    // 1. Pick 1-2 colors
    let num_colors = 1 + rng.next_int(2); // 1 or 2
    let colors: Vec<Color> = if num_colors == 1 {
        let idx = rng.next_int(5) as usize;
        vec![ALL_COLORS[idx]]
    } else {
        let idx = rng.next_int(10) as usize;
        vec![COLOR_PAIRS[idx].0, COLOR_PAIRS[idx].1]
    };

    // 2. Land count: 16-18
    let land_count = 16 + rng.next_int(3) as usize; // 16, 17, or 18

    // Build land base
    let lands = pool.lands_for_colors(&colors);
    let mut deck: Vec<(String, usize)> = Vec::new();

    if !lands.is_empty() {
        if colors.len() == 1 {
            // Mono: all lands are one basic
            deck.push((lands[0].name.clone(), land_count));
        } else {
            // Duo: split lands between the two colors
            let first_count = land_count / 2;
            let second_count = land_count - first_count;
            // lands are sorted by name, find which matches which color
            let mut color_lands: Vec<&PoolCard> = Vec::new();
            for &c in &colors {
                if let Some(land) = lands.iter().find(|l| l.colors.contains(&c)) {
                    color_lands.push(land);
                }
            }
            if color_lands.len() >= 2 {
                deck.push((color_lands[0].name.clone(), first_count));
                deck.push((color_lands[1].name.clone(), second_count));
            } else if !color_lands.is_empty() {
                deck.push((color_lands[0].name.clone(), land_count));
            }
        }
    }

    // 3. Fill spell slots
    let spell_slots = 40_usize.saturating_sub(land_count);
    let mut candidates: Vec<&PoolCard> = pool.spells_for_colors(&colors);

    // Sort alphabetically first (deterministic base order)
    candidates.sort_by(|a, b| a.name.cmp(&b.name));

    // Shuffle candidates with rng
    if candidates.len() > 1 {
        // Fisher-Yates with JavaRandom
        for i in (1..candidates.len()).rev() {
            let j = rng.next_int((i + 1) as i32) as usize;
            candidates.swap(i, j);
        }
    }

    // Greedily pick spells with random copy counts (1-4)
    let mut spells_added = 0usize;
    for card in &candidates {
        if spells_added >= spell_slots {
            break;
        }
        let max_copies = (spell_slots - spells_added).min(4);
        let copies = if max_copies <= 1 {
            1
        } else {
            1 + rng.next_int(max_copies as i32) as usize
        };
        deck.push((card.name.clone(), copies));
        spells_added += copies;
    }

    // Sort final deck alphabetically for deterministic comparison
    deck.sort_by(|a, b| a.0.cmp(&b.0));

    // Merge duplicates (e.g. if same card appeared twice due to sorting)
    let mut merged: Vec<(String, usize)> = Vec::new();
    for (name, count) in deck {
        if let Some(last) = merged.last_mut() {
            if last.0 == name {
                last.1 += count;
                continue;
            }
        }
        merged.push((name, count));
    }

    merged
}

/// Serialize a deck spec as the inline format: `"Name*Count|Name*Count|..."`.
///
/// Uses `|` as delimiter because MTG card names can contain commas
/// (e.g., "Zuko, Firebending Master").
pub fn format_inline(spec: &DeckSpec) -> String {
    spec.iter()
        .map(|(name, count)| format!("{}*{}", name, count))
        .collect::<Vec<_>>()
        .join("|")
}

/// Deserialize an inline deck spec string back to a `DeckSpec`.
///
/// Expects format: `"Name*Count|Name*Count|..."`
pub fn parse_inline(s: &str) -> Result<DeckSpec, String> {
    let mut result = Vec::new();
    for entry in s.split('|') {
        let entry = entry.trim();
        if entry.is_empty() {
            continue;
        }
        // Split on the LAST '*' to handle card names that might contain '*'
        match entry.rfind('*') {
            Some(pos) => {
                let name = entry[..pos].to_string();
                let count_str = &entry[pos + 1..];
                let count: usize = count_str
                    .parse()
                    .map_err(|_| format!("Invalid count '{}' in entry '{}'", count_str, entry))?;
                if name.is_empty() {
                    return Err(format!("Empty card name in entry '{}'", entry));
                }
                result.push((name, count));
            }
            None => {
                return Err(format!(
                    "Invalid entry '{}': expected 'Name*Count' format",
                    entry
                ));
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_and_parse_roundtrip() {
        let spec: DeckSpec = vec![
            ("Lightning Bolt".to_string(), 4),
            ("Mountain".to_string(), 17),
        ];
        let inline = format_inline(&spec);
        assert_eq!(inline, "Lightning Bolt*4|Mountain*17");

        let parsed = parse_inline(&inline).unwrap();
        assert_eq!(parsed, spec);
    }

    #[test]
    fn roundtrip_with_commas_in_names() {
        let spec: DeckSpec = vec![
            ("Florian, Voldaren Scion".to_string(), 2),
            ("Mountain".to_string(), 17),
        ];
        let inline = format_inline(&spec);
        assert_eq!(inline, "Florian, Voldaren Scion*2|Mountain*17");

        let parsed = parse_inline(&inline).unwrap();
        assert_eq!(parsed, spec);
    }

    #[test]
    fn parse_inline_error_cases() {
        assert!(parse_inline("BadEntry").is_err());
        assert!(parse_inline("*4").is_err());
        assert!(parse_inline("Card*abc").is_err());
    }

    #[test]
    fn parse_inline_empty() {
        let result = parse_inline("").unwrap();
        assert!(result.is_empty());
    }
}
