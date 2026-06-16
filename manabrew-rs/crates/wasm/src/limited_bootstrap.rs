use forge_foundation::edition::EditionsRegistry;
use forge_foundation::sealed_product::FoilType;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditionInfoDto {
    pub code: String,
    pub name: String,
    pub edition_type: String,
    pub date: Option<String>,
    pub slots: Vec<EditionSlotDto>,
    pub foil_chance: f64,
    pub foil_type: String,
    pub variants: Vec<String>,
    pub has_replacement_hooks: bool,
    pub booster_covers: u32,
    pub prerelease: Option<String>,
    pub alias: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditionSlotDto {
    pub label: String,
    pub count: u32,
}

pub(crate) fn edition_info(code: &str) -> Option<EditionInfoDto> {
    let editions = editions()?;
    let edition = editions.get(code)?;
    let template = edition.to_sealed_template()?;
    let slots = template
        .slots
        .iter()
        .map(|(label, count)| EditionSlotDto {
            label: label.clone(),
            count: *count,
        })
        .collect();
    let foil_type = match template.foil_type {
        FoilType::Modern => "Modern",
        FoilType::OldStyle => "OldStyle",
        FoilType::NotSupported => "NotSupported",
    };
    let has_replacement_hooks = template.booster_must_contain.is_some()
        || template.booster_replace_slot_from_print_sheet.is_some()
        || template.sheet_replace_card_from_sheet.is_some()
        || template.sheet_replace_card_from_sheet2.is_some()
        || template.chance_replace_common_with > 0.0;
    Some(EditionInfoDto {
        code: edition.code.clone(),
        name: edition.name.clone(),
        edition_type: format!("{:?}", edition.edition_type),
        date: edition.date.clone(),
        slots,
        foil_chance: template.foil_chance,
        foil_type: foil_type.to_string(),
        variants: edition.variant_names(),
        has_replacement_hooks,
        booster_covers: edition.booster_covers,
        prerelease: edition.prerelease.clone(),
        alias: edition.alias.clone(),
    })
}

pub(crate) fn editions() -> Option<&'static EditionsRegistry> {
    crate::card_loader::get_editions()
}

pub(crate) fn dominant_set_code(
    pool: &[forge_foundation::sealed_product::PaperCard],
) -> Option<String> {
    use std::collections::HashMap;
    if pool.is_empty() {
        return None;
    }
    let mut counts: HashMap<String, usize> = HashMap::new();
    for card in pool {
        if card.set_code.is_empty() {
            continue;
        }
        *counts
            .entry(card.set_code.to_ascii_uppercase())
            .or_insert(0) += 1;
    }
    counts.into_iter().max_by_key(|(_, n)| *n).map(|(k, _)| k)
}
