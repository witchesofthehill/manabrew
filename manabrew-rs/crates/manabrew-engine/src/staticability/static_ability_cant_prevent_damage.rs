use forge_foundation::ZoneType;

use crate::card::{valid_filter, Card};
use crate::ids::CardId;
use crate::staticability::StaticMode;

/// Check whether damage from `source_id` cannot be prevented.
/// Mirrors Java's StaticAbilityCantPreventDamage.cantPreventDamage().
pub fn cant_prevent_damage(cards: &[Card], source_id: CardId, is_combat: bool) -> bool {
    let source_card = &cards[source_id.index()];

    for static_source in cards.iter().filter(|c| c.zone == ZoneType::Battlefield) {
        for st_ab in static_source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::CantPreventDamage))
        {
            if applies(st_ab, source_card, static_source, is_combat) {
                return true;
            }
        }
    }

    // Java also considers the damage source itself as a potential host.
    if source_card.zone != ZoneType::Battlefield {
        for st_ab in source_card
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::CantPreventDamage))
        {
            if applies(st_ab, source_card, source_card, is_combat) {
                return true;
            }
        }
    }

    false
}

/// Mirrors Java's `StaticAbilityCantPreventDamage.applyCantPreventDamage()`.
pub fn apply_cant_prevent_damage(
    st_ab: &crate::staticability::static_ability::StaticAbility,
    damage_source: &Card,
    host: &Card,
    is_combat: bool,
) -> bool {
    applies(st_ab, damage_source, host, is_combat)
}

fn applies(
    st_ab: &crate::staticability::static_ability::StaticAbility,
    damage_source: &Card,
    host: &Card,
    is_combat: bool,
) -> bool {
    if let Some(required) = st_ab.ir.is_combat {
        if required != is_combat {
            return false;
        }
    }

    valid_filter::matches_valid_card_selector_opt(
        st_ab.ir.valid_source.as_ref(),
        damage_source,
        host,
    )
}
