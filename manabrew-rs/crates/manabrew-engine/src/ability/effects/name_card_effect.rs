use super::EffectContext;

/// `SP$ NameCard` — the activating player names a card.
/// Stores the result in `source.named_cards` for subsequent effects.
///
/// Mirrors Java's `NameCardEffect.java`.
/// - `ChooseFromList$` — comma-separated list of card names to choose from.
/// - `ChooseFromDefinedCards$` — use remembered/defined cards as choices.
///
/// # Card script examples
/// ```text
/// A:SP$ NameCard
/// A:SP$ NameCard | ChooseFromList$ Lightning Bolt,Counterspell,Dark Ritual
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `NameCardEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(NameCardEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;

    // Build the valid names list
    let valid_names: Vec<String> = if let Some(list) = sa.ir.choose_from_list_text.as_deref() {
        list.split(',').map(|s| s.trim().to_string()).collect()
    } else if sa.param_is_true(crate::parsing::keys::CHOOSE_FROM_DEFINED_CARDS) {
        // Use remembered cards from source
        if let Some(source_id) = sa.source {
            ctx.game
                .card(source_id)
                .remembered_cards
                .iter()
                .map(|&cid| ctx.game.card(cid).card_name.clone())
                .collect()
        } else {
            vec![]
        }
    } else {
        // Open naming — for now provide an empty list (frontend handles free text input)
        vec![]
    };

    let chosen = ctx.agents[controller.index()].choose_card_name(controller, &valid_names);

    if let Some(chosen_name) = chosen {
        if let Some(source_id) = sa.source {
            ctx.game.card_mut(source_id).add_named_card(&chosen_name);
        }
    }
}
