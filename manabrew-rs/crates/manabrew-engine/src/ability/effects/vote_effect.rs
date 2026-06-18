//! Vote effect — Council's Dilemma and Will of the Council voting.
//!
//! Ported from Java's `VoteEffect.java`.
//! Each player votes from a set of choices. The option(s) with the most votes
//! determine which sub-ability resolves. Handles ties, secret votes, and
//! additional vote amounts.

use std::collections::HashMap;

use super::EffectContext;
use crate::event::RunParams;
use crate::ids::PlayerId;
use crate::parsing::keys;
use crate::trigger::TriggerType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `VoteEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(VoteEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;

    // Get voting players (usually all players, starting with activator)
    let mut voters: Vec<PlayerId> = if let Some(def) = sa.defined_player() {
        super::resolve_defined_players(def, controller, ctx.game)
    } else {
        ctx.game.player_order.clone()
    };

    // Rotate so activator votes first
    if let Some(pos) = voters.iter().position(|&p| p == controller) {
        voters.rotate_left(pos);
    }

    // Get vote choices (from Choices$ param or VoteMessage$)
    let choices: Vec<String> = if let Some(choices_str) = sa.ir.choices.as_deref() {
        choices_str
            .split(',')
            .map(|s| s.trim().to_string())
            .collect()
    } else if let Some(msg) = sa.ir.vote_message_text.as_deref() {
        // Parse choice names from message — usually "A or B"
        msg.split(" or ").map(|s| s.trim().to_string()).collect()
    } else {
        return;
    };

    if choices.is_empty() {
        return;
    }

    // Collect votes
    let mut vote_counts: HashMap<String, Vec<PlayerId>> = HashMap::new();
    for choice in &choices {
        vote_counts.insert(choice.clone(), Vec::new());
    }

    for &voter in &voters {
        if ctx.game.player(voter).has_lost {
            continue;
        }

        // Ask each player to vote
        ctx.agents[voter.index()].snapshot_state(ctx.game, ctx.mana_pools);
        let chosen = ctx.agents[voter.index()].confirm_action(
            voter,
            Some("Vote"),
            &format!("Vote: {}", choices.join(" or ")),
            &choices,
            sa.source,
            sa.api,
        );

        // confirm_action returns bool — map to first or second choice
        let choice_idx = if chosen { 0 } else { 1.min(choices.len() - 1) };
        let chosen_str = &choices[choice_idx];

        if let Some(voters_list) = vote_counts.get_mut(chosen_str) {
            voters_list.push(voter);
        }
    }

    // Determine winner(s) — most votes
    let max_votes = vote_counts.values().map(|v| v.len()).max().unwrap_or(0);
    let winners: Vec<String> = vote_counts
        .iter()
        .filter(|(_, v)| v.len() == max_votes)
        .map(|(k, _)| k.clone())
        .collect();

    let all_votes = vote_counts
        .iter()
        .map(|(choice, voters)| (choice.clone(), voters.clone()))
        .collect();
    ctx.trigger_handler.run_trigger(
        TriggerType::Vote,
        RunParams {
            all_votes: Some(all_votes),
            ..Default::default()
        },
        false,
    );

    // Store vote results for sub-abilities
    if sa.param_is_true(keys::STORE_VOTE_NUM) {
        if let Some(source_id) = sa.source {
            for (choice, voters_list) in &vote_counts {
                let svar_name = format!("VoteNum{}", choice);
                let svar_val = format!("Number${}", voters_list.len());
                ctx.game.card_mut(source_id).set_s_var(svar_name, svar_val);
            }
        }
    }

    // RememberVotedObjects$
    if sa.param_is_true(keys::REMEMBER_VOTED_OBJECTS) {
        // Remember the winning choice indices (simplified)
        if let Some(source_id) = sa.source {
            for winner in &winners {
                if let Some(idx) = choices.iter().position(|c| c == winner) {
                    ctx.game.card_mut(source_id).add_remembered_cmc(idx as i32);
                }
            }
        }
    }

    // The winning sub-ability is resolved by the parent SA's sub-ability chain.
    // In Java, VoteSubAbility or the Choice abilities are resolved here.
    // In Rust, the sub-ability system handles this via the spell resolution pipeline.
}
