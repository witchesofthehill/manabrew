//! ReorderZone effect — let a player reorder cards in a zone.
//!
//! Ported from Java's `ReorderZoneEffect.java`.
//! Typically used for: "look at the top N cards, put them back in any order."

use forge_foundation::ZoneType;

use super::EffectContext;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ReorderZoneEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ReorderZoneEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;
    let zone = sa.ir.zone.unwrap_or(ZoneType::Library);

    let players = if let Some(def) = sa.defined_player() {
        super::resolve_defined_players(def, controller, ctx.game)
    } else {
        vec![controller]
    };

    for pid in players {
        // For library: agent can reorder the top cards
        // For now, the parity agent doesn't have reorder preference
        // so we leave cards in their current order.
        // A full implementation would call agent.order_cards().
        let _ = ctx.game.cards_in_zone(zone, pid);
    }
}
