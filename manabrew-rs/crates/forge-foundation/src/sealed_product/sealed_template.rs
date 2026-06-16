use serde::{Deserialize, Serialize};

use super::booster_slots::BoosterSlots;
use super::foil_type::FoilType;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SealedTemplate {
    pub name: Option<String>,
    pub slots: Vec<(String, u32)>,

    pub foil_chance: f64,
    pub foil_type: FoilType,
    pub foil_always_in_common_slot: bool,
    pub additional_sheet_for_foils: Option<String>,
    pub chance_replace_common_with: f64,
    pub slot_replace_common_with: Option<String>,
    pub booster_must_contain: Option<String>,
    pub booster_replace_slot_from_print_sheet: Option<String>,
    pub sheet_replace_card_from_sheet: Option<String>,
    pub sheet_replace_card_from_sheet2: Option<String>,
}

impl SealedTemplate {
    pub fn new(name: Option<String>, slots: Vec<(String, u32)>) -> Self {
        Self {
            name,
            slots,
            foil_chance: 0.0,
            foil_type: FoilType::NotSupported,
            foil_always_in_common_slot: false,
            additional_sheet_for_foils: None,
            chance_replace_common_with: 0.0,
            slot_replace_common_with: None,
            booster_must_contain: None,
            booster_replace_slot_from_print_sheet: None,
            sheet_replace_card_from_sheet: None,
            sheet_replace_card_from_sheet2: None,
        }
    }

    pub fn generic_draft_booster() -> Self {
        Self {
            name: None,
            slots: vec![
                (BoosterSlots::COMMON.to_string(), 10),
                (BoosterSlots::UNCOMMON.to_string(), 3),
                (BoosterSlots::RARE_MYTHIC.to_string(), 1),
                (BoosterSlots::BASIC_LAND.to_string(), 1),
            ],
            foil_chance: 1.0 / 3.0,
            foil_type: FoilType::Modern,
            foil_always_in_common_slot: false,
            additional_sheet_for_foils: None,
            chance_replace_common_with: 0.0,
            slot_replace_common_with: None,
            booster_must_contain: None,
            booster_replace_slot_from_print_sheet: None,
            sheet_replace_card_from_sheet: None,
            sheet_replace_card_from_sheet2: None,
        }
    }

    pub fn generic_no_slot_booster() -> Self {
        Self::new(None, vec![(BoosterSlots::ANY.to_string(), 15)])
    }

    pub fn number_of_cards_expected(&self) -> u32 {
        self.slots.iter().map(|(_, n)| n).sum()
    }

    pub fn has_slot(&self, s: &str) -> bool {
        self.slots
            .iter()
            .any(|(slot_name, _)| slot_name.split([' ', ':', '!']).next() == Some(s))
    }

    pub fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }

    pub fn parse_line(line: &str) -> Option<Self> {
        let (head, data) = line.split_once(':')?;
        Some(Self::new(Some(head.trim().to_string()), parse_slots(data)))
    }
}

pub fn parse_slots(data: &str) -> Vec<(String, u32)> {
    let mut out = Vec::new();
    for chunk in split_with_parens(data, ',') {
        let trimmed = chunk.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut parts = split_with_parens(trimmed, ' ');
        let count_str = match parts.next() {
            Some(s) => s,
            None => continue,
        };
        let count: u32 = match count_str.trim().parse() {
            Ok(n) => n,
            Err(_) => continue,
        };
        let slot_name: String = parts.collect::<Vec<_>>().join(" ").replace(';', ",");
        if !slot_name.is_empty() {
            out.push((slot_name, count));
        }
    }
    out
}

fn split_with_parens(s: &str, sep: char) -> std::vec::IntoIter<&str> {
    let mut depth = 0i32;
    let mut start = 0usize;
    let mut out = Vec::new();
    for (i, c) in s.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            ch if ch == sep && depth == 0 => {
                out.push(&s[start..i]);
                start = i + ch.len_utf8();
            }
            _ => {}
        }
    }
    out.push(&s[start..]);
    out.into_iter()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generic_draft_has_15_cards() {
        let t = SealedTemplate::generic_draft_booster();
        assert_eq!(t.number_of_cards_expected(), 15);
    }

    #[test]
    fn generic_no_slot_has_15_cards() {
        let t = SealedTemplate::generic_no_slot_booster();
        assert_eq!(t.number_of_cards_expected(), 15);
        assert!(t.has_slot(BoosterSlots::ANY));
    }

    #[test]
    fn parses_template_line() {
        let t = SealedTemplate::parse_line("M21:10 Common, 3 Uncommon, 1 RareMythic, 1 BasicLand")
            .unwrap();
        assert_eq!(t.name.as_deref(), Some("M21"));
        assert_eq!(t.slots.len(), 4);
        assert_eq!(t.slots[0], ("Common".to_string(), 10));
        assert_eq!(t.number_of_cards_expected(), 15);
    }

    #[test]
    fn semicolons_in_slot_become_commas() {
        let t = SealedTemplate::parse_line("X:1 Foo;Bar").unwrap();
        assert_eq!(t.slots[0].0, "Foo,Bar");
    }
}
