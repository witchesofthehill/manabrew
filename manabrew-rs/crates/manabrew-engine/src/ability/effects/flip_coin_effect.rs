use super::{resolve_defined_players, resolve_numeric_svar, EffectContext};
use crate::agent::notification::GameNotification;
use crate::agent::{BinaryChoiceKind, GameLogEvent};
use crate::ids::{CardId, PlayerId};
use crate::spellability::SpellAbility;

#[manabrew_engine_macros::spell_effect(FlipCoinEffect)]
fn resolve(ctx: &mut EffectContext, sa: &SpellAbility) {
    let Some(source_id) = sa.source else {
        return;
    };
    let controller = sa.activating_player;
    let amount = resolve_numeric_svar(ctx.game, sa, "Amount", 1).max(0);
    let flippers = if let Some(player) = sa.target_chosen.target_player {
        vec![player]
    } else if let Some(defined) = sa.ir.flipper_text.as_deref() {
        let players = resolve_defined_players(defined, controller, ctx.game);
        if players.is_empty() {
            vec![controller]
        } else {
            players
        }
    } else {
        vec![controller]
    };

    for flipper in flippers {
        if sa.ir.no_call {
            let count_heads = flip_coins(ctx, flipper, sa, amount);
            let count_tails = (count_heads - amount).abs();
            if count_heads > 0 {
                if sa.ir.remember_result {
                    ctx.game.card_mut(source_id).add_flip_result(true);
                }
                if let Some(name) = sa.ir.save_num_flips_to_svar.as_deref() {
                    ctx.game
                        .card_mut(source_id)
                        .set_s_var(name, format!("Number${count_heads}"));
                }
                resolve_additional(ctx, sa, "HeadsSubAbility");
            }
            if count_tails > 0 {
                if sa.ir.remember_result {
                    ctx.game.card_mut(source_id).add_flip_result(false);
                }
                if let Some(name) = sa.ir.save_num_flips_to_svar.as_deref() {
                    ctx.game
                        .card_mut(source_id)
                        .set_s_var(name, format!("Number${count_tails}"));
                }
                resolve_additional(ctx, sa, "TailsSubAbility");
            }
        } else if let Some(for_each) = sa.ir.for_each_player_text.as_deref() {
            let mut winners = Vec::new();
            let mut losers = Vec::new();
            for player in resolve_defined_players(for_each, controller, ctx.game) {
                if flip_coins(ctx, flipper, sa, 1) > 0 {
                    winners.push(player);
                } else {
                    losers.push(player);
                }
            }
            resolve_for_players(ctx, sa, source_id, "WinSubAbility", "Wins", &winners);
            resolve_for_players(ctx, sa, source_id, "LoseSubAbility", "Losses", &losers);
        } else {
            let count_wins = flip_coins(ctx, flipper, sa, amount);
            let count_losses = (count_wins - amount).abs();
            if count_wins > 0 {
                if sa.ir.remember_winner {
                    ctx.game.card_mut(source_id).add_remembered_player(flipper);
                }
                ctx.game
                    .card_mut(source_id)
                    .set_s_var("Wins", format!("Number${count_wins}"));
                resolve_additional(ctx, sa, "WinSubAbility");
            }
            if count_losses > 0 {
                if sa.ir.remember_loser {
                    ctx.game.card_mut(source_id).add_remembered_player(flipper);
                }
                ctx.game
                    .card_mut(source_id)
                    .set_s_var("Losses", format!("Number${count_losses}"));
                resolve_additional(ctx, sa, "LoseSubAbility");
            }
            if let Some(value) = sa.ir.remember_number_text.as_deref() {
                let number = if value.starts_with("Win") {
                    count_wins
                } else {
                    count_losses
                };
                ctx.game.card_mut(source_id).add_remembered_cmc(number);
            }
        }
    }
}

pub fn flip_coins(
    ctx: &mut EffectContext,
    flipper: PlayerId,
    sa: &SpellAbility,
    amount: i32,
) -> i32 {
    let multiplier = get_flip_multiplier(ctx, flipper);
    let mut total_wins = 0;
    let mut won = false;
    loop {
        for _ in 0..amount {
            won = flip_single_coin(ctx, flipper, sa, multiplier);
            if won {
                total_wins += 1;
            }
        }
        if !sa.ir.flip_until_you_lose || !won {
            break;
        }
    }
    total_wins
}

