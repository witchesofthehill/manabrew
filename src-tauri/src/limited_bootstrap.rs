use std::sync::OnceLock;

use forge_foundation::edition::EditionsRegistry;
use forge_limited::bootstrap::build_registry;

static EDITIONS: OnceLock<EditionsRegistry> = OnceLock::new();

pub fn editions() -> &'static EditionsRegistry {
    EDITIONS.get_or_init(|| {
        let Some(bytes) = crate::card_db::cardset_archive_bytes() else {
            eprintln!("[limited_bootstrap] cardset archive unavailable — per-set templates disabled");
            return EditionsRegistry::new();
        };
        let archive = match forge_cardset_archive::load_checked(bytes) {
            Ok(a) => a,
            Err(e) => {
                eprintln!("[limited_bootstrap] archive validation failed: {e}");
                return EditionsRegistry::new();
            }
        };

        let editions = archive
            .editions
            .iter()
            .map(|e| (e.name.as_str(), e.raw.as_str()))
            .collect::<Vec<_>>();
        let block_data = archive
            .block_data
            .iter()
            .map(|b| (b.name.as_str(), b.raw.as_str()))
            .collect::<Vec<_>>();

        let card_db = crate::card_db::get_card_db();
        let (registry, report) = build_registry(
            editions.iter().copied(),
            block_data.iter().copied(),
            |code, entry| {
                let mut pc = forge_foundation::sealed_product::PaperCard::new(
                    &entry.name,
                    code,
                    &entry.collector_number,
                    entry.rarity,
                );
                if let Some(rules) = card_db.get(&entry.name) {
                    pc = pc
                        .with_colors(rules.color())
                        .with_double_faced(rules.split_type.is_dual_faced());
                }
                pc
            },
        );

        eprintln!(
            "[limited_bootstrap] sheet registry ready · {} editions loaded, {} failed, templates: {}",
            report.editions_loaded,
            report.editions_failed,
            if report.booster_templates_loaded { "yes" } else { "no" }
        );
        registry
    })
}

pub fn edition_info(code: &str) -> Option<crate::limited_dto::EditionInfoDto> {
    use crate::limited_dto::{EditionInfoDto, EditionSlotDto};
    let editions = editions();
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
        forge_foundation::sealed_product::FoilType::Modern => "Modern",
        forge_foundation::sealed_product::FoilType::OldStyle => "OldStyle",
        forge_foundation::sealed_product::FoilType::NotSupported => "NotSupported",
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

pub fn dominant_set_code(pool: &[forge_foundation::sealed_product::PaperCard]) -> Option<String> {
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
