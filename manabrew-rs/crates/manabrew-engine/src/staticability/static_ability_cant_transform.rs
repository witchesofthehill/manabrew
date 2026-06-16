use crate::card::{valid_filter, Card};
use crate::spellability::SpellAbility;
use crate::staticability::StaticMode;

pub fn cant_transform(cards: &[Card], card: &Card, cause: Option<&SpellAbility>) -> bool {
    for source in cards.iter().filter(|c| c.zone.is_static_ability_source()) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::CantTransform) && sa.zones_check(source.zone))
        {
            if apply_cant_transform_ability(st_ab, card, source, cause) {
                return true;
            }
        }
    }
    false
}

pub fn apply_cant_transform_ability(
    st_ab: &crate::staticability::StaticAbility,
    card: &Card,
    source: &Card,
    cause: Option<&SpellAbility>,
) -> bool {
    if !valid_filter::matches_valid_card_selector_opt(st_ab.ir.valid_card.as_ref(), card, source) {
        return false;
    }
    // Java: if stAb.hasParam("ExceptCause") { if stAb.matchesValidParam("ExceptCause", cause) return false }
    if let Some(except_cause) = st_ab.ir.except_cause_text.as_deref() {
        if let Some(cause) = cause {
            if matches_except_cause(except_cause, cause) {
                return false;
            }
        }
    }
    true
}

/// Checks if the cause matches the ExceptCause filter.
/// In Java, `matchesValidParam("ExceptCause", cause)` delegates to the same
/// CardTraitBase validation used elsewhere. Here we reuse `matches_valid_cause`
/// with the same token grammar (SpellAbility, Spell, Activated, etc.).
fn matches_except_cause(except_cause: &str, cause: &SpellAbility) -> bool {
    super::static_ability_cant_sacrifice::matches_valid_cause(Some(except_cause), Some(cause))
}