fn flip_single_coin(
    ctx: &mut EffectContext,
    flipper: PlayerId,
    sa: &SpellAbility,
    multiplier: i32,
) -> bool {
    let fixed_result =
        crate::staticability::static_ability_flip_coin_mod::fixed_result(ctx.game, flipper);
    let called_heads = if sa.ir.no_call {
        None
    } else if fixed_result.is_some() {
        Some(true)
    } else {
        Some(ctx.agents[flipper.index()].choose_binary(
            flipper,
            "Call the coin flip",
            BinaryChoiceKind::HeadsOrTails,
            None,
            sa.source,
            sa.api,
        ))
    };
    let results = if let Some(result) = fixed_result {
        vec![result]
    } else {
        (0..multiplier)
            .map(|_| ctx.rng.next_int(2) == 0)
            .collect::<Vec<_>>()
    };
    let kept_result = if results.iter().all(|result| *result == results[0]) {
        results[0]
    } else {
        ctx.agents[flipper.index()].choose_binary(
            flipper,
            "Choose a coin result to keep",
            BinaryChoiceKind::HeadsOrTails,
            None,
            sa.source,
            sa.api,
        )
    };
    let won_or_heads = kept_result == called_heads.unwrap_or(true);

    crate::player::flip(ctx.game, flipper);
    if !sa.ir.no_call || fixed_result.is_some() {
        ctx.trigger_handler.run_trigger(
            crate::trigger::TriggerType::FlippedCoin,
            crate::event::RunParams {
                player: Some(flipper),
                coin_flip_won: Some(won_or_heads),
                ..Default::default()
            },
            false,
        );
    }

    let source_card_id = sa.source.expect("coin flip requires a source card");
    let source_card_name = ctx.game.card(source_card_id).card_name.clone();
    let outcome = if sa.ir.no_call {
        if kept_result {
            "heads"
        } else {
            "tails"
        }
    } else if won_or_heads {
        "won the flip"
    } else {
        "lost the flip"
    };
    crate::agent::notify_all_agents(
        ctx.agents,
        GameLogEvent::rule(format!("Coin flip: {outcome}")).with_player(flipper),
    );
    let result_number = |heads| if heads { 1 } else { 2 };
    let kept_result_number = result_number(kept_result);
    let mut kept_seen = false;
    let ignored_rolls = results
        .into_iter()
        .filter_map(|result| {
            let result = result_number(result);
            if !kept_seen && result == kept_result_number {
                kept_seen = true;
                None
            } else {
                Some(result)
            }
        })
        .collect();
    crate::agent::game_log::broadcast_notification(
        ctx.agents,
        GameNotification::DiceRolled {
            player: flipper,
            sides: 2,
            natural_results: vec![kept_result_number],
            final_results: vec![kept_result_number],
            ignored_rolls,
            source_card_id: Some(source_card_id),
            source_card_name: Some(source_card_name),
        },
    );
    for agent in ctx.agents.iter_mut() {
        agent.await_display_ack();
    }
    won_or_heads
}

pub fn get_flip_multiplier(ctx: &EffectContext, flipper: PlayerId) -> i32 {
    let keyword = "If you would flip a coin, instead flip two coins and ignore one.";
    let count = ctx
        .game
        .cards
        .iter()
        .filter(|card| {
            card.zone == forge_foundation::ZoneType::Battlefield
                && card.controller == flipper
                && card.keywords.contains_string_ignore_case(keyword)
        })
        .count() as u32;
    1i32 << count
}

fn resolve_for_players(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    source_id: CardId,
    ability_name: &str,
    count_name: &str,
    players: &[PlayerId],
) {
    if players.is_empty() {
        return;
    }
    let remembered = ctx.game.card(source_id).remembered_players.clone();
    let source = ctx.game.card_mut(source_id);
    source.remembered_players.clear();
    source.remembered_players.extend_from_slice(players);
    source.set_s_var(count_name, format!("Number${}", players.len()));
    resolve_additional(ctx, sa, ability_name);
    ctx.game.card_mut(source_id).remembered_players = remembered;
}

fn resolve_additional(ctx: &mut EffectContext, sa: &SpellAbility, key: &str) {
    if let Some(sub_sa) = sa.get_additional_ability(key).cloned() {
        resolve_sub_chain(ctx, sub_sa);
    }
}

fn resolve_sub_chain(ctx: &mut EffectContext, initial: SpellAbility) {
    let mut current = Some(initial);
    while let Some(sa) = current {
        super::resolve_effect(ctx, &sa);
        current = sa.sub_ability.map(|next| *next);
        if ctx.game.game_over {
            break;
        }
    }
}
