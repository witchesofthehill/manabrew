//! Abandon — leave a game in a multiplayer match.
//! Ported from Java's AbandonEffect: sets player as lost.

use super::EffectContext;
use crate::event::RunParams;
use crate::parsing::keys;
use crate::trigger::TriggerType;
use forge_foundation::ZoneType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `AbandonEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(AbandonEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let Some(source_id) = sa.source else {
        return;
    };
    let controller = ctx.game.card(source_id).controller;

    if sa.param_is_true(keys::OPTIONAL) {
        let source_name = ctx.game.card(source_id).card_name.clone();
        let confirmed = ctx.agents[controller.index()].confirm_action(
            controller,
            None,
            &format!("Would you like to abandon {source_name}?"),
            &[],
            Some(source_id),
            None,
        );
        if !confirmed {
            return;
        }
    }

    if sa.ir.remember_abandoned {
        ctx.game.card_mut(source_id).add_remembered(source_id);
    }

    if ctx.game.card(source_id).zone == ZoneType::Command {
        ctx.game
            .move_card(source_id, ZoneType::SchemeDeck, controller);
    }

    ctx.trigger_handler.run_trigger(
        TriggerType::Abandoned,
        RunParams {
            card: Some(source_id),
            ..Default::default()
        },
        false,
    );
}
