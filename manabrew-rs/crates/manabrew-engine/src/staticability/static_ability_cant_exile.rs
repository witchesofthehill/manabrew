use forge_foundation::ZoneType;

use crate::card::{valid_filter, Card};
use crate::spellability::SpellAbility;
use crate::staticability::StaticMode;

pub fn cant_exile(
    cards: &[Card],
    card: &Card,
    cause: Option<&SpellAbility>,
    is_cost: bool,
) -> bool {
    for source in cards.iter().filter(|c| c.zone == ZoneType::Battlefield) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::CantExile))
        {
            if let Some(for_cost) = st_ab.ir.for_cost {
                if for_cost != is_cost {
                    continue;
                }
            }
            if !matches_valid_card(st_ab.ir.valid_card.as_ref(), card, source) {
                continue;
            }
            if !super::static_ability_cant_sacrifice::matches_valid_cause(
                st_ab.ir.valid_cause_text.as_deref(),
                cause,
            ) {
                continue;
            }
            return true;
        }
    }
    false
}

pub fn apply_cant_exile_ability(
    st_ab: &crate::staticability::StaticAbility,
    card: &Card,
    source: &Card,
    cause: Option<&SpellAbility>,
    is_cost: bool,
) -> bool {
    if let Some(for_cost) = st_ab.ir.for_cost {
        if for_cost != is_cost {
            return false;
        }
    }
    matches_valid_card(st_ab.ir.valid_card.as_ref(), card, source)
        && super::static_ability_cant_sacrifice::matches_valid_cause(
            st_ab.ir.valid_cause_text.as_deref(),
            cause,
        )
}

fn matches_valid_card(
    valid: Option<&crate::parsing::CompiledSelector>,
    card: &Card,
    source: &Card,
) -> bool {
    valid_filter::matches_valid_card_selector_opt(valid, card, source)
}
