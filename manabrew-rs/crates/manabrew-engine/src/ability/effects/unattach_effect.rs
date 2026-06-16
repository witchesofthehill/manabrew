//! Unattach effect — remove equipment or aura from a permanent.
//!
//! Ported 1:1 from Java's `UnattachEffect.java`.
//! Unattach: Remove an equipment/aura from the permanent it's attached to.

use super::EffectContext;
use crate::ability::ability_ir::DefinedRef;
use crate::ids::CardId;
use forge_foundation::ZoneType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `UnattachEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(UnattachEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    // Determine which card(s) to unattach
    let cards: Vec<CardId> = if sa.uses_targeting() {
        sa.target_chosen.target_card.into_iter().collect()
    } else if let Some(defined) = sa.defined_ref() {
        if matches!(defined, DefinedRef::SelfCard) {
            sa.source.into_iter().collect()
        } else {
            Vec::new()
        }
    } else {
        sa.source.into_iter().collect()
    };

    for card_id in cards {
        if ctx.game.card(card_id).zone != ZoneType::Battlefield {
            continue;
        }

        // Get what this card is attached to
        let attached_to = ctx.game.card(card_id).attached_to;
        if let Some(host_id) = attached_to {
            // Remove from host's attachments list
            ctx.game.card_mut(host_id).remove_attachment(card_id);
            // Clear the attachment link
            ctx.game.card_mut(card_id).set_attached_to(None);
        }
    }
}
