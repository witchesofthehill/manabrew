//! Mutate — mutate onto a creature (Ikoria).
//! Ported from Java's MutateEffect: merges the host card with a target creature,
//! choosing which goes on top, combining abilities.

use forge_foundation::ZoneType;

use super::EffectContext;
use crate::ability::ability_ir::DefinedRef;
use crate::event::RunParams;
use crate::trigger::TriggerType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `MutateEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(MutateEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let source = match sa.source {
        Some(s) => s,
        None => return,
    };

    // Get the target creature to mutate onto
    let target = if let Some(target) = sa.target_chosen.target_card {
        target
    } else if let Some(def) = sa.defined_ref() {
        if matches!(def, DefinedRef::SelfCard) {
            return; // Can't mutate onto self
        }
        match ctx.game.card(source).remembered_cards.first() {
            Some(&id) => id,
            None => return,
        }
    } else {
        return;
    };

    if ctx.game.card(target).zone != ZoneType::Battlefield {
        return;
    }

    let controller = sa.activating_player;

    // Choose whether host goes on top or bottom
    // Auto-select: put host on top (agent would choose)
    let put_on_top = true;

    if put_on_top {
        // Host card's characteristics become the merged creature's characteristics
        // Copy name, P/T, types from host to target
        let host_name = ctx.game.card(source).card_name.clone();
        let host_power = ctx.game.card(source).base_power;
        let host_toughness = ctx.game.card(source).base_toughness;
        let host_types = ctx.game.card(source).type_line.clone();

        ctx.game.card_mut(target).set_card_name(host_name);
        ctx.game.card_mut(target).set_base_power(host_power);
        ctx.game.card_mut(target).set_base_toughness(host_toughness);
        ctx.game.card_mut(target).set_type_line(host_types);
    }

    // Copy all keywords from host to target (abilities merge)
    let host_keywords = ctx.game.card(source).keywords.as_string_list();
    for kw in host_keywords {
        ctx.game.card_mut(target).add_intrinsic_keyword(&kw);
    }

    // Move host to "merged" zone (track via svar)
    ctx.game
        .card_mut(source)
        .set_s_var("MergedTo", format!("{}", target.0));
    ctx.game.card_mut(source).set_controller(controller);

    // Track mutation count
    let times_mutated = ctx
        .game
        .card(target)
        .svars
        .get("TimesMutated")
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(0);
    ctx.game
        .card_mut(target)
        .set_s_var("TimesMutated", (times_mutated + 1).to_string());

    // Move source card out of battlefield (merged zone representation)
    let old_zone = ctx.game.card(source).zone;
    ctx.move_card(source, ZoneType::Command, controller);

    // Fire Mutates trigger
    ctx.trigger_handler.run_trigger(
        TriggerType::Mutates,
        RunParams {
            card: Some(target),
            player: Some(controller),
            ..Default::default()
        },
        false,
    );

    let _ = old_zone;
}
