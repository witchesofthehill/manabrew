//! Investigate effect — create Clue artifact tokens.
//!
//! Ported from Java's `InvestigateEffect.java`.
//! Investigate: Create a colorless Clue artifact token with
//! "{2}, Sacrifice this artifact: Draw a card."

use super::token_effect_base::{TokenEffectBase, TOKEN_EFFECT_BASE};
use super::EffectContext;
use crate::card::card_zone_table::CardZoneTable;
use crate::ids::{CardId, PlayerId};
use crate::parsing::keys;
use crate::spellability::SpellAbility;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `InvestigateEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(InvestigateEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let amount = super::resolve_numeric_svar(ctx.game, sa, "Num", 1).max(0) as usize;
    let controller = sa.activating_player;

    let players = if let Some(def) = sa.defined_player() {
        super::resolve_defined_players(def, controller, ctx.game)
    } else {
        vec![controller]
    };

    let mut created_tokens: Vec<CardId> = Vec::new();
    let mut trigger_list = CardZoneTable::default();
    for _ in 0..amount {
        for &pid in &players {
            if let Some(tid) = create_clue_token(ctx, sa, pid, &mut trigger_list) {
                created_tokens.push(tid);
            }
        }
    }

    // Fire ChangesZoneAll for the batch of tokens entering the battlefield.
    // Needed for triggers like Woodland Champion (Mode$ ChangesZoneAll).
    if !created_tokens.is_empty() {
        trigger_list.trigger_changes_zone_all(ctx.trigger_handler, ctx.game, Some(sa));
    }
}

/// Create a single Clue artifact token. Returns the created token ID.
fn create_clue_token(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    player: PlayerId,
    trigger_list: &mut CardZoneTable,
) -> Option<CardId> {
    let token_table = TOKEN_EFFECT_BASE.make_token_table_internal_from_script(
        ctx,
        player,
        "c_a_clue_draw",
        1,
        sa,
    );
    let result = TOKEN_EFFECT_BASE.make_token_table(ctx, token_table, false, trigger_list, sa);
    let token_id = result.created.first().copied()?;

    // RememberInvestigatingPlayers$
    if sa.param_is_true(keys::REMEMBER_INVESTIGATING_PLAYERS) {
        if let Some(sid) = sa.source {
            ctx.game.card_mut(sid).add_remembered_player(player);
        }
    }

    Some(token_id)
}
