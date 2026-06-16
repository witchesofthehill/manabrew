use forge_foundation::ZoneType;

use crate::card::{valid_filter, Card};
use crate::parsing::CompiledSelector;
use crate::staticability::StaticMode;

pub fn ignore_legend_rule(cards: &[Card], card: &Card) -> bool {
    for source in cards.iter().filter(|c| c.zone == ZoneType::Battlefield) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::IgnoreLegendRule))
        {
            if !matches_valid_card(st_ab.ir.valid_card.as_ref(), card, source) {
                continue;
            }
            if !is_present_condition_met(cards, st_ab, source) {
                continue;
            }
            return true;
        }
    }
    false
}

fn matches_valid_card(valid: Option<&CompiledSelector>, card: &Card, source: &Card) -> bool {
    valid_filter::matches_valid_card_selector_opt(valid, card, source)
}

fn is_present_condition_met(
    cards: &[Card],
    st_ab: &crate::staticability::StaticAbility,
    source: &Card,
) -> bool {
    let Some(is_present) = st_ab.ir.is_present.as_ref() else {
        return true;
    };
    let count = cards
        .iter()
        .filter(|c| c.zone == ZoneType::Battlefield)
        .filter(|c| matches_valid_card(Some(is_present), c, source))
        .count() as i32;
    let cmp = st_ab.ir.present_compare_text.as_deref().unwrap_or("GE1");
    match cmp {
        "EQ2" => count == 2,
        "EQ1" => count == 1,
        "GE1" => count >= 1,
        _ => count >= 1,
    }
}
