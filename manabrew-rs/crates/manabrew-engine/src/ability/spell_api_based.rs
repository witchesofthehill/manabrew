//! SpellApiBased — spell abilities backed by an API type.
//!
//! Mirrors Java's `SpellApiBased.java`.
//! A spell (as opposed to an activated ability) whose resolution is
//! dispatched through the effect system based on its `ApiType`.

use crate::spellability::SpellAbility;

/// Marker trait for API-based spell abilities.
///
/// In Java, `SpellApiBased extends Spell` and holds a reference to
/// `SpellAbilityEffect`. In Rust the dispatch is centralized in
/// `effect_dispatch!`, so this provides structural parity.
pub trait SpellApiBased {
    /// The API type string (e.g. "DealDamage", "GainLife").
    fn api_type(&self) -> &str;

    /// Whether this spell is intrinsic to its card.
    fn is_intrinsic(&self) -> bool {
        true
    }

    /// Resolve this spell by dispatching to the effect system.
    fn resolve(&self, sa: &SpellAbility);
}

/// Build a spell ability for an API-based spell.
/// Mirrors Java's `SpellApiBased` constructor which creates a Spell with
/// an associated SpellAbilityEffect.
///
/// In the Rust engine, this delegates to `ability_factory::build_spell_ability`
/// since the effect dispatch is centralized.
pub fn build_spell_ability(
    game: &crate::game::GameState,
    card_id: crate::ids::CardId,
    ability_text: &str,
    player: crate::ids::PlayerId,
) -> SpellAbility {
    crate::ability::ability_factory::build_spell_ability(game, card_id, ability_text, player)
}

/// Resolve an API-based spell ability.
/// Mirrors Java's `SpellApiBased.resolve()` which delegates to its SpellAbilityEffect.
///
/// In the Rust engine, resolution is centralized in `effects::resolve_effect`.
pub fn resolve(ctx: &mut crate::ability::effects::EffectContext, sa: &SpellAbility) {
    crate::ability::effects::resolve_effect(ctx, sa);
}
