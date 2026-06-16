use forge_foundation::ZoneType;

use crate::card::{valid_filter, Card};
use crate::ids::PlayerId;
use crate::parsing::CompiledSelector;
use crate::staticability::StaticMode;

pub fn cant_attach(cards: &[Card], attachment: &Card, target: &Card, check_sba: bool) -> bool {
    for source in cards.iter().filter(|c| c.zone == ZoneType::Battlefield) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::CantAttach))
        {
            if !matches_valid_card(st_ab.ir.valid_card.as_ref(), attachment, source) {
                continue;
            }
            if !matches_valid_card(st_ab.ir.target.as_ref(), target, source) {
                continue;
            }
            if let Some(valid_card_to_target) = st_ab.ir.valid_card_to_target.as_ref() {
                if !matches_valid_card_for_target(attachment, valid_card_to_target, target) {
                    continue;
                }
            }
            if (check_sba || !st_ab.ir.exception_sba)
                && st_ab.ir.exceptions.is_some()
                && matches_valid_card(st_ab.ir.exceptions.as_ref(), attachment, source)
            {
                continue;
            }
            return true;
        }
    }
    false
}

/// Java parity alias for single-ability evaluation.
pub fn apply_cant_attach_ability(
    st_ab: &crate::staticability::StaticAbility,
    source: &Card,
    attachment: &Card,
    target: &Card,
    activator: PlayerId,
) -> bool {
    matches_valid_card(st_ab.ir.valid_card.as_ref(), attachment, source)
        && matches_valid_card(st_ab.ir.target.as_ref(), target, source)
        && valid_filter::matches_valid_player_opt(
            st_ab.ir.activator_raw.as_deref(),
            activator,
            source.controller,
        )
}

fn matches_valid_card(valid: Option<&CompiledSelector>, card: &Card, source: &Card) -> bool {
    valid_filter::matches_valid_card_selector_opt(valid, card, source)
}

fn matches_valid_card_for_target(card: &Card, valid: &CompiledSelector, target: &Card) -> bool {
    valid.alternatives.iter().any(|alternative| {
        alternative
            .parts
            .iter()
            .map(|part| part.value.as_str())
            .all(|tok| match tok {
                "Card" | "Permanent" => true,
                "Creature" => card.is_creature(),
                "Card.Self" => card.id == target.id,
                "Self" => card.id == target.id,
                "nonLegendary" => !target.type_line.is_legendary(),
                "Legendary" => target.type_line.is_legendary(),
                _ => true,
            })
    })
}
