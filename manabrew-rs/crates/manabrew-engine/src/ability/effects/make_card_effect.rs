//! MakeCard — conjure a card with specific properties (digital-only, Arena).
//! Ported from Java's MakeCardEffect: creates a real card (not a token) from
//! a named card, spellbook, or choices, and places it in a zone.

use forge_foundation::ZoneType;

use super::EffectContext;
use crate::ids::CardId;
use crate::parsing::keys;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `MakeCardEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(MakeCardEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let source = match sa.source {
        Some(s) => s,
        None => return,
    };
    let controller = sa.activating_player;

    // Determine target zone
    let zone = sa.ir.zone.unwrap_or(ZoneType::Library);

    // Get card name(s) to conjure
    let names: Vec<String> = if let Some(name) = sa.ir.name_text.as_deref() {
        if name == "ChosenName" {
            // Use named card from source
            if let Some(chosen) = ctx.game.card(source).get_s_var("ChosenName") {
                vec![chosen.to_string()]
            } else {
                vec![]
            }
        } else {
            vec![name.to_string()]
        }
    } else if let Some(names_str) = sa.ir.names_text.as_deref() {
        names_str
            .split(',')
            .map(|s| s.trim().replace(';', ","))
            .collect()
    } else {
        // Spellbook/Choices — digital-only card generation
        vec![]
    };

    let amount = super::resolve_numeric_svar(ctx.game, sa, "Amount", 1).max(1);

    for name in &names {
        for _ in 0..amount {
            // Create a minimal card instance representing the conjured card
            let mut card = crate::card::Card::new(
                CardId(0),
                name.clone(),
                controller,
                forge_foundation::CardTypeLine::parse(""),
                forge_foundation::ManaCost::parse(""),
                forge_foundation::ColorSet::COLORLESS,
                None,
                None,
                vec![],
                vec![],
            );
            card.set_controller(controller);

            if sa.param_is_true(keys::TAPPED) {
                card.set_tapped(true);
            }
            if sa.param_is_true(keys::FACE_DOWN) {
                card.set_face_down(true);
            }

            let card_id = ctx.game.create_card(card);
            let old_zone = ctx.game.card(card_id).zone;
            ctx.move_card(card_id, zone, controller);
            super::emit_zone_trigger(ctx.trigger_handler, card_id, old_zone, zone);

            if sa.param_is_true(keys::REMEMBER_MADE) {
                ctx.game.card_mut(source).add_remembered_card(card_id);
            }
            if sa.param_is_true(keys::IMPRINT_MADE) {
                ctx.game.card_mut(source).add_imprinted_card(card_id);
            }
        }
    }

    // Shuffle library if cards went there without a specific position
    if zone == ZoneType::Library && sa.library_position().is_none() {
        ctx.game
            .shuffle_zone_cards(ZoneType::Library, controller, ctx.rng);
    }
}
