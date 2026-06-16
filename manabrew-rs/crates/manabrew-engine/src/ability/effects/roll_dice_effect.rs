use super::{resolve_defined_players, resolve_numeric_svar, EffectContext};
use std::collections::{HashMap, HashSet};

use crate::agent::notification::GameNotification;
use crate::agent::GameLogEvent;
use crate::cost::{parse_cost, Cost, CostPart};
use crate::event::RunParams;
use crate::game::GameState;
use crate::game_rng::GameRng;
use crate::ids::PlayerId;
use crate::mana;
use crate::replacement::replacement_handler::{apply_replacements, ReplacementEvent};
use crate::replacement::ReplacementResult;
use crate::spellability::{build_spell_ability, SpellAbility};
use crate::trigger::handler::TriggerHandler;
use crate::trigger::TriggerType;
use forge_foundation::ZoneType;

/// Build a formatted description for a roll dice effect.
/// Mirrors Java's `RollDiceEffect.makeFormatedDescription(SpellAbility)`.
///
/// Generates a human-readable description of the die roll including the
/// number of sides and result sub-abilities.
pub fn make_formated_description(game: &GameState, sa: &SpellAbility) -> String {
    let source_id = match sa.source {
        Some(id) => id,
        None => return "Roll a die.".to_string(),
    };

    let sides = sa.ir.sides.unwrap_or(6);
    let card_name = game.card(source_id).card_name.clone();

    let mut desc = format!("{} — Roll a d{}.", card_name, sides);

    if let Some(result_str) = sa.ir.result_sub_abilities_text.as_deref() {
        desc.push('\n');
        for entry in result_str.split(',') {
            let parts: Vec<&str> = entry.splitn(2, ':').collect();
            if parts.len() == 2 {
                let threshold = parts[0].trim();
                let svar_name = parts[1].trim();
                if let Some(svar_text) = game.card(source_id).get_s_var(svar_name) {
                    let params = crate::parsing::Params::from_raw(svar_text);
                    let effect_desc = params
                        .get_cloned(crate::parsing::keys::SPELL_DESCRIPTION)
                        .unwrap_or_else(|| svar_name.to_string());
                    desc.push_str(&format!("  {}: {}\n", threshold, effect_desc));
                }
            }
        }
    }

    desc
}

/// Wrap raw natural rolls as `DieRollResult`s (natural == modified at start).
/// Mirrors Java `RollDiceEffect.getResultsList(List<Integer>)`.
pub fn get_results_list(natural_results: &[i32]) -> Vec<DieRollResult> {
    natural_results
        .iter()
        .map(|&r| DieRollResult {
            natural_value: r,
            modified_value: r,
        })
        .collect()
}

/// Project `DieRollResult`s to their natural values.
/// Mirrors Java `RollDiceEffect.getNaturalResults(List<DieRollResult>)`.
pub fn get_natural_results(results: &[DieRollResult]) -> Vec<i32> {
    results.iter().map(|r| r.natural_value).collect()
}

/// Project `DieRollResult`s to their post-modification values.
/// Mirrors Java `RollDiceEffect.getFinalResults(List<DieRollResult>)`.
pub fn get_final_results(results: &[DieRollResult]) -> Vec<i32> {
    results.iter().map(|r| r.modified_value).collect()
}

/// Return the battlefield cards under `player` that can currently increment a
/// die roll (Xenosquirrel via P1P1 counter, Night Shift via life payment).
/// Mirrors Java `RollDiceEffect.getIncrementCards`.
pub fn get_increment_cards(
    game: &GameState,
    player: PlayerId,
    xeno_keyword: &str,
    night_shift_keyword: &str,
) -> Vec<crate::ids::CardId> {
    let mut out = Vec::new();
    let battlefield: Vec<_> = game.cards_in_zone(ZoneType::Battlefield, player).to_vec();

    for cid in battlefield.iter().copied() {
        let card = game.card(cid);
        if card.has_keyword(xeno_keyword)
            && card.counter_count(&crate::card::counter_type::CounterType::P1P1) > 0
        {
            out.push(cid);
        }
    }
    for cid in battlefield {
        let card = game.card(cid);
        if !card.has_keyword(night_shift_keyword) {
            continue;
        }
        // Java `canPayLife(1, true, ...)` — require at least 1 life available.
        if game.player(player).life >= 1 {
            out.push(cid);
        }
    }
    out
}

/// Roll dice for a specific player.
/// Mirrors Java's `RollDiceEffect.rollDiceForPlayer(Player, SpellAbility, ...)`.
///
/// This is a public wrapper around the internal `roll_for_player` function.
pub fn roll_dice_for_player(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    source_id: crate::ids::CardId,
    player: PlayerId,
    sides: i32,
    amount: i32,
) -> i32 {
    roll_for_player(ctx, sa, source_id, player, sides, amount)
}

/// Roll dice for a player specifically to visit attractions.
/// Mirrors Java's `RollDiceEffect.rollDiceForPlayerToVisitAttractions(Player)`.
///
/// Uses the full `roll_to_visit_attractions` function which handles
/// replacement effects, roll modifiers, and attraction visiting.
pub fn roll_dice_for_player_to_visit_attractions(
    game: &mut GameState,
    trigger_handler: &mut TriggerHandler,
    rng: &mut (impl crate::game_rng::GameRng + ?Sized),
    agents: &mut [Box<dyn crate::agent::PlayerAgent>],
    mana_pools: &mut [crate::mana::ManaPool],
    player: PlayerId,
) {
    roll_to_visit_attractions(game, trigger_handler, rng, agents, mana_pools, player);
}

