use crate::card::{valid_filter, Card};
use crate::spellability::SpellAbility;
use crate::staticability::StaticMode;

pub fn any_with_adapt(cards: &[Card], sa: &SpellAbility, card: &Card) -> bool {
    for source in cards.iter().filter(|c| c.zone.is_static_ability_source()) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|s| s.check_mode(&StaticMode::CanAdapt) && s.zones_check(source.zone))
        {
            if apply_with_adapt(st_ab, sa, card, source) {
                return true;
            }
        }
    }
    false
}

pub fn apply_with_adapt(
    st_ab: &crate::staticability::StaticAbility,
    sa: &SpellAbility,
    card: &Card,
    source: &Card,
) -> bool {
    if !valid_filter::matches_valid_card_selector_opt(st_ab.ir.valid_card.as_ref(), card, source) {
        return false;
    }
    if !matches_valid_sa(st_ab.ir.valid_sa.as_deref(), sa) {
        return false;
    }
    true
}

/// Match the ValidSA parameter against a SpellAbility.
/// Uses the same token grammar as the cant_sacrifice module's cause matching.
fn matches_valid_sa(valid: Option<&str>, sa: &SpellAbility) -> bool {
    super::static_ability_cant_sacrifice::matches_valid_cause(valid, Some(sa))
}
