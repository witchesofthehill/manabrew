//! InternalRadiation effect — process radiation counter damage.
//!
//! Ported from Java's `InternalRadiationEffect.java`.
//! Mills cards equal to radiation counters, then the player loses life
//! equal to the number of non-land cards milled, and removes that many
//! rad counters.

use forge_foundation::ZoneType;

use super::EffectContext;
use crate::event::RunParams;
use crate::trigger::TriggerType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `InternalRadiationEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(InternalRadiationEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;
    let num_rad = ctx.game.player(controller).radiation_counters;

    if num_rad <= 0 {
        return;
    }

    // Mill cards equal to radiation counter count
    let mut non_land_count = 0;
    for _ in 0..num_rad {
        let lib = ctx.game.zone(ZoneType::Library, controller);
        if lib.cards.is_empty() {
            break;
        }
        let top_card = lib.cards[0];

        // Check if the card is non-land before moving
        let is_land = ctx.game.card(top_card).type_line.is_land();

        // Mill: move from library to graveyard
        ctx.game
            .move_card(top_card, ZoneType::Graveyard, controller);
        super::emit_zone_trigger(
            ctx.trigger_handler,
            top_card,
            ZoneType::Library,
            ZoneType::Graveyard,
        );

        if !is_land {
            non_land_count += 1;
        }
    }

    // Lose life equal to number of non-land cards milled
    if non_land_count > 0 {
        ctx.game.player_lose_life(controller, non_land_count);

        // Fire LifeLost trigger
        ctx.trigger_handler.run_trigger(
            TriggerType::LifeLost,
            RunParams {
                player: Some(controller),
                life_amount: Some(non_land_count),
                ..Default::default()
            },
            false,
        );
    }

    // Remove rad counters equal to non-land cards milled
    let current_rad = ctx.game.player(controller).radiation_counters;
    ctx.game
        .player_set_radiation(controller, (current_rad - non_land_count).max(0));
}
