//! Block effect — force a creature to block a specific attacker.
//!
//! Ported from Java's `BlockEffect.java`.
//! Target creature blocks target attacker this combat if able.

use forge_foundation::ZoneType;

use super::EffectContext;
use crate::ability::ability_ir::DefinedRef;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `BlockEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(BlockEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let targets: Vec<crate::ids::CardId> = if sa.uses_targeting() {
        sa.target_chosen.target_card.into_iter().collect()
    } else if let Some(def) = sa.defined_ref() {
        if matches!(def, DefinedRef::SelfCard) {
            sa.source.into_iter().collect()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    for card_id in targets {
        if ctx.game.card(card_id).zone != ZoneType::Battlefield {
            continue;
        }
        // Mark creature as "must block" — the combat system checks this flag
        ctx.game.card_mut(card_id).set_must_block(true);
    }
}
