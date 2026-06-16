use crate::card::{valid_filter, Card};
use crate::staticability::StaticMode;

pub fn cant_phase_in(cards: &[Card], card: &Card) -> bool {
    cant_phase(cards, card, StaticMode::CantPhaseIn)
}

pub fn cant_phase_out(cards: &[Card], card: &Card) -> bool {
    cant_phase(cards, card, StaticMode::CantPhaseOut)
}

fn cant_phase(cards: &[Card], card: &Card, mode: StaticMode) -> bool {
    for source in cards.iter().filter(|c| c.zone.is_static_ability_source()) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&mode) && sa.zones_check(source.zone))
        {
            if valid_filter::matches_valid_card_selector_opt(
                st_ab.ir.valid_card.as_ref(),
                card,
                source,
            ) {
                return true;
            }
        }
    }
    false
}
