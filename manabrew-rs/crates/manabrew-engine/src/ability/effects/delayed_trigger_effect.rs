use crate::ability::ability_utils::resolve_defined_players_with_sa;
use crate::ability::effects::{evaluate_svar, resolve_defined_player, EffectContext};
use crate::ability::spell_ability_effect::resolve_defined_cards_for_sa;
use crate::parsing::Params;
use crate::spellability::SpellAbility;
use crate::trigger::trigger::parse_trigger;

/// Mirrors Java's `DelayedTriggerEffect`.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `DelayedTriggerEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(DelayedTriggerEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let Some(source_id) = sa.source else {
        return;
    };

    let mut next_id = 0;
    let Some(parsed) = parse_trigger(&sa.ability_text, &mut next_id) else {
        return;
    };
    let trigger_params = Params::from_raw(&sa.ability_text);
    let mode = parsed.kind;

    let execute_svar = if let Some(exec) = sa.ir.execute.as_deref() {
        if let Some(svar_text) = ctx.game.card(source_id).get_s_var(exec) {
            svar_text.to_string()
        } else {
            exec.to_string()
        }
    } else {
        return;
    };

    let mut remembered_amount = 0;
    if sa.ir.remember_number {
        remembered_amount += ctx
            .game
            .card(source_id)
            .remembered_cmc
            .iter()
            .copied()
            .sum::<i32>();
    }
    if let Some(svar_name) = sa.ir.remember_svar_amount.as_deref() {
        if let Some(expr) = ctx.game.card(source_id).get_s_var(svar_name) {
            remembered_amount += evaluate_svar(expr, sa);
        }
    }

    let controller = if let Some(def_player) = sa.ir.delayed_trigger_defined_player_text.as_deref()
    {
        resolve_defined_player(def_player, sa.activating_player, ctx.game)
            .unwrap_or(sa.activating_player)
    } else {
        sa.activating_player
    };
    let mut remembered_lki_cards = Vec::new();
    let mut remembered_cards = Vec::new();
    let mut remembered_players = Vec::new();
    if let Some(definitions) = sa.ir.remember_objects.as_deref() {
        for definition in definitions.split(" & ").map(str::trim) {
            let cards = resolve_defined_cards_for_sa(ctx.game, sa, definition);
            let destination = if definition.ends_with("LKICopy") || definition == "RememberedLKI" {
                &mut remembered_lki_cards
            } else {
                &mut remembered_cards
            };
            destination.extend(cards);
            remembered_players.extend(resolve_defined_players_with_sa(
                definition,
                sa,
                sa.activating_player,
                ctx.game,
            ));
        }
    }

    let delayed = crate::trigger::handler::DelayedTrigger {
        mode,
        trigger_mode: parsed.mode,
        params: trigger_params,
        execute_svar,
        controller,
        source_card: source_id,
        source_zone_timestamp: Some(
            sa.trigger_source_zone_timestamp
                .or(sa.source_zone_timestamp)
                .unwrap_or_else(|| ctx.game.card(source_id).zone_timestamp),
        ),
        created_turn: ctx.game.turn.turn_number,
        created_phase: ctx.game.turn.phase,
        target_card: None,
        remembered_amount,
        remembered_cards,
        remembered_players,
        remembered_lki_cards,
        sort_after_active: false,
        trigger_order: None,
    };
    if sa.ir.this_turn {
        ctx.trigger_handler
            .register_this_turn_delayed_trigger(delayed);
    } else if sa.ir.delayed_trigger_defined_player.is_some() {
        ctx.trigger_handler
            .register_player_defined_delayed_trigger(controller, delayed);
    } else {
        ctx.trigger_handler.register_delayed_trigger(delayed);
    }
}

/// End-of-turn / next-turn registration callback.
pub fn run(ctx: &mut EffectContext, sa: &SpellAbility) {
    use crate::ability::spell_ability_effect::SpellAbilityEffect;
    DelayedTriggerEffect::resolve(ctx, sa);
}
