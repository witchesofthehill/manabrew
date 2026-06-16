use forge_foundation::ZoneType;

use crate::card::{valid_filter, Card};
use crate::spellability::SpellAbility;
use crate::staticability::StaticMode;

pub fn cant_sacrifice(
    cards: &[Card],
    card: &Card,
    cause: Option<&SpellAbility>,
    is_cost: bool,
) -> bool {
    for source in cards.iter().filter(|c| c.zone == ZoneType::Battlefield) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::CantSacrifice))
        {
            if let Some(for_cost) = st_ab.ir.for_cost {
                if for_cost != is_cost {
                    continue;
                }
            }
            if !matches_valid_card(st_ab.ir.valid_card.as_ref(), card, source) {
                continue;
            }
            if !matches_valid_cause(st_ab.ir.valid_cause_text.as_deref(), cause) {
                continue;
            }
            return true;
        }
    }
    false
}

pub fn apply_cant_sacrifice_ability(
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
        && matches_valid_cause(st_ab.ir.valid_cause_text.as_deref(), cause)
}

fn matches_valid_card(
    valid: Option<&crate::parsing::CompiledSelector>,
    card: &Card,
    source: &Card,
) -> bool {
    valid_filter::matches_valid_card_selector_opt(valid, card, source)
}

pub(crate) fn matches_valid_cause(valid: Option<&str>, cause: Option<&SpellAbility>) -> bool {
    let Some(valid) = valid else {
        return true;
    };
    let Some(cause) = cause else {
        return false;
    };

    valid.split(',').any(|token| {
        let token = token.trim();
        if token.is_empty() {
            return false;
        }

        let mut segments = token.split('.');
        let head = segments.next().unwrap_or("");
        let base_ok = if head.eq_ignore_ascii_case("SpellAbility") {
            true
        } else if head.eq_ignore_ascii_case("Spell") {
            cause.is_spell
        } else if head.eq_ignore_ascii_case("Activated") {
            !cause.is_spell && !cause.is_trigger
        } else if head.eq_ignore_ascii_case("Triggered") {
            cause.is_trigger
        } else if head.eq_ignore_ascii_case("Ability") {
            !cause.is_spell
        } else {
            false
        };
        if !base_ok {
            return false;
        }

        for qualifier in segments {
            let q = qualifier.trim();
            if q.eq_ignore_ascii_case("EffectSource") && !cause.ir.effect_source {
                return false;
            }
            if q.eq_ignore_ascii_case("!EffectSource") && cause.ir.effect_source {
                return false;
            }
        }
        true
    })
}
