use super::EffectContext;
use crate::agent::BinaryChoiceKind;
use crate::spellability::SpellAbility;

/// `SP$ FlipACoin` — flip a coin, resolve different abilities for win/lose.
///
/// Mirrors Java's `FlipCoinEffect.java`.
/// - `NoCall` — if set, don't ask the player to call; just resolve HeadsSub$/TailsSub$.
/// - `WinSubAbility$` / `LoseSubAbility$` — SVars for the sub-abilities to resolve.
/// - `HeadsSubAbility$` / `TailsSubAbility$` — used with NoCall.
///
/// # Card script examples
/// ```text
/// A:SP$ FlipACoin | WinSubAbility$ Win | LoseSubAbility$ Lose
/// A:SP$ FlipACoin | NoCall$ True | HeadsSubAbility$ Heads | TailsSubAbility$ Tails
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `FlipCoinEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(FlipCoinEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;
    let no_call = sa.ir.no_call;

    // Flip the coin (random)
    let is_heads = ctx.rng.next_int(2) == 0;

    let source_id = match sa.source {
        Some(id) => id,
        None => return,
    };

    if no_call {
        // No-call mode: resolve HeadsSub$ or TailsSub$ directly
        let sub_key = if is_heads {
            "HeadsSubAbility"
        } else {
            "TailsSubAbility"
        };
        if let Some(sub_sa) = sa.get_additional_ability(sub_key).cloned() {
            resolve_sub_chain(ctx, sub_sa);
        }
    } else {
        // Call mode: player calls heads/tails
        let card_name = ctx.game.card(source_id).card_name.clone();
        let called_heads = ctx.agents[controller.index()].choose_binary(
            controller,
            "Call the coin flip",
            BinaryChoiceKind::HeadsOrTails,
            None,
            Some(source_id),
            sa.api,
        );
        let won = called_heads == is_heads;

        let sub_key = if won {
            "WinSubAbility"
        } else {
            "LoseSubAbility"
        };
        if let Some(sub_sa) = sa.get_additional_ability(sub_key).cloned() {
            resolve_sub_chain(ctx, sub_sa);
        }
    }
}

/// Flip `amount` coins for a player and return the number of wins.
/// Mirrors Java `FlipCoinEffect.flipCoins(Player, SpellAbility, int)`.
///
/// If the SA has `FlipUntilYouLose$`, keeps flipping until a loss occurs
/// (CR 705.3). The multiplier for coin-doubling effects (e.g. Krark's Thumb)
/// is determined by counting the relevant keyword on the player.
pub fn flip_coins(
    ctx: &mut EffectContext,
    flipper: crate::ids::PlayerId,
    sa: &SpellAbility,
    amount: i32,
) -> i32 {
    let flip_until_lose = sa.ir.flip_until_you_lose;

    // Get flip multiplier (Krark's Thumb: "If you would flip a coin, instead
    // flip two coins and ignore one.")
    let multiplier = get_flip_multiplier(ctx, flipper);

    let mut total_wins = 0;
    let mut won = false;

    loop {
        for _ in 0..amount {
            won = flip_single_coin(ctx, flipper, multiplier);
            if won {
                total_wins += 1;
            }
        }
        // CR 705.3: repeat if FlipUntilYouLose and the last flip was a win
        if !flip_until_lose || !won {
            break;
        }
    }

    total_wins
}

/// Flip a single coin, accounting for the multiplier (multiple flips, pick best).
fn flip_single_coin(
    ctx: &mut EffectContext,
    _flipper: crate::ids::PlayerId,
    multiplier: i32,
) -> bool {
    // With multiplier > 1, flip multiple coins and take the best result.
    // (Krark's Thumb lets you flip two and pick one.)
    let mut any_heads = false;
    for _ in 0..multiplier {
        let result = ctx.rng.next_int(2) == 0;
        if result {
            any_heads = true;
        }
    }
    any_heads
}

/// Get the flip multiplier for a player. Each instance of "If you would flip
/// a coin, instead flip two coins and ignore one." doubles the flips.
/// Mirrors Java `FlipCoinEffect.getFlipMultiplier`.
/// Mirrors Java `FlipCoinEffect.getFlipMultiplier(Player)`.
pub fn get_flip_multiplier(ctx: &EffectContext, flipper: crate::ids::PlayerId) -> i32 {
    let keyword = "If you would flip a coin, instead flip two coins and ignore one.";
    let count = ctx
        .game
        .cards
        .iter()
        .filter(|c| {
            c.zone == forge_foundation::ZoneType::Battlefield
                && c.controller == flipper
                && c.keywords.contains_string_ignore_case(keyword)
        })
        .count() as u32;
    1i32 << count
}

fn resolve_sub_chain(ctx: &mut EffectContext, initial: SpellAbility) {
    let mut cur_opt: Option<SpellAbility> = Some(initial);
    while let Some(cur_sa) = cur_opt {
        super::resolve_effect(ctx, &cur_sa);
        cur_opt = cur_sa.sub_ability.map(|b| *b);
        if ctx.game.game_over {
            break;
        }
    }
}
