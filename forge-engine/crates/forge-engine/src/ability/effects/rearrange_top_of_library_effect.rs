use forge_foundation::ZoneType;

use super::{resolve_defined_player, resolve_numeric_svar, EffectContext};
use crate::event::RunParams;
use crate::parsing::keys;
use crate::trigger::TriggerType;

/// Mirrors the `RearrangeTopOfLibrary` API used by cards like Ponder.
///
/// `SP$ RearrangeTopOfLibrary | Defined$ You | NumCards$ N | MayShuffle$ True`
/// The activating player looks at the top N cards and puts them back in any order.
/// With `MayShuffle$ True`, the player may choose to shuffle instead.
///
/// The agent decides the order via `choose_reorder_library`.
/// The default implementation (PassAgent) keeps the existing order.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `RearrangeTopOfLibraryEffect` class extending `SpellAbilityEffect`.
#[forge_engine_macros::spell_effect(RearrangeTopOfLibraryEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let num = resolve_numeric_svar(ctx.game, sa, keys::NUM_CARDS, 3).max(0) as usize;
    let may_shuffle = sa.ir.may_shuffle;

    let target = sa
        .defined()
        .and_then(|defined| resolve_defined_player(defined, sa.activating_player, ctx.game))
        .unwrap_or(sa.activating_player);

    let lib_len = ctx.game.cards_in_zone(ZoneType::Library, target).len();
    if lib_len == 0 {
        return;
    }

    let count = num.min(lib_len);

    // Take top N cards (last `count` elements).
    let mut top_n = ctx
        .game
        .take_top_cards_from_zone(ZoneType::Library, target, count);

    // Reverse to present in top-first order, matching Java's getTopXCardsFromLibrary
    // which returns [top, 2nd, 3rd, ...]. Rust's split_off gives [3rd, 2nd, top].
    // The agent convention (shared with Java) is: last element = will go on top.
    // Java's moveToLibrary(card, 0) loop reverses the returned list (first card
    // ends up deepest, last card on top). Rust's push loop does the same (last
    // element pushed = end of Vec = top). By reversing the input, both agents
    // see the same card order, and "keep original" produces the same result.
    top_n.reverse();

    // Let the agent see the cards before reordering.
    ctx.agents[sa.activating_player.index()].snapshot_state(ctx.game, ctx.mana_pools);

    // Ask the agent to reorder the cards.
    let reordered = ctx.agents[sa.activating_player.index()].choose_reorder_library(
        ctx.game,
        sa.activating_player,
        &top_n,
    );

    // Validate: use reordered if it contains exactly the same cards.
    let put_back =
        if reordered.len() == top_n.len() && top_n.iter().all(|id| reordered.contains(id)) {
            reordered
        } else {
            top_n
        };

    // Put cards back on top (append to end = top of library).
    // Convention: last element in put_back = top of library, matching Java's
    // moveToLibrary(card, 0) loop where the last card iterated ends up on top.
    for &id in &put_back {
        ctx.game.add_card_to_zone(ZoneType::Library, target, id);
    }

    // Handle optional shuffle.
    if may_shuffle {
        let source_name = sa.source.map(|cid| ctx.game.card(cid).card_name.as_str());
        let wants_shuffle = ctx.agents[sa.activating_player.index()].confirm_action(
            sa.activating_player,
            None,
            "Do you want to shuffle the library?",
            &[],
            sa.source,
            Some(crate::ability::api_type::ApiType::RearrangeTopOfLibrary),
        );
        if wants_shuffle {
            ctx.game
                .shuffle_zone_cards(ZoneType::Library, target, ctx.rng);
            ctx.trigger_handler.run_trigger(
                TriggerType::Shuffled,
                RunParams {
                    player: Some(target),
                    ..Default::default()
                },
                false,
            );
        }
    }
}