/// `SP$ RollDice` — roll a die and resolve a sub-ability based on the result.
///
/// Mirrors Java's `RollDiceEffect.java`.
/// - `Sides$` — number of sides on the die (default 20 for d20).
/// - `ResultSubAbilities$` — comma-separated list of "threshold:SVar" pairs.
///   e.g. "1:Low,10:Mid,20:High" means 1-9→Low, 10-19→Mid, 20→High.
///
/// # Card script examples
/// ```text
/// A:SP$ RollDice | Sides$ 20 | ResultSubAbilities$ 1:Low,10:Mid,20:High
/// A:SP$ RollDice | Sides$ 6 | ResultSubAbilities$ 1:Fail,4:Success
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `RollDiceEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(RollDiceEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;
    let source_id = match sa.source {
        Some(id) => id,
        None => return,
    };
    let sides = sa.ir.sides.unwrap_or(6);
    let amount = resolve_numeric_svar(ctx.game, sa, "Amount", 1).max(0);
    let players = if let Some(player) = sa.target_chosen.target_player {
        vec![player]
    } else if let Some(defined) = sa.defined() {
        let resolved = resolve_defined_players(defined, controller, ctx.game);
        if resolved.is_empty() {
            vec![controller]
        } else {
            resolved
        }
    } else {
        vec![controller]
    };

    let mut results = Vec::new();
    for player in players.iter().copied() {
        let final_result = roll_for_player(ctx, sa, source_id, player, sides, amount);
        if sa.param_is_true("ToVisitYourAttractions") {
            visit_attractions(ctx.game, ctx.trigger_handler, player, final_result);
        }
        results.push((player, final_result));
    }

    if sa.param_is_true("RememberHighestPlayer") {
        if let Some(highest) = results.iter().map(|(_, result)| *result).max() {
            for (player, result) in results {
                if result == highest {
                    ctx.game.card_mut(source_id).add_remembered_player(player);
                }
            }
        }
    }
}

/// One die's natural roll + any modifications applied after the fact.
/// Mirrors Java's `RollDiceEffect.DieRollResult`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DieRollResult {
    pub natural_value: i32,
    pub modified_value: i32,
}

fn roll_for_player(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    source_id: crate::ids::CardId,
    player: PlayerId,
    sides: i32,
    amount: i32,
) -> i32 {
    let modifier = resolve_numeric_svar(ctx.game, sa, "Modifier", 0);
    let rolled_to_visit_attractions = sa.param_is_true("ToVisitYourAttractions");
    let ignore = resolve_numeric_svar(ctx.game, sa, "IgnoreLower", 0);
    let mut ignored_rolls = Vec::new();
    let mut dice_pt_exchanges = HashSet::new();
    let source_name = ctx.game.card(source_id).card_name.clone();
    let mut natural_rolls = roll_action(
        ctx.game,
        ctx.rng,
        ctx.agents,
        player,
        sides,
        amount,
        ignore,
        &mut ignored_rolls,
        &mut dice_pt_exchanges,
        Some(source_id),
    );

    if sa.param_is_true("UseHighestRoll") && natural_rolls.len() > 1 {
        let highest = natural_rolls.last().copied().unwrap_or(0);
        natural_rolls.clear();
        natural_rolls.push(highest);
    }

    apply_keyword_roll_rerolls(
        ctx,
        sa,
        player,
        sides,
        &mut natural_rolls,
        &mut ignored_rolls,
        &mut dice_pt_exchanges,
    );

    let mut results_list = apply_keyword_roll_modifiers(ctx, sa, player, &mut natural_rolls);
    for unmodified in natural_rolls {
        results_list.push(DieRollResult {
            natural_value: unmodified,
            modified_value: unmodified,
        });
    }

    apply_dice_pt_exchanges(
        ctx.agents,
        ctx.game,
        player,
        &mut results_list,
        &dice_pt_exchanges,
    );

    let kept_natural_rolls: Vec<i32> = results_list.iter().map(|roll| roll.natural_value).collect();
    let kept_rolls: Vec<i32> = results_list
        .iter()
        .map(|roll| roll.modified_value + modifier)
        .collect();

    let final_result = if sa.param_is_true("UseDifferenceBetweenRolls") && kept_rolls.len() >= 2 {
        kept_rolls.last().copied().unwrap_or(0) - kept_rolls.first().copied().unwrap_or(0)
    } else if sa.param_is_true("UseHighestRoll") {
        kept_rolls.iter().copied().max().unwrap_or(0)
    } else {
        kept_rolls.iter().sum()
    };

    if let Some(result_svar) = sa.ir.result_svar_text.as_deref() {
        ctx.game
            .card_mut(source_id)
            .set_s_var(result_svar, format!("Number${final_result}"));
    }
    if sa.param_is_true("StoreResults") {
        for roll in &kept_rolls {
            ctx.game.card_mut(source_id).add_stored_rolls(*roll);
        }
    }
    if sa.param_is_true("EvenOddResults") {
        let even = kept_rolls.iter().filter(|roll| **roll % 2 == 0).count();
        let odd = kept_rolls.len().saturating_sub(even);
        let source = ctx.game.card_mut(source_id);
        source.set_s_var("EvenResults", format!("Number${even}"));
        source.set_s_var("OddResults", format!("Number${odd}"));
    }
    if sa.param_is_true("DifferentResults") {
        let mut distinct = kept_rolls.clone();
        distinct.sort();
        distinct.dedup();
        ctx.game
            .card_mut(source_id)
            .set_s_var("DifferentResults", format!("Number${}", distinct.len()));
    }
    if sa.param_is_true("MaxRollsResults") {
        let max_rolls = kept_natural_rolls
            .iter()
            .filter(|roll| **roll == sides)
            .count();
        ctx.game
            .card_mut(source_id)
            .set_s_var("MaxRolls", format!("Number${max_rolls}"));
    }
    if let Some(chosen_svar) = sa.ir.chosen_svar_text.as_deref() {
        if !kept_rolls.is_empty() {
            let chosen = ctx.agents[player.index()]
                .choose_number_from_list(player, &kept_rolls, "Choose a result", Some(source_id))
                .unwrap_or(kept_rolls[0]);
            ctx.game
                .card_mut(source_id)
                .set_s_var(chosen_svar, format!("Number${chosen}"));
            if let Some(other_svar) = sa.ir.other_svar_text.as_deref() {
                let other = kept_rolls
                    .iter()
                    .copied()
                    .find(|roll| *roll != chosen)
                    .unwrap_or(chosen);
                ctx.game
                    .card_mut(source_id)
                    .set_s_var(other_svar, format!("Number${other}"));
            }
        }
    }
    if sa.param_is_true("NoteDoubles") {
        let mut unique = std::collections::HashSet::new();
        if kept_rolls.iter().any(|roll| !unique.insert(*roll)) {
            ctx.game.card_mut(source_id).set_s_var("Doubles", "1");
        }
    }

    let roll_start_number = ctx.game.player(player).num_rolls_this_turn;
    let roll_number_base = roll_start_number - amount;
    for (idx, roll) in results_list.iter().enumerate() {
        let result = roll.modified_value + modifier;
        ctx.trigger_handler.run_trigger(
            TriggerType::RolledDie,
            RunParams {
                player: Some(player),
                die_result: Some(result),
                natural_result: Some(roll.natural_value),
                die_sides: Some(sides),
                number: Some(roll_number_base + idx as i32 + 1),
                rolled_to_visit_attractions: Some(rolled_to_visit_attractions),
                ..Default::default()
            },
            false,
        );
    }
    ctx.trigger_handler.run_trigger(
        TriggerType::RolledDieOnce,
        RunParams {
            player: Some(player),
            die_result: Some(final_result),
            die_results: Some(kept_rolls.clone()),
            die_sides: Some(sides),
            rolled_to_visit_attractions: Some(rolled_to_visit_attractions),
            ..Default::default()
        },
        false,
    );

    // Notify agents of the roll result
    let rolled_text = kept_rolls
        .iter()
        .map(i32::to_string)
        .collect::<Vec<_>>()
        .join(", ");
    crate::agent::notify_all_agents(
        ctx.agents,
        GameLogEvent::rule(format!("Rolled {} (d{})", rolled_text, sides)).with_player(player),
    );
    if !ignored_rolls.is_empty() {
        let ignored_text = ignored_rolls
            .iter()
            .map(i32::to_string)
            .collect::<Vec<_>>()
            .join(", ");
        crate::agent::notify_all_agents(
            ctx.agents,
            GameLogEvent::rule(format!("Ignored rolls: {ignored_text}")).with_player(player),
        );
    }
    crate::agent::game_log::broadcast_notification(
        ctx.agents,
        GameNotification::DiceRolled {
            player,
            sides,
            natural_results: kept_natural_rolls.clone(),
            final_results: kept_rolls.clone(),
            ignored_rolls: ignored_rolls.clone(),
            source_card_name: Some(source_name.clone()),
        },
    );
    for agent in ctx.agents.iter_mut() {
        agent.await_display_ack();
    }

    if sa.param_is_true("SubsForEach") {
        if let Some(result_str) = sa.ir.result_sub_abilities_text.as_deref() {
            for roll in &kept_rolls {
                resolve_result_sub_ability(ctx, sa, source_id, player, *roll, result_str);
            }
        }
    } else if let Some(result_str) = sa.ir.result_sub_abilities_text.as_deref() {
        resolve_result_sub_ability(ctx, sa, source_id, player, final_result, result_str);
    }

    if sa.param_is_true("RerollResults") {
        let stored_rolls = ctx.game.card(source_id).remembered_cmc.clone();
        let mut replacements = Vec::new();
        for old_roll in stored_rolls {
            if ctx.agents[player.index()].confirm_action(
                player,
                Some("RerollResult"),
                &format!("Reroll result {old_roll}?"),
                &[],
                Some(source_id),
                sa.api,
            ) {
                let new_roll = roll_for_player(ctx, sa, source_id, player, sides, 1);
                replacements.push((old_roll, new_roll));
            }
        }
        for (old_roll, new_roll) in replacements {
            ctx.game
                .card_mut(source_id)
                .replace_stored_roll(old_roll, new_roll);
        }
    }

    // Parse ResultSubAbilities$ and find the matching threshold
    final_result
}

pub fn roll_to_visit_attractions(
    game: &mut GameState,
    trigger_handler: &mut TriggerHandler,
    rng: &mut (impl GameRng + ?Sized),
    agents: &mut [Box<dyn crate::agent::PlayerAgent>],
    mana_pools: &mut [crate::mana::ManaPool],
    player: PlayerId,
) {
    let mut event = ReplacementEvent::RollDice {
        player,
        sides: 6,
        number: 1,
        ignore: 0,
        ignore_chosen: HashMap::new(),
        dice_pt_exchanges: HashSet::new(),
    };
    let result = apply_replacements(game, &mut event);
    if result == ReplacementResult::Skipped || result == ReplacementResult::Replaced {
        return;
    }

    let (roll_count, ignore_lowest, ignore_chosen, dice_pt_exchanges) = match event {
        ReplacementEvent::RollDice {
            number,
            ignore,
            ignore_chosen,
            dice_pt_exchanges,
            ..
        } => (
            number.max(0),
            ignore.max(0),
            ignore_chosen.clone(),
            dice_pt_exchanges.clone(),
        ),
        _ => (1, 0, HashMap::new(), HashSet::new()),
    };
    if roll_count == 0 {
        return;
    }

    let mut natural_rolls = Vec::new();
    for _ in 0..roll_count {
        natural_rolls.push(rng.next_int(6) + 1);
    }
    natural_rolls.sort();

    let ignore_count = ignore_lowest.min(natural_rolls.len() as i32) as usize;
    let ignored_rolls: Vec<i32> = natural_rolls.drain(..ignore_count).collect();
    let (ignored_by_choice, _) = apply_chosen_ignores(
        agents,
        "Attraction roll",
        &mut natural_rolls,
        &ignore_chosen,
    );
    let mut ignored_rolls = ignored_rolls;
    ignored_rolls.extend(ignored_by_choice);
    let mut results_list = apply_keyword_roll_modifiers_for_attraction(
        game,
        trigger_handler,
        agents,
        mana_pools,
        player,
        &mut natural_rolls,
    );
    for unmodified in natural_rolls {
        results_list.push(DieRollResult {
            natural_value: unmodified,
            modified_value: unmodified,
        });
    }
    apply_dice_pt_exchanges(agents, game, player, &mut results_list, &dice_pt_exchanges);
    let kept_rolls: Vec<i32> = results_list
        .iter()
        .map(|roll| roll.modified_value)
        .collect();
    let final_result: i32 = kept_rolls.iter().sum();

    let roll_start_number = game.player(player).num_rolls_this_turn;
    let roll_number_base = roll_start_number - 1;
    for (idx, result) in kept_rolls.iter().copied().enumerate() {
        trigger_handler.run_trigger(
            TriggerType::RolledDie,
            RunParams {
                player: Some(player),
                die_result: Some(result),
                natural_result: Some(results_list[idx].natural_value),
                die_sides: Some(6),
                number: Some(roll_number_base + idx as i32 + 1),
                rolled_to_visit_attractions: Some(true),
                ..Default::default()
            },
            false,
        );
    }
    trigger_handler.run_trigger(
        TriggerType::RolledDieOnce,
        RunParams {
            player: Some(player),
            die_result: Some(final_result),
            die_results: Some(kept_rolls.clone()),
            die_sides: Some(6),
            rolled_to_visit_attractions: Some(true),
            ..Default::default()
        },
        false,
    );

    let rolled_text = kept_rolls
        .iter()
        .map(i32::to_string)
        .collect::<Vec<_>>()
        .join(", ");
    crate::agent::notify_all_agents(
        agents,
        GameLogEvent::rule(format!("Rolled {} (d6)", rolled_text)).with_player(player),
    );
    if !ignored_rolls.is_empty() {
        let ignored_text = ignored_rolls
            .iter()
            .map(i32::to_string)
            .collect::<Vec<_>>()
            .join(", ");
        crate::agent::notify_all_agents(
            agents,
            GameLogEvent::rule(format!("Ignored rolls: {ignored_text}")).with_player(player),
        );
    }
    let natural_results: Vec<i32> = results_list.iter().map(|r| r.natural_value).collect();
    crate::agent::game_log::broadcast_notification(
        agents,
        GameNotification::DiceRolled {
            player,
            sides: 6,
            natural_results,
            final_results: kept_rolls.clone(),
            ignored_rolls: ignored_rolls.clone(),
            source_card_name: Some("Attraction roll".to_string()),
        },
    );
    for agent in agents.iter_mut() {
        agent.await_display_ack();
    }

    visit_attractions(game, trigger_handler, player, final_result);
}

fn apply_chosen_ignores(
    agents: &mut [Box<dyn crate::agent::PlayerAgent>],
    card_name: &str,
    natural_rolls: &mut Vec<i32>,
    ignore_chosen: &HashMap<PlayerId, i32>,
) -> (Vec<i32>, Vec<i32>) {
    let mut ignored = Vec::new();
    for (&chooser, &count) in ignore_chosen {
        for _ in 0..count.max(0) {
            if natural_rolls.is_empty() {
                break;
            }
            let choice = agents[chooser.index()]
                .choose_roll_to_ignore(chooser, natural_rolls, None)
                .unwrap_or(natural_rolls[0]);
            let position = natural_rolls
                .iter()
                .position(|roll| *roll == choice)
                .unwrap_or(0);
            ignored.push(natural_rolls.remove(position));
        }
    }
    (ignored, natural_rolls.clone())
}

fn roll_action(
    game: &mut GameState,
    rng: &mut (impl GameRng + ?Sized),
    agents: &mut [Box<dyn crate::agent::PlayerAgent>],
    player: PlayerId,
    sides: i32,
    amount: i32,
    ignore: i32,
    ignored_rolls: &mut Vec<i32>,
    dice_pt_exchanges: &mut HashSet<crate::ids::CardId>,
    source: Option<crate::ids::CardId>,
) -> Vec<i32> {
    let mut event = ReplacementEvent::RollDice {
        player,
        sides,
        number: amount,
        ignore,
        ignore_chosen: HashMap::new(),
        dice_pt_exchanges: HashSet::new(),
    };
    let result = apply_replacements(game, &mut event);
    if result == ReplacementResult::Skipped || result == ReplacementResult::Replaced {
        return Vec::new();
    }

    let (roll_count, ignore_lowest, ignore_chosen, new_pt_exchanges) = match event {
        ReplacementEvent::RollDice {
            number,
            ignore,
            ignore_chosen,
            dice_pt_exchanges,
            ..
        } => (
            number.max(0),
            ignore.max(0),
            ignore_chosen,
            dice_pt_exchanges,
        ),
        _ => (amount.max(0), ignore.max(0), HashMap::new(), HashSet::new()),
    };
    dice_pt_exchanges.extend(new_pt_exchanges);

    let mut natural_rolls = Vec::new();
    for _ in 0..roll_count {
        natural_rolls.push(rng.next_int(sides) + 1);
        game.player_record_roll(player, None);
    }
    natural_rolls.sort();

    let ignore_count = ignore_lowest.min(natural_rolls.len() as i32) as usize;
    ignored_rolls.extend(natural_rolls.drain(..ignore_count));

    let (ignored_by_choice, _) =
        apply_chosen_ignores(agents, "Roll", &mut natural_rolls, &ignore_chosen);
    ignored_rolls.extend(ignored_by_choice);
    natural_rolls
}

fn apply_dice_pt_exchanges(
    agents: &mut [Box<dyn crate::agent::PlayerAgent>],
    game: &mut GameState,
    player: PlayerId,
    results_list: &mut [DieRollResult],
    dice_pt_exchanges: &HashSet<crate::ids::CardId>,
) {
    let mut available_cards: Vec<_> = dice_pt_exchanges.iter().copied().collect();
    while !available_cards.is_empty() && !results_list.is_empty() {
        let current_rolls: Vec<i32> = results_list
            .iter()
            .map(|roll| roll.modified_value)
            .collect();
        let roll = agents[player.index()].choose_roll_to_swap(player, &current_rolls, None);
        let Some(roll_value) = roll else { break };
        let Some(roll_index) = results_list
            .iter()
            .position(|roll| roll.modified_value == roll_value)
        else {
            break;
        };
        let card_id = available_cards.remove(0);
        let current_power = game.card(card_id).power();
        let current_toughness = game.card(card_id).toughness();
        let choice = agents[player.index()].choose_roll_swap_value(
            player,
            roll_value,
            current_power,
            current_toughness,
            Some(card_id),
        );
        let Some(choice) = choice else { continue };
        match choice {
            crate::agent::RollSwapChoice::Power => {
                results_list[roll_index].modified_value = current_power;
                game.card_mut(card_id)
                    .add_new_pt(roll_value, current_toughness);
            }
            crate::agent::RollSwapChoice::Toughness => {
                results_list[roll_index].modified_value = current_toughness;
                game.card_mut(card_id).add_new_pt(current_power, roll_value);
            }
        }
    }
}

fn apply_keyword_roll_modifiers(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    player: PlayerId,
    natural_rolls: &mut Vec<i32>,
) -> Vec<DieRollResult> {
    apply_simple_roll_modifiers(
        ctx.game,
        ctx.trigger_handler,
        ctx.agents,
        ctx.mana_pools,
        player,
        natural_rolls,
        Some(sa),
    )
}

fn apply_keyword_roll_modifiers_for_attraction(
    game: &mut GameState,
    trigger_handler: &mut TriggerHandler,
    agents: &mut [Box<dyn crate::agent::PlayerAgent>],
    mana_pools: &mut [crate::mana::ManaPool],
    player: PlayerId,
    natural_rolls: &mut Vec<i32>,
) -> Vec<DieRollResult> {
    apply_simple_roll_modifiers(
        game,
        trigger_handler,
        agents,
        mana_pools,
        player,
        natural_rolls,
        None,
    )
}

fn apply_simple_roll_modifiers(
    game: &mut GameState,
    trigger_handler: &mut TriggerHandler,
    agents: &mut [Box<dyn crate::agent::PlayerAgent>],
    mana_pools: &mut [crate::mana::ManaPool],
    player: PlayerId,
    natural_rolls: &mut Vec<i32>,
    source_sa: Option<&SpellAbility>,
) -> Vec<DieRollResult> {
    const XENO_KEYWORD: &str =
        "After you roll a die, you may remove a +1/+1 counter from Xenosquirrels. If you do, increase or decrease the result by 1.";
    const NIGHT_SHIFT_KEYWORD: &str =
        "After you roll a die, you may pay 1 life. If you do, increase or decrease the result by 1. Do this only once each turn.";
    let mut results_list = Vec::new();

    loop {
        if natural_rolls.is_empty() {
            break;
        }

        let modifiers: Vec<_> = game
            .cards_in_zone(forge_foundation::ZoneType::Battlefield, player)
            .iter()
            .copied()
            .filter(|&card_id| {
                can_modify_roll(game, player, card_id, XENO_KEYWORD, NIGHT_SHIFT_KEYWORD)
            })
            .collect();
        if modifiers.is_empty() {
            break;
        }

        let roll = agents[player.index()].choose_roll_to_modify(player, natural_rolls, None);
        let Some(mut roll_value) = roll else { break };
        let Some(roll_index) = natural_rolls.iter().position(|value| *value == roll_value) else {
            break;
        };

        let mut available = modifiers;
        let mut modified = false;
        let natural_value = roll_value;
        while !available.is_empty() {
            let chosen = agents[player.index()].choose_single_card_for_zone_change(
                game,
                player,
                &available,
                "Choose a roll modifier",
                true,
            );
            let Some(card_id) = chosen else { break };
            let roll_modify_cost = game
                .card(card_id)
                .svars
                .get("RollModifyCost")
                .cloned()
                .unwrap_or_default();
            let can_pay = pay_roll_cost(
                game,
                trigger_handler,
                agents,
                mana_pools,
                player,
                card_id,
                &roll_modify_cost,
                source_sa,
            );
            available.retain(|candidate| *candidate != card_id);
            if !can_pay {
                continue;
            }
            let increase = agents[player.index()].choose_binary(
                player,
                "Increase or decrease the roll?",
                crate::agent::BinaryChoiceKind::IncreaseOrDecrease,
                Some(true),
                Some(card_id),
                source_sa.and_then(|sa| sa.api),
            );
            roll_value += if increase { 1 } else { -1 };
            increment_roll_modifications(game, card_id);
            modified = true;
        }

        if modified {
            natural_rolls.remove(roll_index);
            results_list.push(DieRollResult {
                natural_value,
                modified_value: roll_value,
            });
        } else {
            break;
        }
    }
    results_list
}

fn can_modify_roll(
    game: &GameState,
    player: PlayerId,
    card_id: crate::ids::CardId,
    xeno_keyword: &str,
    night_shift_keyword: &str,
) -> bool {
    let card = game.card(card_id);
    if card.has_keyword(xeno_keyword) {
        return card.counter_count(&crate::card::CounterType::P1P1) > 0;
    }
    if card.has_keyword(night_shift_keyword) {
        let limit = card
            .svars
            .get("RollModificationsLimit")
            .map(|value| value.trim())
            .unwrap_or("None");
        let used = roll_modifications_used(card);
        let under_limit = limit.eq_ignore_ascii_case("None")
            || limit.parse::<i32>().ok().is_some_and(|max| used < max);
        return under_limit
            && game.player(player).life > 1
            && !crate::staticability::static_ability_cant_gain_lose_pay_life::cant_pay_life(
                game, player, true, None,
            );
    }
    false
}

fn roll_modifications_used(card: &crate::card::Card) -> i32 {
    card.svars
        .get("ModsThisTurn")
        .and_then(|value| value.strip_prefix("Number$"))
        .and_then(|value| value.parse::<i32>().ok())
        .unwrap_or(0)
}

fn increment_roll_modifications(game: &mut GameState, card_id: crate::ids::CardId) {
    let used = roll_modifications_used(game.card(card_id)) + 1;
    game.card_mut(card_id)
        .set_s_var("ModsThisTurn", format!("Number${used}"));
}

fn can_pay_roll_cost(
    game: &GameState,
    mana_pools: &[crate::mana::ManaPool],
    player: PlayerId,
    card_id: crate::ids::CardId,
    cost: &Cost,
    source_sa: Option<&SpellAbility>,
) -> bool {
    let available = mana::calculate_available_mana(&mana_pools[player.index()], game, player);
    crate::cost::can_pay_with_ability(cost, game, &available, card_id, player, source_sa)
}

fn pay_roll_cost(
    game: &mut GameState,
    trigger_handler: &mut TriggerHandler,
    agents: &mut [Box<dyn crate::agent::PlayerAgent>],
    mana_pools: &mut [crate::mana::ManaPool],
    player: PlayerId,
    card_id: crate::ids::CardId,
    cost_raw: &str,
    source_sa: Option<&SpellAbility>,
) -> bool {
    let cost = parse_cost(cost_raw);
    if !can_pay_roll_cost(game, mana_pools, player, card_id, &cost, source_sa) {
        return false;
    }

    for part in &cost.parts {
        let should_ask = matches!(
            part,
            CostPart::DamageYou(_)
                | CostPart::PayLife(_)
                | CostPart::Draw(_)
                | CostPart::Mill(_)
                | CostPart::AddMana { .. }
                | CostPart::Discard { .. }
                | CostPart::Sacrifice { .. }
        );
        if should_ask
            && !agents[player.index()].confirm_payment(
                player,
                match part {
                    CostPart::DamageYou(_) => "DamageYou",
                    CostPart::PayLife(_) => "PayLife",
                    CostPart::Draw(_) => "Draw",
                    CostPart::Mill(_) => "Mill",
                    CostPart::AddMana { .. } => "AddMana",
                    CostPart::Discard { .. } => "Discard",
                    CostPart::Sacrifice { .. } => "Sacrifice",
                    _ => "Cost",
                },
                "Pay roll modification cost?",
                Some(card_id),
                source_sa.and_then(|sa| sa.api),
            )
        {
            return false;
        }
    }

    for part in &cost.parts {
        match part {
            CostPart::Mana {
                cost: mana_cost, ..
            } => {
                let game_ptr: *mut GameState = game;
                let trigger_handler_ptr = std::ptr::from_mut(trigger_handler);
                let mut callback = |kind: mana::ManaPayCallback<'_>| -> Option<crate::ids::CardId> {
                    match kind {
                        mana::ManaPayCallback::ChooseSacrifice(valid) => {
                            agents[player.index()].choose_sacrifice(player, valid, Some(card_id))
                        }
                        mana::ManaPayCallback::ChooseColor(valid_colors) => {
                            // Always invoke the agent — humans see an
                            // interactive `ChooseColor` modal, AI
                            // returns a default. No engine-side branch.
                            let _ = agents[player.index()].choose_color(player, valid_colors);
                            None
                        }
                        mana::ManaPayCallback::ChooseTapType { .. } => None,
                        mana::ManaPayCallback::ConfirmSelfSacrifice(sacrifice_id) => {
                            if agents[player.index()].confirm_payment(
                                player,
                                "Sacrifice",
                                "Sacrifice for mana",
                                None,
                                Some(crate::ability::api_type::ApiType::Mana),
                            ) {
                                Some(sacrifice_id)
                            } else {
                                None
                            }
                        }
                        mana::ManaPayCallback::ConfirmSubCounter(source_id) => {
                            if agents[player.index()].confirm_payment(
                                player,
                                "SubCounter",
                                "Remove counter for mana",
                                None,
                                Some(crate::ability::api_type::ApiType::Mana),
                            ) {
                                Some(source_id)
                            } else {
                                None
                            }
                        }
                        mana::ManaPayCallback::ConfirmSourceExile(source_id) => {
                            if agents[player.index()].confirm_payment(
                                player,
                                "Exile",
                                "Exile for mana",
                                None,
                                Some(crate::ability::api_type::ApiType::Mana),
                            ) {
                                Some(source_id)
                            } else {
                                None
                            }
                        }
                        mana::ManaPayCallback::ConfirmPayLife(source_id) => {
                            if agents[player.index()].confirm_payment(
                                player,
                                "PayLife",
                                "Pay life for mana",
                                None,
                                Some(crate::ability::api_type::ApiType::Mana),
                            ) {
                                Some(source_id)
                            } else {
                                None
                            }
                        }
                        mana::ManaPayCallback::NotifySacrificeForMana(sacrificed_id) => unsafe {
                            let game = &mut *game_ptr;
                            let trigger_handler = &mut *trigger_handler_ptr;
                            let owner = game.card(sacrificed_id).owner;
                            let controller = game.card(sacrificed_id).controller;
                            let lki_counters = game.card(sacrificed_id).counters.clone();
                            let lki_power = game.card(sacrificed_id).power();
                            let lki_toughness = game.card(sacrificed_id).toughness();
                            let lki_p1p1 = *lki_counters
                                .get(&crate::card::CounterType::P1P1)
                                .unwrap_or(&0);
                            {
                                let card = game.card_mut(sacrificed_id);
                                card.lki_counters = Some(lki_counters);
                                card.set_lki_power_toughness(Some(lki_power), Some(lki_toughness));
                            }
                            game.last_sacrificed_card = Some(sacrificed_id);
                            trigger_handler.run_trigger(
                                TriggerType::Sacrificed,
                                RunParams {
                                    card: Some(sacrificed_id),
                                    player: Some(controller),
                                    ..Default::default()
                                },
                                false,
                            );
                            crate::ability::effects::emit_zone_trigger_with_lki_counters(
                                trigger_handler,
                                sacrificed_id,
                                ZoneType::Battlefield,
                                ZoneType::Graveyard,
                                lki_p1p1,
                                lki_power,
                                lki_toughness,
                            );
                            trigger_handler.flush_waiting_triggers(game);
                            game.move_card(sacrificed_id, ZoneType::Graveyard, owner);
                            let mut by_controller = std::collections::BTreeMap::new();
                            by_controller.insert(controller, vec![sacrificed_id]);
                            crate::game_loop::fire_sacrificed_once_for_batch(
                                game,
                                trigger_handler,
                                &by_controller,
                            );
                            Some(sacrificed_id)
                        },
                        mana::ManaPayCallback::ApplyProduceManaReplacement {
                            activator,
                            source_card,
                            mana,
                        } => unsafe {
                            let game = &mut *game_ptr;
                            let mut event =
                                crate::replacement::replacement_handler::ReplacementEvent::ProduceMana {
                                    source: source_card,
                                    activator,
                                    mana: mana.clone(),
                                };
                            let result =
                                crate::replacement::replacement_handler::apply_replacements_with_agents(
                                    game, agents, &mut event,
                                );
                            if result == crate::replacement::ReplacementResult::Updated {
                                if let crate::replacement::replacement_handler::ReplacementEvent::ProduceMana {
                                    mana: new_mana,
                                    ..
                                } = event
                                {
                                    *mana = new_mana;
                                }
                            }
                            None
                        },
                    }
                };
                let tapped = mana::auto_tap_lands_with_callbacks(
                    game,
                    &mut mana_pools[player.index()],
                    player,
                    mana_cost,
                    Some(card_id),
                    &mut callback,
                );
                for &land_id in &tapped {
                    trigger_handler.run_trigger(
                        TriggerType::Taps,
                        RunParams {
                            card: Some(land_id),
                            player: Some(player),
                            ..Default::default()
                        },
                        false,
                    );
                    trigger_handler.run_trigger(
                        TriggerType::TapsForMana,
                        RunParams {
                            card: Some(land_id),
                            player: Some(player),
                            ..Default::default()
                        },
                        false,
                    );
                }
                if !mana_pools[player.index()].try_pay(mana_cost) {
                    return false;
                }
            }
            CostPart::PayLife(amount) => {
                game.player_lose_life(player, amount.resolve(game, card_id, player));
                trigger_handler.run_trigger(
                    TriggerType::LifeLost,
                    RunParams {
                        player: Some(player),
                        life_amount: Some(amount.resolve(game, card_id, player)),
                        first_time: Some(false),
                        ..Default::default()
                    },
                    false,
                );
            }
            CostPart::SubCounter {
                amount,
                counter_type,
                ..
            } => {
                let amount_n = amount.resolve(game, card_id, player);
                if game.card(card_id).counter_count(counter_type) < amount_n {
                    return false;
                }
                game.card_mut(card_id)
                    .remove_counter(counter_type, amount_n);
            }
            _ => return false,
        }
    }

    true
}

fn apply_keyword_roll_rerolls(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    player: PlayerId,
    sides: i32,
    natural_rolls: &mut Vec<i32>,
    ignored_rolls: &mut Vec<i32>,
    dice_pt_exchanges: &mut HashSet<crate::ids::CardId>,
) {
    const MONITOR_KEYWORD: &str =
        "Once each turn, you may pay {1} to reroll one or more dice you rolled.";

    loop {
        let reroll_cards = get_reroll_cards(ctx.game, player, MONITOR_KEYWORD);
        if reroll_cards.is_empty() || natural_rolls.is_empty() {
            break;
        }

        let dice_to_reroll = ctx.agents[player.index()].choose_dice_to_reroll(
            player,
            natural_rolls,
            Some(sa.source.unwrap_or(reroll_cards[0])),
        );
        if dice_to_reroll.is_empty() {
            break;
        }

        let chosen = ctx.agents[player.index()].choose_single_card_for_zone_change(
            ctx.game,
            player,
            &reroll_cards,
            "Choose a card to reroll dice",
            true,
        );
        let Some(card_id) = chosen else { break };
        let reroll_cost = ctx
            .game
            .card(card_id)
            .svars
            .get("RollRerollCost")
            .cloned()
            .unwrap_or_default();
        if !pay_roll_cost(
            ctx.game,
            ctx.trigger_handler,
            ctx.agents,
            ctx.mana_pools,
            player,
            card_id,
            &reroll_cost,
            Some(sa),
        ) {
            continue;
        }

        for reroll in &dice_to_reroll {
            if let Some(position) = natural_rolls.iter().position(|roll| roll == reroll) {
                natural_rolls.remove(position);
            }
        }

        let reroll_card_name = ctx.game.card(card_id).card_name.clone();
        let rerolled = roll_action(
            ctx.game,
            ctx.rng,
            ctx.agents,
            player,
            sides,
            dice_to_reroll.len() as i32,
            0,
            ignored_rolls,
            dice_pt_exchanges,
            sa.source,
        );
        natural_rolls.extend(rerolled);
        natural_rolls.sort();
        increment_roll_modifications(ctx.game, card_id);
    }
}

/// Return the battlefield cards under `player` that can currently reroll dice.
/// Mirrors Java `RollDiceEffect.getRerollCards`.
pub fn get_reroll_cards(
    game: &GameState,
    player: PlayerId,
    monitor_keyword: &str,
) -> Vec<crate::ids::CardId> {
    game.cards_in_zone(forge_foundation::ZoneType::Battlefield, player)
        .iter()
        .copied()
        .filter(|&card_id| {
            let card = game.card(card_id);
            if !card.has_keyword(monitor_keyword) {
                return false;
            }
            let limit = card
                .svars
                .get("RollModificationsLimit")
                .map(String::as_str)
                .unwrap_or("None");
            let used = roll_modifications_used(card);
            limit.eq_ignore_ascii_case("None")
                || limit.parse::<i32>().ok().is_some_and(|max| used < max)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::PlayerAgent;
    use crate::card::Card;
    use crate::game_rng::GameRng;
    use crate::ids::{CardId, PlayerId};
    use crate::mana::ManaPool;
    use crate::spellability::SpellAbility;
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost};
    use std::collections::VecDeque;

    struct FixedRng {
        values: VecDeque<i32>,
    }

    impl FixedRng {
        fn new(values: &[i32]) -> Self {
            Self {
                values: values.iter().copied().collect(),
            }
        }
    }

    impl GameRng for FixedRng {
        fn shuffle_cards(&mut self, _cards: &mut [CardId]) {}

        fn next_int(&mut self, bound: i32) -> i32 {
            let value = self.values.pop_front().unwrap_or(0);
            assert!(
                value >= 0 && value < bound,
                "fixed rng value {value} out of range for {bound}"
            );
            value
        }
    }

    struct SwapAgent;

    impl PlayerAgent for SwapAgent {
        fn mulligan_decision(
            &mut self,
            _player: PlayerId,
            _hand: &[CardId],
            _mulligan_count: u32,
        ) -> bool {
            true
        }

        fn choose_action(
            &mut self,
            player: PlayerId,
            action_space: Option<&crate::agent::PriorityActionSpace>,
            request_action_space: &mut dyn FnMut() -> crate::agent::PriorityActionSpace,
        ) -> crate::player::actions::PlayerAction {
            crate::player::actions::PlayerAction::PassPriority
        }

        fn choose_attackers(
            &mut self,
            _player: PlayerId,
            _available: &[CardId],
            _possible_defenders: &[crate::combat::DefenderId],
        ) -> Vec<(CardId, crate::combat::DefenderId)> {
            vec![]
        }

        fn choose_blockers(
            &mut self,
            _player: PlayerId,
            _attackers: &[CardId],
            _available_blockers: &[CardId],
            _max_blockers: Option<usize>,
        ) -> Vec<(CardId, CardId)> {
            vec![]
        }

        fn choose_target_player(
            &mut self,
            _player: PlayerId,
            _valid: &[PlayerId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> Option<PlayerId> {
            None
        }

        fn choose_target_card(
            &mut self,
            _player: PlayerId,
            _valid: &[CardId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> Option<CardId> {
            None
        }

        fn choose_target_any(
            &mut self,
            _player: PlayerId,
            _valid_players: &[PlayerId],
            _valid_cards: &[CardId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> crate::agent::TargetChoice {
            crate::agent::TargetChoice::None
        }

        fn choose_roll_to_swap(
            &mut self,
            _player: PlayerId,
            rolls: &[i32],
            _source: Option<crate::ids::CardId>,
        ) -> Option<i32> {
            rolls.first().copied()
        }

        fn choose_roll_swap_value(
            &mut self,
            _player: PlayerId,
            _current_result: i32,
            _power: i32,
            _toughness: i32,
            _source: Option<crate::ids::CardId>,
        ) -> Option<crate::agent::RollSwapChoice> {
            Some(crate::agent::RollSwapChoice::Power)
        }

        fn choose_land_or_spell(&mut self, _player: PlayerId) -> Option<bool> {
            Some(true)
        }

        fn choose_targets_for(
            &mut self,
            _sa: &mut SpellAbility,
            _game: &GameState,
            _mana_pools: &[ManaPool],
        ) -> bool {
            false
        }
    }

    struct ModifyAgent;

    impl PlayerAgent for ModifyAgent {
        fn mulligan_decision(
            &mut self,
            _player: PlayerId,
            _hand: &[CardId],
            _mulligan_count: u32,
        ) -> bool {
            true
        }

        fn choose_action(
            &mut self,
            player: PlayerId,
            action_space: Option<&crate::agent::PriorityActionSpace>,
            request_action_space: &mut dyn FnMut() -> crate::agent::PriorityActionSpace,
        ) -> crate::player::actions::PlayerAction {
            crate::player::actions::PlayerAction::PassPriority
        }

        fn choose_attackers(
            &mut self,
            _player: PlayerId,
            _available: &[CardId],
            _possible_defenders: &[crate::combat::DefenderId],
        ) -> Vec<(CardId, crate::combat::DefenderId)> {
            vec![]
        }

        fn choose_blockers(
            &mut self,
            _player: PlayerId,
            _attackers: &[CardId],
            _available_blockers: &[CardId],
            _max_blockers: Option<usize>,
        ) -> Vec<(CardId, CardId)> {
            vec![]
        }

        fn choose_target_player(
            &mut self,
            _player: PlayerId,
            _valid: &[PlayerId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> Option<PlayerId> {
            None
        }

        fn choose_target_card(
            &mut self,
            _player: PlayerId,
            _valid: &[CardId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> Option<CardId> {
            None
        }

        fn choose_target_any(
            &mut self,
            _player: PlayerId,
            _valid_players: &[PlayerId],
            _valid_cards: &[CardId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> crate::agent::TargetChoice {
            crate::agent::TargetChoice::None
        }

        fn choose_roll_to_modify(
            &mut self,
            _player: PlayerId,
            rolls: &[i32],
            _source: Option<crate::ids::CardId>,
        ) -> Option<i32> {
            rolls.first().copied()
        }

        fn choose_single_card_for_zone_change(
            &mut self,
            _game: &crate::game::GameState,
            _player: PlayerId,
            valid: &[CardId],
            _select_prompt: &str,
            _is_optional: bool,
        ) -> Option<CardId> {
            valid.first().copied()
        }

        fn choose_binary(
            &mut self,
            _player: PlayerId,
            _question: &str,
            _kind: crate::agent::BinaryChoiceKind,
            _default: Option<bool>,
            _source: Option<crate::ids::CardId>,
            _api: Option<crate::ability::api_type::ApiType>,
        ) -> bool {
            true
        }

        fn choose_land_or_spell(&mut self, _player: PlayerId) -> Option<bool> {
            Some(true)
        }

        fn choose_targets_for(
            &mut self,
            _sa: &mut SpellAbility,
            _game: &GameState,
            _mana_pools: &[ManaPool],
        ) -> bool {
            false
        }
    }

    struct RerollAgent;

    impl PlayerAgent for RerollAgent {
        fn mulligan_decision(
            &mut self,
            _player: PlayerId,
            _hand: &[CardId],
            _mulligan_count: u32,
        ) -> bool {
            true
        }

        fn choose_action(
            &mut self,
            player: PlayerId,
            action_space: Option<&crate::agent::PriorityActionSpace>,
            request_action_space: &mut dyn FnMut() -> crate::agent::PriorityActionSpace,
        ) -> crate::player::actions::PlayerAction {
            crate::player::actions::PlayerAction::PassPriority
        }

        fn choose_attackers(
            &mut self,
            _player: PlayerId,
            _available: &[CardId],
            _possible_defenders: &[crate::combat::DefenderId],
        ) -> Vec<(CardId, crate::combat::DefenderId)> {
            vec![]
        }

        fn choose_blockers(
            &mut self,
            _player: PlayerId,
            _attackers: &[CardId],
            _available_blockers: &[CardId],
            _max_blockers: Option<usize>,
        ) -> Vec<(CardId, CardId)> {
            vec![]
        }

        fn choose_target_player(
            &mut self,
            _player: PlayerId,
            _valid: &[PlayerId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> Option<PlayerId> {
            None
        }

        fn choose_target_card(
            &mut self,
            _player: PlayerId,
            _valid: &[CardId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> Option<CardId> {
            None
        }

        fn choose_target_any(
            &mut self,
            _player: PlayerId,
            _valid_players: &[PlayerId],
            _valid_cards: &[CardId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> crate::agent::TargetChoice {
            crate::agent::TargetChoice::None
        }

        fn choose_dice_to_reroll(
            &mut self,
            _player: PlayerId,
            rolls: &[i32],
            _source: Option<crate::ids::CardId>,
        ) -> Vec<i32> {
            rolls.first().copied().into_iter().collect()
        }

        fn choose_single_card_for_zone_change(
            &mut self,
            _game: &crate::game::GameState,
            _player: PlayerId,
            valid: &[CardId],
            _select_prompt: &str,
            _is_optional: bool,
        ) -> Option<CardId> {
            valid.first().copied()
        }

        fn choose_land_or_spell(&mut self, _player: PlayerId) -> Option<bool> {
            Some(true)
        }

        fn choose_targets_for(
            &mut self,
            _sa: &mut SpellAbility,
            _game: &GameState,
            _mana_pools: &[ManaPool],
        ) -> bool {
            false
        }
    }

    #[test]
    fn dice_pt_exchange_swaps_roll_with_power() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let player = PlayerId(0);
        let mut card = Card::new(
            CardId(0),
            "Vedalken Squirrel-Whacker".to_string(),
            player,
            CardTypeLine::parse("Creature Vedalken"),
            ManaCost::parse("3 U"),
            ColorSet::BLUE,
            Some(2),
            Some(5),
            vec![],
            vec![],
        );
        card.zone = forge_foundation::ZoneType::Battlefield;
        let card_id = game.create_card(card);
        game.add_card_to_zone(forge_foundation::ZoneType::Battlefield, player, card_id);

        let mut agents: Vec<Box<dyn PlayerAgent>> = vec![Box::new(SwapAgent), Box::new(SwapAgent)];
        let mut rolls = vec![
            DieRollResult {
                natural_value: 4,
                modified_value: 4,
            },
            DieRollResult {
                natural_value: 6,
                modified_value: 6,
            },
        ];
        let mut swaps = HashSet::new();
        swaps.insert(card_id);

        apply_dice_pt_exchanges(&mut agents, &mut game, player, &mut rolls, &swaps);

        assert_eq!(
            rolls
                .iter()
                .map(|roll| roll.modified_value)
                .collect::<Vec<_>>(),
            vec![2, 6]
        );
        assert_eq!(game.card(card_id).base_power, Some(4));
        assert_eq!(game.card(card_id).base_toughness, Some(5));
    }

    #[test]
    fn xenosquirrels_can_increase_roll_by_removing_counter() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let player = PlayerId(0);
        let mut card = Card::new(
            CardId(0),
            "Xenosquirrels".to_string(),
            player,
            CardTypeLine::parse("Creature Alien Squirrel"),
            ManaCost::parse("1 B"),
            ColorSet::BLACK,
            Some(0),
            Some(0),
            vec!["After you roll a die, you may remove a +1/+1 counter from Xenosquirrels. If you do, increase or decrease the result by 1.".to_string()],
            vec![],
        );
        card.set_s_var("RollModifyCost", "SubCounter<1/P1P1>");
        card.set_s_var("RollModificationsLimit", "None");
        card.set_s_var("ModsThisTurn", "Number$0");
        card.add_counter(&crate::card::CounterType::P1P1, 2);
        card.zone = forge_foundation::ZoneType::Battlefield;
        let card_id = game.create_card(card);
        game.add_card_to_zone(forge_foundation::ZoneType::Battlefield, player, card_id);

        let mut agents: Vec<Box<dyn PlayerAgent>> =
            vec![Box::new(ModifyAgent), Box::new(ModifyAgent)];
        let mut trigger_handler = TriggerHandler::new();
        let mut mana_pools = vec![ManaPool::default(), ManaPool::default()];
        let mut rolls = vec![4];

        let results = apply_simple_roll_modifiers(
            &mut game,
            &mut trigger_handler,
            &mut agents,
            &mut mana_pools,
            player,
            &mut rolls,
            None,
        );

        assert_eq!(
            results
                .iter()
                .map(|roll| roll.modified_value)
                .collect::<Vec<_>>(),
            vec![5]
        );
        assert_eq!(
            game.card(card_id)
                .counter_count(&crate::card::CounterType::P1P1),
            1
        );
        assert_eq!(
            game.card(card_id).svars.get("ModsThisTurn"),
            Some(&"Number$1".to_string())
        );
    }

    #[test]
    fn night_shift_can_increase_roll_by_paying_life() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let player = PlayerId(0);
        let mut card = Card::new(
            CardId(0),
            "Night Shift of the Living Dead".to_string(),
            player,
            CardTypeLine::parse("Creature Zombie Employee"),
            ManaCost::parse("2 B"),
            ColorSet::BLACK,
            Some(2),
            Some(3),
            vec!["After you roll a die, you may pay 1 life. If you do, increase or decrease the result by 1. Do this only once each turn.".to_string()],
            vec![],
        );
        card.set_s_var("RollModifyCost", "PayLife<1>");
        card.set_s_var("RollModificationsLimit", "1");
        card.set_s_var("ModsThisTurn", "Number$0");
        card.zone = forge_foundation::ZoneType::Battlefield;
        let card_id = game.create_card(card);
        game.add_card_to_zone(forge_foundation::ZoneType::Battlefield, player, card_id);

        let mut agents: Vec<Box<dyn PlayerAgent>> =
            vec![Box::new(ModifyAgent), Box::new(ModifyAgent)];
        let mut trigger_handler = TriggerHandler::new();
        let mut mana_pools = vec![ManaPool::default(), ManaPool::default()];
        let mut rolls = vec![3];

        let results = apply_simple_roll_modifiers(
            &mut game,
            &mut trigger_handler,
            &mut agents,
            &mut mana_pools,
            player,
            &mut rolls,
            None,
        );

        assert_eq!(
            results
                .iter()
                .map(|roll| roll.modified_value)
                .collect::<Vec<_>>(),
            vec![4]
        );
        assert_eq!(game.player(player).life, 19);
        assert_eq!(
            game.card(card_id).svars.get("ModsThisTurn"),
            Some(&"Number$1".to_string())
        );
    }

    #[test]
    fn monitor_monitor_can_pay_to_reroll() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let player = PlayerId(0);

        let mut source = Card::new(
            CardId(0),
            "Dice Source".to_string(),
            player,
            CardTypeLine::parse("Artifact"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec![],
        );
        source.zone = forge_foundation::ZoneType::Battlefield;
        let source_id = game.create_card(source);
        game.add_card_to_zone(forge_foundation::ZoneType::Battlefield, player, source_id);

        let mut monitor = Card::new(
            CardId(0),
            "Monitor Monitor".to_string(),
            player,
            CardTypeLine::parse("Creature Human Employee"),
            ManaCost::parse("2 U U"),
            ColorSet::BLUE,
            Some(2),
            Some(5),
            vec![
                "Once each turn, you may pay {1} to reroll one or more dice you rolled."
                    .to_string(),
            ],
            vec![],
        );
        monitor.set_s_var("RollModificationsLimit", "1");
        monitor.set_s_var("ModsThisTurn", "Number$0");
        monitor.set_s_var("RollRerollCost", "1");
        monitor.zone = forge_foundation::ZoneType::Battlefield;
        let monitor_id = game.create_card(monitor);
        game.add_card_to_zone(forge_foundation::ZoneType::Battlefield, player, monitor_id);

        let mut plains = Card::new(
            CardId(0),
            "Plains".to_string(),
            player,
            CardTypeLine::parse("Basic Land Plains"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec![],
        );
        plains.zone = forge_foundation::ZoneType::Battlefield;
        let plains_id = game.create_card(plains);
        game.add_card_to_zone(forge_foundation::ZoneType::Battlefield, player, plains_id);

        let sa = SpellAbility::new_empty(Some(source_id), player);
        let mut trigger_handler = TriggerHandler::new();
        let mut agents: Vec<Box<dyn PlayerAgent>> =
            vec![Box::new(RerollAgent), Box::new(RerollAgent)];
        let mut mana_pools = vec![ManaPool::default(), ManaPool::default()];
        let mut rng = FixedRng::new(&[0, 5]);
        let token_templates = HashMap::new();
        let templates_variants: HashMap<(String, String), usize> = HashMap::new();
        let token_fallback: HashMap<String, String> = HashMap::new();
        let edition_dates: HashMap<String, String> = HashMap::new();
        let mut ctx = EffectContext {
            game: &mut game,
            combat: None,
            agents: &mut agents,
            trigger_handler: &mut trigger_handler,
            token_templates: &token_templates,
            token_art_variants: &templates_variants,
            token_fallback: &token_fallback,
            edition_dates: &edition_dates,
            mana_pools: &mut mana_pools,
            parent_target_card: None,
            rng: &mut rng,
        };

        let result = roll_for_player(&mut ctx, &sa, source_id, player, 6, 1);

        assert_eq!(result, 6);
        assert_eq!(
            ctx.game.card(monitor_id).svars.get("ModsThisTurn"),
            Some(&"Number$1".to_string())
        );
        assert!(ctx.game.card(plains_id).tapped);
        assert_eq!(ctx.game.player(player).num_rolls_this_turn, 2);
    }

    #[test]
    fn ignore_lower_preserves_natural_result_for_trigger() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let player = PlayerId(0);
        let mut source = Card::new(
            CardId(0),
            "Dice Source".to_string(),
            player,
            CardTypeLine::parse("Artifact"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec![],
        );
        source.zone = forge_foundation::ZoneType::Battlefield;
        let source_id = game.create_card(source);
        game.add_card_to_zone(forge_foundation::ZoneType::Battlefield, player, source_id);

        let sa = SpellAbility::new_simple(
            Some(source_id),
            player,
            "DB$ Internal | IgnoreLower$ 1 | Modifier$ 2",
        );
        let mut trigger_handler = TriggerHandler::new();
        let mut agents: Vec<Box<dyn PlayerAgent>> =
            vec![Box::new(ModifyAgent), Box::new(ModifyAgent)];
        let mut mana_pools = vec![ManaPool::default(), ManaPool::default()];
        let mut rng = FixedRng::new(&[0, 4]);
        let token_templates = HashMap::new();
        let templates_variants: HashMap<(String, String), usize> = HashMap::new();
        let token_fallback: HashMap<String, String> = HashMap::new();
        let edition_dates: HashMap<String, String> = HashMap::new();
        let mut ctx = EffectContext {
            game: &mut game,
            combat: None,
            agents: &mut agents,
            trigger_handler: &mut trigger_handler,
            token_templates: &token_templates,
            token_art_variants: &templates_variants,
            token_fallback: &token_fallback,
            edition_dates: &edition_dates,
            mana_pools: &mut mana_pools,
            parent_target_card: None,
            rng: &mut rng,
        };

        let result = roll_for_player(&mut ctx, &sa, source_id, player, 6, 2);

        assert_eq!(result, 7);
        assert_eq!(ctx.game.player(player).num_rolls_this_turn, 2);
    }
}

pub fn visit_attractions(
    game: &mut GameState,
    trigger_handler: &mut TriggerHandler,
    player: PlayerId,
    light: i32,
) {
    if light <= 0 {
        return;
    }
    let attractions: Vec<_> = game
        .cards_in_zone(forge_foundation::ZoneType::Battlefield, player)
        .iter()
        .copied()
        .filter(|&card_id| {
            let card = game.card(card_id);
            card.type_line
                .subtypes
                .iter()
                .any(|s| s.eq_ignore_ascii_case("Attraction"))
                && card.has_attraction_light(light)
        })
        .collect();

    for card_id in attractions {
        let first_visit = !game.card(card_id).was_visited_this_turn();
        game.card_mut(card_id).visit_attraction();
        if first_visit {
            game.player_record_attraction_visit(player, 1);
        }
        trigger_handler.run_trigger(
            TriggerType::VisitAttraction,
            RunParams {
                card: Some(card_id),
                player: Some(player),
                ..Default::default()
            },
            false,
        );
    }
}

fn resolve_result_sub_ability(
    ctx: &mut EffectContext,
    _sa: &SpellAbility,
    source_id: crate::ids::CardId,
    player: PlayerId,
    result: i32,
    result_str: &str,
) {
    for entry in result_str.split(',') {
        let parts: Vec<&str> = entry.splitn(2, ':').collect();
        if parts.len() != 2 {
            continue;
        }
        let selector = parts[0].trim();
        let svar_name = parts[1].trim();
        let matches = if selector.eq_ignore_ascii_case("Else") {
            true
        } else if let Some((start, end)) = selector.split_once('-') {
            let low = start.trim().parse::<i32>().ok();
            let high = end.trim().parse::<i32>().ok();
            matches!(low.zip(high), Some((low, high)) if result >= low && result <= high)
        } else {
            selector
                .parse::<i32>()
                .ok()
                .map(|value| result == value)
                .unwrap_or(false)
        };
        if matches {
            if let Some(sub_text) = ctx
                .game
                .card(source_id)
                .get_s_var(svar_name)
                .map(str::to_string)
            {
                let mut sub_sa = build_spell_ability(ctx.game, source_id, &sub_text, player);
                sub_sa.activating_player = player;
                resolve_sub_chain(ctx, sub_sa);
            }
            break;
        }
    }
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
