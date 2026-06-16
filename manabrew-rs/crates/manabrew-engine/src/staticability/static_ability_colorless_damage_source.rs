use forge_foundation::ZoneType;

use crate::card::{valid_filter, Card};
use crate::parsing::CompiledSelector;
use crate::staticability::StaticMode;

pub fn colorless_damage_source(cards: &[Card], source_card: &Card) -> bool {
    for source in cards.iter().filter(|c| c.zone == ZoneType::Battlefield) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::ColorlessDamageSource))
        {
            if matches_valid_card(st_ab.ir.valid_card.as_ref(), source_card, source) {
                return true;
            }
        }
    }
    false
}

pub fn apply_colorless_damage_source(
    st_ab: &crate::staticability::StaticAbility,
    source_card: &Card,
    source: &Card,
) -> bool {
    matches_valid_card(st_ab.ir.valid_card.as_ref(), source_card, source)
}

pub fn source_has_color(cards: &[Card], source_card: &Card, color_name: &str) -> bool {
    if colorless_damage_source(cards, source_card) {
        return color_name.eq_ignore_ascii_case("colorless");
    }
    match color_name.to_ascii_lowercase().as_str() {
        "white" => source_card.color.has_white(),
        "blue" => source_card.color.has_blue(),
        "black" => source_card.color.has_black(),
        "red" => source_card.color.has_red(),
        "green" => source_card.color.has_green(),
        "colorless" => source_card.color.is_colorless(),
        _ => false,
    }
}

pub fn target_is_protected_from_source(cards: &[Card], target: &Card, source: &Card) -> bool {
    for prot in target.get_protections() {
        match prot.as_str() {
            "white" | "blue" | "black" | "red" | "green" | "colorless" => {
                if source_has_color(cards, source, &prot) {
                    return true;
                }
            }
            "artifacts" => {
                if source.type_line.is_artifact() {
                    return true;
                }
            }
            "creatures" => {
                if source.type_line.is_creature() {
                    return true;
                }
            }
            "enchantments" => {
                if source.type_line.is_enchantment() {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn matches_valid_card(valid: Option<&CompiledSelector>, card: &Card, source: &Card) -> bool {
    valid_filter::matches_valid_card_selector_opt(valid, card, source)
}
