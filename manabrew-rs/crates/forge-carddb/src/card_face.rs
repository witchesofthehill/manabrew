use std::collections::BTreeMap;

use forge_foundation::{CardTypeLine, ColorSet, ManaCost};
use serde::{Deserialize, Serialize};

/// A single face of a card with its original (printed) characteristics.
/// Mirrors Java `CardFace`. Ability/trigger/static/replacement lines are stored
/// as raw strings — they are not parsed into executable objects until a card
/// enters a game (Phase 4+).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardFace {
    pub name: String,
    pub flavor_name: Option<String>,
    pub mana_cost: ManaCost,
    pub color: Option<ColorSet>,
    pub type_line: CardTypeLine,
    pub oracle_text: String,

    // P/T (creatures)
    pub power: Option<String>,
    pub toughness: Option<String>,
    pub int_power: Option<i32>,
    pub int_toughness: Option<i32>,

    // Planeswalker / Battle
    pub initial_loyalty: Option<String>,
    pub defense: Option<String>,

    // Raw ability lines (unparsed)
    pub keywords: Vec<String>,
    pub abilities: Vec<String>,
    pub static_abilities: Vec<String>,
    pub triggers: Vec<String>,
    pub replacements: Vec<String>,
    pub draft_actions: Vec<String>,

    // SVars: named variables/sub-abilities
    pub svars: BTreeMap<String, String>,

    // Non-ability flavor text
    pub non_ability_text: Option<String>,

    // Attraction lights
    pub attraction_lights: Vec<u32>,
}

impl CardFace {
    pub fn new(name: String) -> Self {
        CardFace {
            name,
            flavor_name: None,
            mana_cost: ManaCost::no_cost(),
            color: None,
            type_line: CardTypeLine::new(),
            oracle_text: String::new(),
            power: None,
            toughness: None,
            int_power: None,
            int_toughness: None,
            initial_loyalty: None,
            defense: None,
            keywords: Vec::new(),
            abilities: Vec::new(),
            static_abilities: Vec::new(),
            triggers: Vec::new(),
            replacements: Vec::new(),
            draft_actions: Vec::new(),
            svars: BTreeMap::new(),
            non_ability_text: None,
            attraction_lights: Vec::new(),
        }
    }

    pub fn set_pt(&mut self, value: &str) {
        let parts: Vec<&str> = value.split('/').collect();
        if parts.len() == 2 {
            self.power = Some(parts[0].to_string());
            self.toughness = Some(parts[1].to_string());
            self.int_power = Some(parse_pt_value(parts[0]));
            self.int_toughness = Some(parse_pt_value(parts[1]));
        }
    }

    /// Fill in missing fields with defaults (called after parsing).
    /// Mirrors Java `CardFace.assignMissingFields()`.
    pub fn assign_missing_fields(&mut self) {
        if self.color.is_none() {
            self.color = Some(self.mana_cost.color_set());
        }
    }

    pub fn resolved_color(&self) -> ColorSet {
        self.color.unwrap_or_else(|| self.mana_cost.color_set())
    }
}

/// Parse a P/T value like "2", "*", "1+*", "*+1".
fn parse_pt_value(val: &str) -> i32 {
    let mut s = val.to_string();
    if s.contains('*') {
        s = s.replace("+*", "");
        s = s.replace("-*", "");
        s = s.replace("*+", "");
        s = s.replace('*', "0");
    }
    s.trim().parse::<i32>().unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_pt() {
        assert_eq!(parse_pt_value("2"), 2);
        assert_eq!(parse_pt_value("*"), 0);
        assert_eq!(parse_pt_value("1+*"), 1);
    }

    #[test]
    fn face_defaults() {
        let mut face = CardFace::new("Test".to_string());
        face.mana_cost = ManaCost::parse("1 R");
        face.assign_missing_fields();
        assert!(face.resolved_color().has_red());
    }
}
