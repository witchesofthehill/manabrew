use super::{resolve_numeric_svar, EffectContext};

/// `SP$ ChooseNumber` — the activating player chooses a number.
/// Stores the result in `source.chosen_number` for subsequent effects.
///
/// Mirrors Java's `ChooseNumberEffect.java`.
/// - `Min$` — minimum value (default 0).
/// - `Max$` — maximum value (default 10).
/// - `Random` — if true, choose randomly instead of asking.
///
/// # Card script examples
/// ```text
/// A:SP$ ChooseNumber | Min$ 0 | Max$ 5
/// A:SP$ ChooseNumber | Min$ 1 | Max$ X
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ChooseNumberEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ChooseNumberEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;
    let min = resolve_numeric_svar(ctx.game, sa, "Min", 0);
    let max = resolve_numeric_svar(ctx.game, sa, "Max", 10);

    let is_random = sa.ir.random;
    let chosen = if is_random {
        let range = max - min + 1;
        Some(ctx.rng.next_int(range) + min)
    } else {
        ctx.agents[controller.index()].choose_number(controller, min, max)
    };

    if let Some(num) = chosen {
        if let Some(source_id) = sa.source {
            ctx.game.card_mut(source_id).set_chosen_number(Some(num));
        }
    }
}
