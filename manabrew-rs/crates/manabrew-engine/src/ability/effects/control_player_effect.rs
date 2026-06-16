//! ControlPlayer effect — take control of another player's turn (Mindslaver).
//!
//! Ported 1:1 from Java's `ControlPlayerEffect.java`.
//! You control target player during their next turn. (CR 800.4b)
//! The controlled player's decisions are made by the controller.

use super::EffectContext;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ControlPlayerEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ControlPlayerEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller_def = sa.ir.controller_text.as_deref().unwrap_or("You");
    let controller = super::resolve_defined_players(controller_def, sa.activating_player, ctx.game)
        .into_iter()
        .next()
        .unwrap_or(sa.activating_player);

    let targets = if let Some(pid) = sa.target_chosen.target_player {
        vec![pid]
    } else if let Some(def) = sa.defined_player() {
        super::resolve_defined_players(def, sa.activating_player, ctx.game)
    } else {
        vec![ctx.game.opponent_of(sa.activating_player)]
    };

    for target_player in targets {
        // Set the controlled_by field on the target player
        // This will be checked by the game loop to route decisions
        // through the controller's agent instead of the target's agent
        ctx.game
            .player_set_controlled_by(target_player, Some(controller));

        // Register a cleanup to remove control at end of next turn
        // Java uses addUntil on the cleanup step — we use a delayed trigger
        ctx.trigger_handler
            .register_delayed_trigger(crate::trigger::handler::DelayedTrigger {
                mode: crate::trigger::TriggerType::Phase,
                trigger_mode: Box::new(crate::trigger::trigger_always::TriggerAlways)
                    as Box<dyn crate::trigger::TriggerBehavior>,
                params: crate::parsing::Params::default(),
                execute_svar: "ControlPlayerCleanup".to_string(),
                controller,
                source_card: sa.source.unwrap_or(crate::ids::CardId(0)),
                created_turn: ctx.game.turn.turn_number,
                created_phase: ctx.game.turn.phase,
                target_card: None,
                remembered_amount: target_player.0 as i32,
                remembered_cards: Vec::new(),
                remembered_players: Vec::new(),
                remembered_lki_cards: Vec::new(),
                sort_after_active: false,
                trigger_order: None,
            });
    }
}
