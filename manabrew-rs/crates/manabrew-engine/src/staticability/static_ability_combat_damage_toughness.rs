use forge_foundation::ZoneType;

use crate::card::{valid_filter, Card};
use crate::staticability::StaticMode;

pub fn combat_damage_uses_toughness(cards: &[Card], card: &Card) -> bool {
    for source in cards
        .iter()
        .filter(|c| c.zone == ZoneType::Battlefield || c.zone == ZoneType::Command)
    {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::CombatDamageToughness))
        {
            if matches_valid_card(st_ab.ir.valid_card.as_ref(), card, source) {
                return true;
            }
        }
    }
    false
}

pub fn combat_damage_toughness(cards: &[Card], card: &Card) -> bool {
    combat_damage_uses_toughness(cards, card)
}

pub fn apply_combat_damage_toughness_ability(
    st_ab: &crate::staticability::StaticAbility,
    card: &Card,
    source: &Card,
) -> bool {
    matches_valid_card(st_ab.ir.valid_card.as_ref(), card, source)
}

fn matches_valid_card(
    valid: Option<&crate::parsing::CompiledSelector>,
    card: &Card,
    source: &Card,
) -> bool {
    valid_filter::matches_valid_card_selector_opt(valid, card, source)
}
