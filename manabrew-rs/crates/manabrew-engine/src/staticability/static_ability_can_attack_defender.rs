use forge_foundation::ZoneType;

use crate::card::{valid_filter, Card};
use crate::ids::PlayerId;
use crate::staticability::StaticMode;

pub fn can_attack_defender(cards: &[Card], card: &Card, defender: PlayerId) -> bool {
    for source in cards
        .iter()
        .filter(|c| c.zone == ZoneType::Battlefield || c.zone == ZoneType::Command)
    {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::CanAttackDefender))
        {
            if !matches_valid_card(st_ab.ir.valid_card.as_ref(), card, source) {
                continue;
            }
            if !valid_filter::matches_valid_player_selector_opt(
                st_ab.ir.valid_attacked.as_ref(),
                defender,
                source.controller,
            ) {
                continue;
            }
            return true;
        }
    }
    false
}

fn matches_valid_card(
    valid: Option<&crate::parsing::CompiledSelector>,
    card: &Card,
    source: &Card,
) -> bool {
    valid_filter::matches_valid_card_selector_opt(valid, card, source)
}
