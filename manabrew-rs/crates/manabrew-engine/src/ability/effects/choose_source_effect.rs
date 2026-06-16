use forge_foundation::ZoneType;

use super::{matches_valid_cards_for_sa, EffectContext};
use crate::ids::CardId;

/// `SP$ ChooseSource` — the activating player chooses a source (permanent/spell).
/// Stores the result for subsequent effects.
///
/// Mirrors Java's `ChooseSourceEffect.java`.
/// - `Choices$` — filter for valid sources (default: Permanent on battlefield).
///
/// # Card script examples
/// ```text
/// A:SP$ ChooseSource | Choices$ Permanent
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ChooseSourceEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ChooseSourceEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;
    let choices_filter = sa
        .ir
        .choices
        .clone()
        .unwrap_or_else(|| "Permanent".to_string());
    let choices_selector = sa.ir.choices_selector.as_ref();

    let player_ids = ctx.game.player_order.clone();
    let mut valid: Vec<CardId> = Vec::new();

    for &pid in &player_ids {
        let zone_cards = ctx.game.cards_in_zone(ZoneType::Battlefield, pid).to_vec();
        for cid in zone_cards {
            if matches_valid_cards_for_sa(
                ctx.game,
                sa,
                ctx.game.card(cid),
                choices_selector,
                &choices_filter,
            ) {
                valid.push(cid);
            }
        }
    }

    if valid.is_empty() {
        return;
    }

    let chosen = ctx.agents[controller.index()].choose_cards_for_effect(controller, &valid, 1, 1);

    if let Some(&chosen_id) = chosen.first() {
        if let Some(source_id) = sa.source {
            ctx.game.card_mut(source_id).add_chosen_card(chosen_id);
        }
    }
}
