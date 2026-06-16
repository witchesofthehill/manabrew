use forge_foundation::ZoneType;

use super::{matches_valid_cards_for_sa, EffectContext};

/// `SP$ ChooseCard` — player chooses card(s) from a filtered set in a zone.
///
/// Mirrors Java's `ChooseCardEffect.java`.
///
/// # Params
/// - `Amount` — how many cards to choose (default 1)
/// - `ChoiceZone` — zone to choose from (default Battlefield)
/// - `Choices` — ValidCards filter for eligible cards
/// - `RememberChosen` — if "True", add chosen to source's remembered_cards
///
/// Stores the chosen card(s) on the source card's `chosen_cards`.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ChooseCardEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ChooseCardEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let source_id = match sa.source {
        Some(id) => id,
        None => return,
    };

    let controller = sa.activating_player;

    let amount: usize = sa
        .ir
        .amount
        .as_deref()
        .and_then(|s| s.parse().ok())
        .unwrap_or(1);

    let zone = sa.ir.choice_zone.unwrap_or(ZoneType::Battlefield);

    let filter = sa.ir.choices.clone().unwrap_or_else(|| "Card".to_string());
    let filter_selector = sa.ir.choices_selector.clone();

    let remember = sa.ir.remember_chosen;

    // Collect valid cards in zone matching filter
    let mut valid = Vec::new();
    for &pid in &ctx.game.player_order.clone() {
        let zone_cards = ctx.game.cards_in_zone(zone, pid).to_vec();
        for cid in zone_cards {
            if matches_valid_cards_for_sa(
                ctx.game,
                sa,
                ctx.game.card(cid),
                filter_selector.as_ref(),
                &filter,
            ) {
                valid.push(cid);
            }
        }
    }

    if valid.is_empty() {
        return;
    }

    // Ask the controlling player to choose
    ctx.agents[controller.index()].snapshot_state(ctx.game, ctx.mana_pools);
    let chosen =
        ctx.agents[controller.index()].choose_cards_for_effect(controller, &valid, 1, amount);

    // Store on source card
    ctx.game
        .card_mut(source_id)
        .set_chosen_cards(chosen.clone());

    // Optionally remember
    if remember {
        for &cid in &chosen {
            ctx.game.card_mut(source_id).add_remembered_card(cid);
        }
    }

    // ImprintChosen$ — `ChooseCardEffect.java:299-301`.
    if sa.ir.imprint_chosen {
        for &cid in &chosen {
            ctx.game.card_mut(source_id).add_imprinted_card(cid);
        }
    }
}
