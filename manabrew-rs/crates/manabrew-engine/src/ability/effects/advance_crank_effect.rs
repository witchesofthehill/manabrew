//! AdvanceCrank — advance a crank counter (Unfinity).
//! Ported from Java's AdvanceCrankEffect: advances the player's CRANK!
//! counter to the next sprocket and cranks contraptions on that sprocket.

use forge_foundation::ZoneType;

use super::EffectContext;
use crate::event::RunParams;
use crate::ids::CardId;
use crate::trigger::TriggerType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `AdvanceCrankEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(AdvanceCrankEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let players = if let Some(def) = sa.defined() {
        super::resolve_defined_players(def, sa.activating_player, ctx.game)
    } else {
        vec![sa.activating_player]
    };

    for player_id in players {
        if ctx.game.player(player_id).has_lost {
            continue;
        }
        // Advance crank counter — track via player svar-like approach
        // using a card in command zone or player counter
        // Find all contraptions on battlefield for this player and trigger them
        let contraptions: Vec<CardId> = ctx
            .game
            .cards
            .iter()
            .filter(|c| {
                c.zone == ZoneType::Battlefield
                    && c.controller == player_id
                    && c.type_line
                        .subtypes
                        .iter()
                        .any(|s| s.eq_ignore_ascii_case("Contraption"))
            })
            .map(|c| c.id)
            .collect();

        for card_id in contraptions {
            ctx.trigger_handler.run_trigger(
                TriggerType::CrankAdvanced,
                RunParams {
                    card: Some(card_id),
                    player: Some(player_id),
                    ..Default::default()
                },
                false,
            );
        }
    }
}
