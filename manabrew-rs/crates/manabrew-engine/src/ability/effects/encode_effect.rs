use forge_foundation::ZoneType;

use super::EffectContext;

/// `SP$ Encode` — exile the spell card and encode it onto a creature (Cipher).
///
/// Mirrors Java's `EncodeEffect.java`.
/// The encoded spell is exiled attached to the chosen creature. Whenever that
/// creature deals combat damage to a player, its controller may cast a copy
/// of the encoded card without paying its mana cost.
///
/// Simplified: exiles the spell card and stores its ID in the creature's
/// `encoded_cards` list. The combat damage copy trigger is handled separately
/// in the trigger system.
///
/// # Card script examples
/// ```text
/// A:SP$ Encode | Defined$ Self
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `EncodeEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(EncodeEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;

    let spell_card = match sa.source {
        Some(id) => id,
        None => return,
    };

    // Find a creature to encode onto — use target or let player choose
    let target = sa.target_chosen.target_card.or_else(|| {
        let bf = ctx
            .game
            .cards_in_zone(ZoneType::Battlefield, controller)
            .to_vec();
        let creatures: Vec<_> = bf
            .into_iter()
            .filter(|&cid| {
                let c = ctx.game.card(cid);
                c.is_creature() && c.controller == controller
            })
            .collect();

        if creatures.is_empty() {
            return None;
        }

        let chosen =
            ctx.agents[controller.index()].choose_cards_for_effect(controller, &creatures, 1, 1);
        chosen.into_iter().next()
    });

    let creature_id = match target {
        Some(id)
            if ctx.game.card(id).zone == ZoneType::Battlefield
                && ctx.game.card(id).is_creature() =>
        {
            id
        }
        _ => return,
    };

    // Exile the spell card
    let owner = ctx.game.card(spell_card).owner;
    if ctx.game.card(spell_card).zone != ZoneType::Exile {
        ctx.move_card(spell_card, ZoneType::Exile, owner);
    }

    // Encode it onto the creature
    ctx.game
        .card_mut(creature_id)
        .encoded_cards
        .push(spell_card);
}
