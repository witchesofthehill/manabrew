//! PermanentNoncreature — move host card to battlefield as a noncreature permanent.
//! Ported from Java's PermanentNoncreatureEffect.

use super::EffectContext;
use crate::game::GameState;
use crate::spellability::SpellAbility;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `PermanentNoncreatureEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(PermanentNoncreatureEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    super::permanent_effect::resolve_permanent_common(ctx, sa);
}

/// Stack text — the card's name. Mirrors Java
/// `PermanentNoncreatureEffect.getStackDescription(SpellAbility)`.
pub fn get_stack_description(game: &GameState, sa: &SpellAbility) -> String {
    sa.source
        .map(|cid| game.card(cid).card_name.clone())
        .unwrap_or_default()
}
