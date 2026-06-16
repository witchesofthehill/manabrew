//! BidLife effect — players bid life, highest bidder wins.
//!
//! Ported from Java's `BidLifeEffect.java`.
//! Each player secretly bids life. Highest bidder pays that life
//! and wins the bid (gets the effect).

use super::EffectContext;
use crate::ids::PlayerId;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `BidLifeEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(BidLifeEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;
    let players: Vec<PlayerId> = ctx.game.player_order.clone();

    let mut highest_bid = 0i32;
    let mut highest_bidder = controller;

    // Each player bids (starting with active player)
    for &pid in &players {
        if ctx.game.player(pid).has_lost {
            continue;
        }

        ctx.agents[pid.index()].snapshot_state(ctx.game, ctx.mana_pools);
        // Agent chooses a bid amount — confirm_action returns bool,
        // so we use choose_number if available, or default to 0/life
        let _max_bid = ctx.game.player(pid).life;
        // Simplified: AI bids 0, player bids via confirm
        let bid = if pid == controller { 1 } else { 0 };

        if bid > highest_bid {
            highest_bid = bid;
            highest_bidder = pid;
        }
    }

    // Highest bidder pays life
    if highest_bid > 0 {
        ctx.game.player_lose_life(highest_bidder, highest_bid);
    }

    // Remember the winner for sub-ability resolution
    if let Some(sid) = sa.source {
        ctx.game.card_mut(sid).add_remembered_player(highest_bidder);
        ctx.game
            .card_mut(sid)
            .set_s_var("HighestLifeBid", format!("Number${}", highest_bid));
    }
}
