use super::card_edition::{CardEdition, EditionEntry, EditionType};
use crate::sealed_product::foil_type::FoilType;
use crate::sealed_product::rarity::Rarity;

pub fn parse_edition(body: &str) -> CardEdition {
    let mut edition = CardEdition::default();
    let mut current_section = String::from("metadata");
    let mut custom_sheet_buf: Option<(String, Vec<String>)> = None;

    for raw in body.lines() {
        let line = strip_comments(raw).trim();
        if line.is_empty() {
            continue;
        }

        if let Some(rest) = line.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            if let Some((name, rows)) = custom_sheet_buf.take() {
                edition.custom_sheets.insert(name, rows);
            }
            current_section = rest.to_ascii_lowercase();
            if !matches!(
                current_section.as_str(),
                "metadata" | "cards" | "tokens" | "removed cards" | "other cards"
            ) {
                custom_sheet_buf = Some((rest.to_string(), Vec::new()));
            }
            continue;
        }

        match current_section.as_str() {
            "metadata" => apply_metadata(&mut edition, line),
            "cards" => {
                if let Some(entry) = parse_card_row(line) {
                    edition.cards.push(entry);
                }
            }
            "tokens" | "removed cards" | "other cards" => {}
            _ => {
                if let Some((_, rows)) = custom_sheet_buf.as_mut() {
                    rows.push(line.to_string());
                }
            }
        }
    }
    if let Some((name, rows)) = custom_sheet_buf.take() {
        edition.custom_sheets.insert(name, rows);
    }
    edition
}

fn strip_comments(line: &str) -> &str {
    if let Some(idx) = line.find('#') {
        if idx == 0 {
            return "";
        }
    }
    line
}

fn apply_metadata(edition: &mut CardEdition, line: &str) {
    let (key, value) = match line.split_once('=') {
        Some(kv) => kv,
        None => return,
    };
    let key = key.trim();
    let value = value.trim();

    match key.to_ascii_lowercase().as_str() {
        "code" => edition.code = value.to_string(),
        "code2" => edition.code2 = Some(value.to_string()),
        "scryfallcode" => edition.scryfall_code = Some(value.to_string()),
        "name" => edition.name = value.to_string(),
        "date" => edition.date = Some(value.to_string()),
        "type" => edition.edition_type = EditionType::parse(value),
        "foiltype" => edition.foil_type = parse_foil_type(value),
        "foilchanceinbooster" => {
            if let Ok(v) = value.parse::<f64>() {
                edition.foil_chance_in_booster = v;
            }
        }
        "foilalwaysincommonslot" => {
            edition.foil_always_in_common_slot = parse_bool(value);
        }
        "additionalsheetforfoils" => {
            edition.additional_sheet_for_foils = nonempty(value);
        }
        "chancereplacecommonwith" => {
            if let Ok(v) = value.parse::<f64>() {
                edition.chance_replace_common_with = v;
            }
        }
        "slotreplacecommonwith" => {
            edition.slot_replace_common_with = nonempty(value);
        }
        "boostermustcontain" => {
            edition.booster_must_contain = nonempty(value);
        }
        "boosterreplaceslotfromprintsheet" => {
            edition.booster_replace_slot_from_print_sheet = nonempty(value);
        }
        "sheetreplacecardfromsheet" => {
            edition.sheet_replace_card_from_sheet = nonempty(value);
        }
        "sheetreplacecardfromsheet2" => {
            edition.sheet_replace_card_from_sheet2 = nonempty(value);
        }
        "booster" => edition.booster = Some(value.to_string()),
        "draftbooster" => edition.draft_booster = Some(value.to_string()),
        other if other.starts_with("booster") && other != "booster" => {
            let suffix = &key["Booster".len()..];
            if !matches!(
                suffix.to_ascii_lowercase().as_str(),
                "covers"
                    | "boxcount"
                    | "musthave"
                    | "mustcontain"
                    | "replaceslotfromprintsheet"
                    | "arts"
            ) {
                edition
                    .extra_boosters
                    .insert(suffix.to_string(), value.to_string());
            }
        }
        "alias" => edition.alias = nonempty(value),
        "boostercovers" => {
            if let Ok(n) = value.parse::<u32>() {
                edition.booster_covers = n;
            }
        }
        "boosterboxcount" => {
            if let Ok(n) = value.parse::<u32>() {
                edition.booster_box_count = n;
            }
        }
        "fatpackcount" => {
            if let Ok(n) = value.parse::<u32>() {
                edition.fat_pack_count = n;
            }
        }
        "prerelease" => edition.prerelease = nonempty(value),
        "additionalunlockset" => edition.additional_unlock_set = nonempty(value),
        "smallsetoverride" => edition.small_set_override = parse_bool(value),
        _ => {}
    }
}

