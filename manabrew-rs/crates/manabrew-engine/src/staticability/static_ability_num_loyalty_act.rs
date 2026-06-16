use crate::card::{valid_filter, Card};
use crate::spellability::SpellAbility;
use crate::staticability::StaticMode;

/// Apply the limit increase check for a single static ability.
///
/// Mirrors Java's `StaticAbilityNumLoyaltyAct.applyLimitIncrease()`.
pub fn apply_limit_increase(
    st_ab: &crate::staticability::StaticAbility,
    card: &Card,
    source: &Card,
) -> bool {
    if !valid_filter::matches_valid_card_selector_opt(st_ab.ir.valid_card.as_ref(), card, source) {
        return false;
    }
    st_ab.ir.twice
}

/// Check if a planeswalker can activate loyalty abilities twice per turn.
///
/// Mirrors Java's `StaticAbilityNumLoyaltyAct.limitIncrease()`.
pub fn limit_increase(cards: &[Card], card: &Card) -> bool {
    for source in cards.iter().filter(|c| c.zone.is_static_ability_source()) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::NumLoyaltyAct) && sa.zones_check(source.zone))
        {
            if apply_limit_increase(st_ab, card, source) {
                return true;
            }
        }
    }
    false
}

/// Count additional loyalty activations from static abilities.
///
/// Mirrors Java's `StaticAbilityNumLoyaltyAct.additionalActivations()`.
/// The `sa` parameter is the SpellAbility being activated (used for OnlySourceAbs check).
pub fn additional_activations(cards: &[Card], card: &Card, sa: Option<&SpellAbility>) -> i32 {
    let mut addl = 0;
    for source in cards.iter().filter(|c| c.zone.is_static_ability_source()) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|s| s.check_mode(&StaticMode::NumLoyaltyAct) && s.zones_check(source.zone))
        {
            if !valid_filter::matches_valid_card_selector_opt(
                st_ab.ir.valid_card.as_ref(),
                card,
                source,
            ) {
                continue;
            }
            if let Some(additional) = st_ab.ir.additional_text.as_deref() {
                // OnlySourceAbs$ — if present, only count if the SA being activated
                // is the original ability from the effect source card.
                if st_ab.ir.only_source_abs {
                    // Java: stAb.getHostCard().getEffectSourceAbility().getRootAbility()
                    //       .getOriginalAbility().equals(sa)
                    // In Rust, we approximate by checking if the SA's source card matches
                    // the static host's effect_source.
                    if let Some(spell_ability) = sa {
                        let sa_source = spell_ability.source;
                        let effect_source = source.effect_source;
                        // If the SA's source doesn't match the effect source, skip.
                        if sa_source != effect_source {
                            continue;
                        }
                    } else {
                        // No SA provided but OnlySourceAbs required — skip.
                        continue;
                    }
                }

                // Java: AbilityUtils.calculateAmount(card, additional, stAb)
                // TODO: support expression-based calculateAmount when ported.
                addl += additional.parse::<i32>().unwrap_or(0);
            }
        }
    }
    addl
}
