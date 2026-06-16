//! PermanentCreature — move host card to battlefield as a creature permanent.
//! Ported from Java's PermanentCreatureEffect.

use super::EffectContext;
use crate::game::GameState;
use crate::spellability::SpellAbility;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `PermanentCreatureEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(PermanentCreatureEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    super::permanent_effect::resolve_permanent_common(ctx, sa);
}

/// Stack text formatted as `"{Name} - Creature {P}/{T}"`, mirroring Java
/// `PermanentCreatureEffect.getStackDescription(SpellAbility)`.
pub fn get_stack_description(game: &GameState, sa: &SpellAbility) -> String {
    let Some(src_id) = sa.source else {
        return String::new();
    };
    let card = game.card(src_id);
    let power = sa
        .ir
        .set_power
        .clone()
        .or_else(|| card.base_power.map(|p| p.to_string()))
        .unwrap_or_else(|| "*".to_string());
    let toughness = sa
        .ir
        .set_toughness
        .clone()
        .or_else(|| card.base_toughness.map(|t| t.to_string()))
        .unwrap_or_else(|| "*".to_string());
    format!("{} - Creature {}/{}", card.card_name, power, toughness)
}
