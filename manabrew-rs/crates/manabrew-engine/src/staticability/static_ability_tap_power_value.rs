use crate::card::{valid_filter, Card};
use crate::spellability::{matches_valid_sa, SpellAbility};
use crate::staticability::StaticMode;

/// Check if a card should use toughness as its tap power value.
pub fn with_toughness(cards: &[Card], card: &Card, sa: Option<&SpellAbility>) -> bool {
    for source in cards.iter().filter(|c| c.zone.is_static_ability_source()) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|s| s.check_mode(&StaticMode::TapPowerValue) && s.zones_check(source.zone))
        {
            match st_ab.ir.value_text.as_deref() {
                Some(val) if val.eq_ignore_ascii_case("Toughness") => {}
                _ => continue,
            }

            // ValidCard$
            if !valid_filter::matches_valid_card_selector_opt(
                st_ab.ir.valid_card.as_ref(),
                card,
                source,
            ) {
                continue;
            }

            if let Some(valid_sa) = st_ab.ir.valid_sa.as_deref() {
                let Some(sa) = sa else {
                    continue;
                };
                if !matches_valid_sa(valid_sa, sa, source, ability_host(cards, sa)) {
                    continue;
                }
            }

            return true;
        }
    }
    false
}

/// Get the modifier for tap power value.
pub fn get_mod(cards: &[Card], card: &Card, sa: Option<&SpellAbility>) -> i32 {
    let mut total = 0;
    for source in cards.iter().filter(|c| c.zone.is_static_ability_source()) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|s| s.check_mode(&StaticMode::TapPowerValue) && s.zones_check(source.zone))
        {
            // ValidCard$
            if !valid_filter::matches_valid_card_selector_opt(
                st_ab.ir.valid_card.as_ref(),
                card,
                source,
            ) {
                continue;
            }

            if let Some(valid_sa) = st_ab.ir.valid_sa.as_deref() {
                let Some(sa) = sa else {
                    continue;
                };
                if !matches_valid_sa(valid_sa, sa, source, ability_host(cards, sa)) {
                    continue;
                }
            }

            if let Some(val) = st_ab.ir.value_text.as_deref() {
                total += val.parse::<i32>().unwrap_or(0);
            }
        }
    }
    total
}

fn ability_host<'a>(cards: &'a [Card], sa: &SpellAbility) -> Option<&'a Card> {
    let source = sa.source?;
    cards.get(source.index())
}
