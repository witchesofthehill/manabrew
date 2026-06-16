//! AssignGroup — assign creatures to groups (Conspiracy draft).
//! Ported from Java's AssignGroupEffect: assigns defined objects to groups
//! chosen by the player, then resolves sub-abilities for each group.

use super::EffectContext;
use crate::ids::CardId;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `AssignGroupEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(AssignGroupEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let source = match sa.source {
        Some(s) => s,
        None => return,
    };

    // Get defined cards to assign
    let targets: Vec<CardId> = if let Some(target) = sa.target_chosen.target_card {
        vec![target]
    } else {
        ctx.game.card(source).remembered_cards.clone()
    };

    if targets.is_empty() {
        return;
    }

    // Auto-assign all to group 1 (agent would choose in full implementation)
    // Remember the assigned cards
    for card_id in &targets {
        ctx.game.card_mut(source).add_remembered_card(*card_id);
    }
}
