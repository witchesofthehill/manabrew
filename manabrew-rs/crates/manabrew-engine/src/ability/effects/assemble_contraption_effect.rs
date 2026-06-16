//! AssembleContraption — assemble contraptions from the contraption deck (Unstable).
//! Ported from Java's AssembleContraptionEffect: moves top card of contraption
//! deck to battlefield, assigns a sprocket.

use forge_foundation::ZoneType;

use super::EffectContext;
use crate::parsing::keys;
use crate::replacement::replacement_handler::{apply_replacements, ReplacementEvent};
use crate::replacement::ReplacementResult;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `AssembleContraptionEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(AssembleContraptionEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let source = match sa.source {
        Some(s) => s,
        None => return,
    };

    let amount = super::resolve_numeric_svar(ctx.game, sa, "Amount", 1).max(1);

    let controller = sa.activating_player;

    // Run AssembleContraption replacement effects before assembling.
    let mut event = ReplacementEvent::AssembleContraption { player: controller };
    let result = apply_replacements(ctx.game, &mut event);
    if result == ReplacementResult::Skipped || result == ReplacementResult::Replaced {
        return;
    }

    for _ in 0..amount {
        let contraption = ctx
            .game
            .cards_in_zone(ZoneType::ContraptionDeck, controller)
            .first()
            .copied()
            .or_else(|| {
                // Compatibility fallback until full deck-section setup is wired.
                ctx.game
                    .cards
                    .iter()
                    .find(|c| {
                        c.owner == controller
                            && c.zone == ZoneType::Sideboard
                            && c.type_line
                                .subtypes
                                .iter()
                                .any(|s| s.eq_ignore_ascii_case("Contraption"))
                    })
                    .map(|c| c.id)
            });

        if let Some(card_id) = contraption {
            let old_zone = ctx.game.card(card_id).zone;
            ctx.game
                .move_card(card_id, ZoneType::Battlefield, controller);
            super::emit_zone_trigger(
                ctx.trigger_handler,
                card_id,
                old_zone,
                ZoneType::Battlefield,
            );

            // Assign a sprocket (1-3)
            let sprocket = (ctx.rng.next_int(3) + 1).to_string();
            ctx.game
                .card_mut(card_id)
                .svars
                .insert("Sprocket".to_string(), sprocket);

            if sa.param_is_true(keys::REMEMBER) {
                ctx.game.card_mut(source).add_remembered_card(card_id);
            }
        }
    }
}
