use super::EffectContext;
use crate::agent::BinaryChoiceKind;

/// `SP$ ChooseDirection` — choose left or right and remember it on source.
///
/// Mirrors Java `ChooseDirectionEffect.java`.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ChooseDirectionEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ChooseDirectionEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;
    let Some(source_id) = sa.source else { return };
    let source_name = ctx.game.card(source_id).card_name.clone();
    let choose_left = ctx.agents[controller.index()].choose_binary(
        controller,
        "Choose direction",
        BinaryChoiceKind::LeftOrRight,
        None,
        Some(source_id),
        sa.api,
    );
    ctx.game.card_mut(source_id).set_s_var(
        "ChosenDirection",
        if choose_left { "Left" } else { "Right" },
    );
}
