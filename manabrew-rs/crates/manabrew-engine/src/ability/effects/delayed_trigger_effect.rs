use crate::ability::effects::{evaluate_svar, resolve_defined_player, EffectContext};
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
    if sa.ir.remember_objects_remembered_lki {
        remembered_lki_cards = ctx.game.card(source_id).remembered_cards.clone();
    }
    // `RememberObjects$ Remembered` — snapshot the source card's current
    // remembered_cards into the delayed trigger so the executed ability sees
    // them later via `SpellAbility::trigger_remembered`. Ashling uses this to
    // track the token copy it created for its end-step sacrifice clause.
    let mut remembered_cards: Vec<crate::ids::CardId> = if sa.ir.remember_objects_remembered {
        ctx.game.card(source_id).remembered_cards.clone()
    } else {
        Vec::new()
    };
    // `RememberObjects$ RememberedController` — snapshot the controllers of
    // the source's remembered cards. Arcane Denial uses this to remember the
    // controller of the countered spell so its delayed "may draw up to two
    // cards" trigger fires for the right player. Mirrors Java's
    // `DelayedTriggerEffect.resolve` registration of remembered objects.
    let mut remembered_players: Vec<crate::ids::PlayerId> = Vec::new();
    if sa.ir.remember_objects_remembered_controller {
        for cid in ctx.game.card(source_id).remembered_cards.clone() {
            let controller = ctx.game.card(cid).controller;
            if !remembered_players.contains(&controller) {
                remembered_players.push(controller);
            }
        }
    }

    // `RememberObjects$ TriggeredAttackerLKICopy` — snapshot the attacker
    // that fired the parent trigger so the delayed trigger's effect can
    // phase it out / operate on it at a later phase. Teferi's Veil uses
    // this to remember each attacker and phase them out at end of combat.
    // The attacker id is populated into both `remembered_cards` (so
    // `Defined$ DelayTriggerRememberedLKI` resolves via `trigger_remembered`)
    // and `remembered_lki_cards` (for the trigger_objects string lookup).
    if sa.ir.remember_objects_triggered_attacker_lki_copy {
        // The Attacker triggering object is stored as `AbilityValue::Card`
        // (since the kaalia parity refactor in trigger_attacks.rs); query it
        // through the typed accessor. The string-based `get_triggering_object`
        // returns `None` for non-String variants, which would silently drop
        // the LKI snapshot and break Teferi's Veil-style phase-out triggers.
        if let Some(cid) = sa.get_triggering_card(crate::ability::AbilityKey::Attacker) {
            remembered_lki_cards.push(cid);
            if !remembered_cards.contains(&cid) {
                remembered_cards.push(cid);
            }
        }
    }

    let delayed = crate::trigger::handler::DelayedTrigger {
        mode,
        trigger_mode: parsed.mode,
        params: trigger_params,
        execute_svar,
        controller,
        source_card: source_id,
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
