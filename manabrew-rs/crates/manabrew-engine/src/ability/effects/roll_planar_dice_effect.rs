use super::EffectContext;
use crate::agent::notification::{GameNotification, PlanarDieFace};
use crate::agent::GameLogEvent;
use crate::event::RunParams;
use crate::replacement::replacement_handler::{apply_replacements, ReplacementEvent};
use crate::replacement::ReplacementResult;
use crate::trigger::TriggerType;

#[manabrew_engine_macros::spell_effect(RollPlanarDiceEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let Some(source_card_id) = sa.source else {
        return;
    };
    let player = sa.activating_player;
    let mut event = ReplacementEvent::RollPlanarDice {
        player,
        number: 1,
        ignore: 0,
    };
    let replacement = apply_replacements(ctx.game, &mut event);
    if matches!(
        replacement,
        ReplacementResult::Skipped | ReplacementResult::Replaced
    ) {
        return;
    }
    let ReplacementEvent::RollPlanarDice { number, ignore, .. } = event else {
        unreachable!()
    };

    let roll_start_number = ctx.game.player(player).num_rolls_this_turn;
    let mut results = Vec::new();
    for index in 0..number {
        let result = match ctx.rng.next_int(6) {
            0 => PlanarDieFace::Planeswalk,
            1 => PlanarDieFace::Chaos,
            _ => PlanarDieFace::Blank,
        };
        results.push(result);
        ctx.game.player_record_roll(player, None);
        ctx.trigger_handler.run_trigger(
            TriggerType::RolledDie,
            RunParams {
                player: Some(player),
                die_result: Some(0),
                natural_result: Some(0),
                die_sides: Some(6),
                number: Some(roll_start_number + index + 1),
                ..Default::default()
            },
            false,
        );
    }
    if results.is_empty() {
        return;
    }

    let mut ignored_results = Vec::new();
    for _ in 0..ignore.min(results.len().saturating_sub(1) as i32) {
        let choices = results
            .iter()
            .map(|result| planar_face_number(*result))
            .collect::<Vec<_>>();
        let chosen = ctx.agents[player.index()]
            .choose_number_from_list(
                player,
                &choices,
                "Choose a planar die result to ignore",
                Some(source_card_id),
            )
            .unwrap_or(choices[0]);
        let index = choices
            .iter()
            .position(|value| *value == chosen)
            .unwrap_or(0);
        ignored_results.push(results.remove(index));
    }

    let mut final_result = results[0];
    let mut result_event = ReplacementEvent::PlanarDiceResult {
        player,
        result: final_result,
    };
    let replacement = apply_replacements(ctx.game, &mut result_event);
    if matches!(
        replacement,
        ReplacementResult::Skipped | ReplacementResult::Replaced
    ) {
        return;
    }
    if let ReplacementEvent::PlanarDiceResult { result, .. } = result_event {
        final_result = result;
        results[0] = result;
    }

    let result_name = planar_face_name(final_result);
    ctx.trigger_handler.run_trigger(
        TriggerType::PlanarDice,
        RunParams {
            player: Some(player),
            mode: Some(result_name.to_string()),
            ..Default::default()
        },
        false,
    );
    ctx.trigger_handler.run_trigger(
        TriggerType::RolledDieOnce,
        RunParams {
            player: Some(player),
            die_result: Some(0),
            die_results: Some(vec![0]),
            die_sides: Some(6),
            ..Default::default()
        },
        false,
    );
    if final_result == PlanarDieFace::Chaos {
        ctx.trigger_handler.run_trigger(
            TriggerType::ChaosEnsues,
            RunParams {
                player: Some(player),
                ..Default::default()
            },
            false,
        );
    }

    let source_card_name = ctx.game.card(source_card_id).card_name.clone();
    crate::agent::notify_all_agents(
        ctx.agents,
        GameLogEvent::rule(format!("Planar die: {result_name}")).with_player(player),
    );
    let final_results = results
        .into_iter()
        .map(planar_face_number)
        .collect::<Vec<_>>();
    crate::agent::game_log::broadcast_notification(
        ctx.agents,
        GameNotification::DiceRolled {
            player,
            sides: 3,
            natural_results: final_results.clone(),
            final_results,
            ignored_rolls: ignored_results
                .into_iter()
                .map(planar_face_number)
                .collect(),
            source_card_id: Some(source_card_id),
            source_card_name: Some(source_card_name),
        },
    );
    for agent in ctx.agents.iter_mut() {
        agent.await_display_ack();
    }
}

fn planar_face_number(result: PlanarDieFace) -> i32 {
    match result {
        PlanarDieFace::Planeswalk => 1,
        PlanarDieFace::Chaos => 2,
        PlanarDieFace::Blank => 3,
    }
}

fn planar_face_name(result: PlanarDieFace) -> &'static str {
    match result {
        PlanarDieFace::Planeswalk => "Planeswalk",
        PlanarDieFace::Chaos => "Chaos",
        PlanarDieFace::Blank => "Blank",
    }
}
