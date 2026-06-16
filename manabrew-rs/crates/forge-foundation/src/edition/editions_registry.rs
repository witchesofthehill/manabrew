use std::collections::HashMap;

use super::card_edition::{CardEdition, EditionEntry};
use super::parser::parse_edition;
use crate::sealed_product::paper_card::PaperCard;
use crate::sealed_product::print_sheet::PrintSheet;
use crate::sealed_product::print_sheet_registry;
use crate::sealed_product::rarity::Rarity;

#[derive(Debug, Clone, Default)]
pub struct EditionsRegistry {
    by_code: HashMap<String, CardEdition>,
    aliases: HashMap<String, String>,
}

impl EditionsRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.by_code.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_code.is_empty()
    }

    pub fn insert(&mut self, edition: CardEdition) {
        let primary = edition.code.to_ascii_uppercase();
        if let Some(c2) = &edition.code2 {
            self.aliases
                .insert(c2.to_ascii_uppercase(), primary.clone());
        }
        if let Some(sc) = &edition.scryfall_code {
            self.aliases
                .insert(sc.to_ascii_uppercase(), primary.clone());
        }
        self.by_code.insert(primary, edition);
    }

    pub fn ingest_file(&mut self, body: &str) -> String {
        let edition = parse_edition(body);
        let code = edition.code.clone();
        self.insert(edition);
        code
    }

    pub fn get(&self, code: &str) -> Option<&CardEdition> {
        let key = code.to_ascii_uppercase();
        if let Some(direct) = self.by_code.get(&key) {
            return Some(direct);
        }
        self.aliases
            .get(&key)
            .and_then(|primary| self.by_code.get(primary))
    }

    pub fn iter(&self) -> impl Iterator<Item = &CardEdition> {
        self.by_code.values()
    }

    pub fn install_print_sheets<F>(&self, paper_card_for: F)
    where
        F: Fn(&str, &EditionEntry) -> PaperCard,
    {
        let mut sheets: HashMap<String, PrintSheet> = HashMap::new();
        for edition in self.by_code.values() {
            let mut cards_sheet = PrintSheet::new(format!("{} cards", edition.code));
            let mut lands_sheet = PrintSheet::new(format!("{} Lands", edition.code));

            for entry in &edition.cards {
                let pc = paper_card_for(&edition.code, entry);
                if entry.rarity == Rarity::BasicLand {
                    lands_sheet.add(pc);
                } else if entry.rarity != Rarity::Token {
                    cards_sheet.add(pc);
                }
            }

            if !cards_sheet.is_empty() {
                sheets.insert(cards_sheet.name().to_string(), cards_sheet);
            }
            if !lands_sheet.is_empty() {
                sheets.insert(lands_sheet.name().to_string(), lands_sheet);
            }

            for (section, rows) in &edition.custom_sheets {
                let mut sheet = PrintSheet::new(section.clone());
                for row in rows {
                    if let Some((count_str, name)) = row.split_once(' ') {
                        let count: u32 = count_str.trim().parse().unwrap_or(1);
                        let name = name.trim();
                        let entry = EditionEntry {
                            collector_number: String::new(),
                            rarity: Rarity::Unknown,
                            name: name.to_string(),
                            artist: None,
                        };
                        let pc = paper_card_for(&edition.code, &entry);
                        sheet.add_weighted(pc, count);
                    }
                }
                if !sheet.is_empty() {
                    sheets.insert(section.clone(), sheet);
                }
            }
        }
        print_sheet_registry::install(sheets);
    }

    pub fn install_print_sheets_default(&self) {
        self.install_print_sheets(|code, entry| {
            PaperCard::new(&entry.name, code, &entry.collector_number, entry.rarity)
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ingest_and_lookup_by_code_and_scryfall_alias() {
        let mut reg = EditionsRegistry::new();
        reg.ingest_file(
            "[metadata]
Code=M21
Name=Core Set 2021
ScryfallCode=m21

[cards]
",
        );
        assert!(reg.get("m21").is_some());
        assert!(reg.get("M21").is_some());
        assert!(reg.get("missing").is_none());
    }
}
