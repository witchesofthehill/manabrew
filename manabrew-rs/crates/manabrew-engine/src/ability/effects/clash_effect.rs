//! Clash effect — each player reveals top card, higher CMC wins.
//!
//! Ported 1:1 from Java's `ClashEffect.java`.
//! Clash with an opponent: Each clashing player reveals the top card of their
//! library, then puts it on top or bottom. Higher mana value wins.

use forge_foundation::ZoneType;

use super::EffectContext;
use crate::ids::{CardId, PlayerId};
use crate::parsing::keys;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ClashEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ClashEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;

    // Choose opponent to clash with
    let opponent = if let Some(def) = sa.defined() {
        super::resolve_defined_players(def, controller, ctx.game)
            .into_iter()
            .next()
            .unwrap_or_else(|| ctx.game.opponent_of(controller))
    } else {
        ctx.game.opponent_of(controller)
    };

    // RememberClasher$
    if sa.param_is_true(keys::REMEMBER_CLASHER) {
        if let Some(sid) = sa.source {
            ctx.game.card_mut(sid).add_remembered_player(opponent);
        }
    }

    let p_lib = ctx
        .game
        .cards_in_zone(ZoneType::Library, controller)
        .to_vec();
    let o_lib = ctx.game.cards_in_zone(ZoneType::Library, opponent).to_vec();

    if p_lib.is_empty() && o_lib.is_empty() {
        return;
    }

    let p_card: Option<CardId> = p_lib.last().copied();
    let o_card: Option<CardId> = o_lib.last().copied();

    let p_cmc = p_card
        .map(|cid| ctx.game.card(cid).mana_cost.cmc())
        .unwrap_or(-1);
    let o_cmc = o_card
        .map(|cid| ctx.game.card(cid).mana_cost.cmc())
        .unwrap_or(-1);

    let mut revealed = Vec::new();
    if let Some(cid) = p_card {
        revealed.push(cid);
    }
    if let Some(cid) = o_card {
        revealed.push(cid);
    }

    // Java CR 701.11: Both players choose order simultaneously; the clash
    // winner is the activator iff their revealed CMC is strictly greater.
    // Tie → no winner; `Otherwise` branch runs.
    let activator_wins = p_cmc > o_cmc;

    clash_move(ctx, controller, p_card);
    clash_move(ctx, opponent, o_card);

    // `WinSubAbility$ X` / `OtherwiseSubAbility$ Y` — SVar references resolved
    // from the host. Mirrors Java `ClashEffect` which triggers the right
    // sub-ability via the `BranchEffect`-like flow.
    let sub_key = if activator_wins {
        "WinSubAbility"
    } else {
        "OtherwiseSubAbility"
    };
    if let Some(sub_sa) = sa.get_additional_ability(sub_key).cloned() {
        super::resolve_effect(ctx, &sub_sa);
    }
}

/// Player chooses to put their clashed card on top or bottom of library.
fn clash_move(ctx: &mut EffectContext, player: PlayerId, card: Option<CardId>) {
    let Some(card_id) = card else { return };

    // Ask player: top or bottom?
    ctx.agents[player.index()].snapshot_state(ctx.game, ctx.mana_pools);
    let put_on_top = ctx.agents[player.index()].confirm_action(
        player,
        Some("ClashTopOrBottom"),
        &format!(
            "Put {} on top or bottom of your library?",
            ctx.game.card(card_id).card_name
        ),
        &["Top".to_string(), "Bottom".to_string()],
        Some(card_id),
        None,
    );

    if !put_on_top {
        // Move to bottom (card is already on top — move to index 0)
        ctx.game
            .reorder_card_in_zone(ZoneType::Library, player, card_id, 0);
    }
    // If top, card stays where it is (already on top)
}
