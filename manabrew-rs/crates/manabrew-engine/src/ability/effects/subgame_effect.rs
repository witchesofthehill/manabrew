//! Subgame — play a subgame (Shahrazad).
//! Ported from Java's SubgameEffect: creates a full sub-game with each player's
//! library, plays it to completion, then returns cards and applies results.
//! This is an enormously complex operation — we implement the core structure
//! but the actual sub-game execution requires the full game loop.

use super::EffectContext;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `SubgameEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(SubgameEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    // Subgame is one of the most complex effects in Magic.
    // Full implementation requires creating a new GameState, transferring
    // all library cards, running a complete game, then returning cards.
    // For now, we simulate the outcome: each player loses half their life
    // (matching Shahrazad's typical outcome for the loser).
    let player_ids: Vec<_> = ctx.game.players.iter().map(|p| p.id).collect();

    // The losing player of the subgame loses half their life (rounded up)
    // Randomly determine winner for now (proper implementation needs full game loop)
    let loser_idx = ctx.rng.next_int(player_ids.len() as i32) as usize % player_ids.len();

    for (i, &pid) in player_ids.iter().enumerate() {
        if i == loser_idx {
            let life = ctx.game.player(pid).life;
            let loss = (life + 1) / 2; // round up
            ctx.game.player_lose_life(pid, loss);
        }
    }

    // Remember winners/losers if requested
    if let Some(source) = sa.source {
        if let Some(remember) = sa.ir.remember_players_text.as_deref() {
            for (i, &pid) in player_ids.iter().enumerate() {
                let is_winner = i != loser_idx;
                if (remember == "Win" && is_winner) || (remember == "NotWin" && !is_winner) {
                    ctx.game
                        .card_mut(source)
                        .set_s_var(format!("RememberedPlayer{}", pid.0), "True");
                }
            }
        }
    }
}
