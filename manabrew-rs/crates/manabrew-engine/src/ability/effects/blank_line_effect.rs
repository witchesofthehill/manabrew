//! BlankLine — no-op formatting effect used in card scripts.

use super::EffectContext;
use manabrew_engine_macros::spell_effect;

#[spell_effect(BlankLineEffect)]
fn resolve(_ctx: &mut EffectContext, _sa: &crate::spellability::SpellAbility) {}
