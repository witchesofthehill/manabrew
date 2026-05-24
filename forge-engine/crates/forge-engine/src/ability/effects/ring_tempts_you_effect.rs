//! RingTempts effect — The Ring tempts you (Lord of the Rings mechanic).
//!
//! Ported from Java's `RingTemptsYouEffect.java`.
//! The Ring tempts you: Your Ring-bearer gains the next level of abilities.
//! If you don't have a Ring-bearer, choose a creature you control.

use forge_foundation::ZoneType;

use super::EffectContext;
use crate::event::RunParams;
use crate::ids::{CardId, PlayerId};
use crate::player::player_factory_util::{add_static_ability, add_trigger_ability};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

/// Controller-change / leaves-play callback for the Ring-bearer.
/// Mirrors the `GameCommand.run()` in Java `RingTemptsYouEffect` that clears
/// the ring-bearer designation when the creature changes controller or
/// leaves the battlefield.
pub fn run(game: &mut crate::game::GameState, player: crate::ids::PlayerId) {
    // If the ring-bearer is no longer controlled by this player or left play,
    // clear the ring-bearer designation.
    if let Some(bearer_id) = game.player(player).ring_bearer {
        let bearer = game.card(bearer_id);
        if bearer.zone != ZoneType::Battlefield || bearer.controller != player {
            game.player_mut(player).ring_bearer = None;
        }
    }
}

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `RingTemptsYouEffect` class extending `SpellAbilityEffect`.
#[forge_engine_macros::spell_effect(RingTemptsYouEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;
    let players = if let Some(def) = sa.defined_player() {
        super::resolve_defined_players(def, controller, ctx.game)
    } else {
        vec![controller]
    };

    for pid in players {
        ring_tempts(ctx, sa, pid);
    }
}

fn ring_tempts(ctx: &mut EffectContext, _sa: &SpellAbility, player: PlayerId) {
    crate::player::create_the_ring(ctx.game, player);

    let current_level = ctx.game.player(player).ring_level;
    if current_level < 4 {
        ctx.game.player_ring_tempt(player);
        set_ring_level(ctx, player, current_level + 1);
    }

    let creatures: Vec<CardId> = ctx
        .game
        .cards
        .iter()
        .filter(|c| {
            c.zone == ZoneType::Battlefield
                && c.controller == player
                && c.type_line
                    .core_types
                    .iter()
                    .any(|ct| matches!(ct, forge_foundation::CoreType::Creature))
        })
        .map(|c| c.id)
        .collect();

    let mut ring_bearer = None;
    if !creatures.is_empty() {
        ctx.agents[player.index()].snapshot_state(ctx.game, ctx.mana_pools);
        if let Some(chosen) = ctx.agents[player.index()].choose_single_card_for_zone_change(
            player,
            &creatures,
            "Choose your Ring-bearer",
            false,
        ) {
            ctx.game.player_set_ring_bearer(player, Some(chosen));
            ring_bearer = Some(chosen);
        }
    }

    ctx.trigger_handler.run_trigger(
        TriggerType::RingTemptsYou,
        RunParams {
            player: Some(player),
            card: ring_bearer,
            ..Default::default()
        },
        false,
    );
}

fn set_ring_level(ctx: &mut EffectContext, player: PlayerId, level: i32) {
    let Some(effect_id) = ctx.game.player(player).ring_effect_card else {
        return;
    };

    let changed = {
        let effect = ctx.game.card_mut(effect_id);
        match level {
            1 => {
                add_static_ability(
                    effect,
                    "Mode$ Continuous | EffectZone$ Command | Affected$ Card.YouCtrl+IsRingbearer | AddType$ Legendary | Description$ Your Ring-bearer is legendary.",
                ) | add_static_ability(
                    effect,
                    "Mode$ CantBlockBy | EffectZone$ Command | ValidAttacker$ Card.YouCtrl+IsRingbearer | ValidBlockerRelative$ Creature.powerGTX | Description$ Your Ring-bearer can't be blocked by creatures with greater power.",
                )
            }
            2 => add_trigger_ability(
                effect,
                "Mode$ Attacks | ValidCard$ Card.YouCtrl+IsRingbearer | Execute$ RingAttackDraw | TriggerDescription$ Whenever your Ring-bearer attacks, draw a card, then discard a card. | TriggerZones$ Command",
                [
                    (
                        "RingAttackDraw",
                        "DB$ Draw | Defined$ You | NumCards$ 1 | SubAbility$ RingAttackDiscard",
                    ),
                    (
                        "RingAttackDiscard",
                        "DB$ Discard | Defined$ You | NumCards$ 1 | Mode$ TgtChoose",
                    ),
                ],
            ),
            _ => false,
        }
    };

    if changed {
        ctx.trigger_handler.unregister_active_triggers(effect_id);
        ctx.trigger_handler
            .register_active_trigger(ctx.game, effect_id);
    }
}