fn parse_foil_type(s: &str) -> FoilType {
    match s.trim().to_ascii_uppercase().as_str() {
        "MODERN" => FoilType::Modern,
        "OLD_STYLE" | "OLDSTYLE" | "OLD" => FoilType::OldStyle,
        _ => FoilType::NotSupported,
    }
}

fn parse_bool(s: &str) -> bool {
    matches!(
        s.trim().to_ascii_lowercase().as_str(),
        "true" | "yes" | "1" | "on"
    )
}

fn nonempty(s: &str) -> Option<String> {
    let t = s.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

fn parse_card_row(line: &str) -> Option<EditionEntry> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let (number, rest) = trimmed.split_once(' ')?;
    let rest = rest.trim();
    let (rarity_str, name_part) = rest.split_once(' ')?;
    let rarity = parse_rarity_letter(rarity_str)?;
    let (name, artist) = match name_part.split_once('@') {
        Some((n, a)) => (n.trim().to_string(), Some(a.trim().to_string())),
        None => (name_part.trim().to_string(), None),
    };
    if name.is_empty() {
        return None;
    }
    Some(EditionEntry {
        collector_number: number.trim().to_string(),
        rarity,
        name,
        artist,
    })
}

fn parse_rarity_letter(letter: &str) -> Option<Rarity> {
    let trimmed = letter.trim();
    let head = trimmed.chars().next()?.to_ascii_uppercase();
    Some(match head {
        'M' => Rarity::Mythic,
        'R' => Rarity::Rare,
        'U' => Rarity::Uncommon,
        'C' => Rarity::Common,
        'L' => Rarity::BasicLand,
        'S' | 'P' => Rarity::Special,
        'T' => Rarity::Token,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const M21_HEAD: &str = "[metadata]
Code=M21
Date=2020-07-03
Name=Core Set 2021
Type=Core
Booster=10 Common:fromSheet(\"M21 cards\"):!fromSheet(\"M21 Lands\"), 3 Uncommon:fromSheet(\"M21 cards\"), 1 RareMythic:fromSheet(\"M21 cards\"), 1 fromSheet(\"M21 Lands\")
ScryfallCode=M21

[cards]
1 M Ugin, the Spirit Dragon @Raymond Swanland
2 C Alpine Watchdog @Forrest Imel
3 U Angelic Ascension @Volkan Baga
9 R Basri's Lieutenant @Matt Stewart
";

    #[test]
    fn parses_m21_metadata_and_card_rows() {
        let edition = parse_edition(M21_HEAD);
        assert_eq!(edition.code, "M21");
        assert_eq!(edition.name, "Core Set 2021");
        assert_eq!(edition.scryfall_code.as_deref(), Some("M21"));
        assert_eq!(edition.edition_type, EditionType::Core);
        assert_eq!(edition.cards.len(), 4);
        assert_eq!(edition.cards[0].rarity, Rarity::Mythic);
        assert_eq!(edition.cards[0].name, "Ugin, the Spirit Dragon");
        assert!(edition.booster.as_ref().unwrap().contains("RareMythic"));
    }

    #[test]
    fn metadata_carries_into_template() {
        let body = "[metadata]
Code=M21
Name=Core Set 2021
Type=Core
FoilType=MODERN
FoilChanceInBooster=0.33
Booster=10 Common, 3 Uncommon, 1 RareMythic, 1 BasicLand

[cards]
1 M Sample
";
        let edition = parse_edition(body);
        let tpl = edition.to_sealed_template().expect("booster template");
        assert_eq!(tpl.foil_type, FoilType::Modern);
        assert!((tpl.foil_chance - 0.33).abs() < 1e-6);
        assert_eq!(tpl.slots.len(), 4);
    }

    #[test]
    fn captures_custom_print_sheets() {
        let body = "[metadata]
Code=ZZ
Name=Test

[ZZ Lands]
1 Plains
1 Island

[ZZ cards]
1 Sample
";
        let edition = parse_edition(body);
        assert!(edition.custom_sheets.contains_key("ZZ Lands"));
        assert!(edition.custom_sheets.contains_key("ZZ cards"));
        assert_eq!(edition.custom_sheets["ZZ Lands"].len(), 2);
    }
}
