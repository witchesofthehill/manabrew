use forge_foundation::ZoneType;

use crate::card::{valid_filter, Card};
use crate::parsing::CompiledSelector;
use crate::staticability::StaticMode;

pub fn must_attack(cards: &[Card], attacker: &Card) -> bool {
    for source in cards.iter().filter(|c| c.zone == ZoneType::Battlefield) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::MustAttack))
        {
            if matches_valid_creature(st_ab.ir.valid_creature.as_ref(), attacker, source) {
                return true;
            }
        }
    }
    false
}

pub fn entities_must_attack(cards: &[Card], attacker: &Card) -> bool {
    must_attack(cards, attacker)
}

fn matches_valid_creature(valid: Option<&CompiledSelector>, card: &Card, source: &Card) -> bool {
    match valid {
        None => card.is_creature(),
        Some(selector) => valid_filter::matches_valid_card_selector(selector, card, source),
    }
}
