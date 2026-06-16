use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::sealed_product::foil_type::FoilType;
use crate::sealed_product::rarity::Rarity;
use crate::sealed_product::sealed_template::SealedTemplate;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum EditionType {
    Core,
    Expansion,
    Reprint,
    Online,
    Starter,
    Commander,
    Planechase,
    Archenemy,
    Promo,
    Token,
    Other,
    #[default]
    Unknown,
}

impl EditionType {
    pub fn parse(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "core" => Self::Core,
            "expansion" => Self::Expansion,
            "reprint" | "masters" | "anthology" | "draft_innovation" => Self::Reprint,
            "online" | "digital" => Self::Online,
            "starter" => Self::Starter,
            "commander" => Self::Commander,
            "planechase" => Self::Planechase,
            "archenemy" => Self::Archenemy,
            "promo" => Self::Promo,
            "token" => Self::Token,
            _ if s.is_empty() => Self::Unknown,
            _ => Self::Other,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EditionEntry {
    pub collector_number: String,
    pub rarity: Rarity,
    pub name: String,
    pub artist: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct CardEdition {
    pub code: String,
    pub code2: Option<String>,
    pub scryfall_code: Option<String>,
    pub name: String,
    pub date: Option<String>,
    pub edition_type: EditionType,

    pub foil_type: FoilType,
    pub foil_chance_in_booster: f64,
    pub foil_always_in_common_slot: bool,
    pub additional_sheet_for_foils: Option<String>,
    pub chance_replace_common_with: f64,
    pub slot_replace_common_with: Option<String>,
    pub booster_must_contain: Option<String>,
    pub booster_replace_slot_from_print_sheet: Option<String>,
    pub sheet_replace_card_from_sheet: Option<String>,
    pub sheet_replace_card_from_sheet2: Option<String>,

    pub alias: Option<String>,
    pub booster_covers: u32,
    pub booster_box_count: u32,
    pub fat_pack_count: u32,
    pub prerelease: Option<String>,
    pub additional_unlock_set: Option<String>,
    pub small_set_override: bool,

    pub booster: Option<String>,
    pub draft_booster: Option<String>,
    pub extra_boosters: HashMap<String, String>,
    pub custom_sheets: HashMap<String, Vec<String>>,

    pub cards: Vec<EditionEntry>,
}

impl CardEdition {
    pub fn to_sealed_template(&self) -> Option<SealedTemplate> {
        self.to_sealed_template_named(None)
    }

    pub fn to_sealed_template_named(&self, variant: Option<&str>) -> Option<SealedTemplate> {
        let primary = self.booster.as_ref().or(self.draft_booster.as_ref());
        let line = match variant {
            Some(v) if !v.is_empty() => self.extra_boosters.get(v).or(primary)?.as_str(),
            _ => primary?.as_str(),
        };
        let slots = crate::sealed_product::sealed_template::parse_slots(line);
        if slots.is_empty() {
            return None;
        }
        let label = match variant {
            Some(v) if !v.is_empty() => format!("{} {v}", self.code),
            _ => self.code.clone(),
        };
        let mut tpl = SealedTemplate::new(Some(label), slots);
        tpl.foil_type = self.foil_type;
        tpl.foil_chance = self.foil_chance_in_booster;
        tpl.foil_always_in_common_slot = self.foil_always_in_common_slot;
        tpl.additional_sheet_for_foils = self.additional_sheet_for_foils.clone();
        tpl.chance_replace_common_with = self.chance_replace_common_with;
        tpl.slot_replace_common_with = self.slot_replace_common_with.clone();
        tpl.booster_must_contain = self.booster_must_contain.clone();
        tpl.booster_replace_slot_from_print_sheet =
            self.booster_replace_slot_from_print_sheet.clone();
        tpl.sheet_replace_card_from_sheet = self.sheet_replace_card_from_sheet.clone();
        tpl.sheet_replace_card_from_sheet2 = self.sheet_replace_card_from_sheet2.clone();
        Some(tpl)
    }

    pub fn variant_names(&self) -> Vec<String> {
        let mut names: Vec<String> = self.extra_boosters.keys().cloned().collect();
        names.sort();
        names
    }
}
