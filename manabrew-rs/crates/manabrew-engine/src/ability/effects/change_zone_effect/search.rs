//! Search sub-routines for hidden-origin zone changes.
//!
//! Handles single/multi/each/random card selection and player choice.

use forge_foundation::ZoneType;

use super::super::{resolve_defined_players_with_sa, EffectContext};
use super::helpers::{get_land_subtypes, matches_with_context};
use crate::ids::{CardId, PlayerId};
use crate::spellability::SpellAbility;

/// EACH clause search: one card per clause separated by "&".
pub(super) fn resolve_each_search(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    each_spec: &str,
    zone_cards: &mut Vec<CardId>,
    chooser: PlayerId,
    _is_optional: bool,
) -> Vec<CardId> {
    let mut out = Vec::new();
    for clause in each_spec
        .split('&')
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let selector = crate::parsing::CompiledSelector::parse(clause);
        let candidates: Vec<_> = zone_cards
            .iter()
            .copied()
            .filter(|&cid| matches_with_context(ctx, sa, cid, Some(&selector)))
            .collect();
        if candidates.is_empty() {
            continue;
        }
        // Java always routes through chooseSingleCardForZoneChange, even for
        // a single candidate, so do not short-circuit here.
        ctx.agents[chooser.index()].snapshot_state(ctx.game, ctx.mana_pools);
        let chosen = ctx.agents[chooser.index()].choose_single_card_for_zone_change(
            ctx.game,
            chooser,
            &candidates,
            sa.select_prompt().unwrap_or("Select card for zone change"),
            false,
        );
        if let Some(id) = chosen {
            out.push(id);
            zone_cards.retain(|&cid| cid != id);
        }
    }
    out
}

pub(super) fn resolve_single_search(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    candidates: &[CardId],
    chooser: PlayerId,
    is_optional: bool,
) -> Vec<CardId> {
    // Mirrors Java `ChangeZoneEffect.changeZonePlayerInvariant` lines 1208-1221:
    // the chooser is called even when fetchList is empty so the callback is
    // emitted (returning null). The cancel-prompt is then skipped when the
    // candidate list is empty (Java line 1215 `fetchList.isEmpty()` short).
    ctx.agents[chooser.index()].snapshot_state(ctx.game, ctx.mana_pools);
    let chosen = ctx.agents[chooser.index()]
        .choose_single_card_for_zone_change(
            ctx.game,
            chooser,
            candidates,
            sa.select_prompt().unwrap_or("Select card for zone change"),
            is_optional,
        )
        .into_iter()
        .collect::<Vec<_>>();
    if !chosen.is_empty() {
        return chosen;
    }

    if !sa.ir.skip_cancel_prompt && !candidates.is_empty() {
        let source_name = sa.source.map(|cid| ctx.game.card(cid).card_name.as_str());
        ctx.agents[chooser.index()].snapshot_state(ctx.game, ctx.mana_pools);
        let _ = ctx.agents[chooser.index()].confirm_action(
            chooser,
            Some("ChangeZoneGeneral"),
            "Cancel search and select up to 1 cards?",
            &[],
            sa.source,
            Some(crate::ability::api_type::ApiType::ChangeZone),
        );
    }
    Vec::new()
}

/// Multi-card search with DifferentNames/CMC/Power, ShareLandType, and budget constraints.
pub(super) fn resolve_multi_search(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    candidates: &[CardId],
    chooser: PlayerId,
    change_num: usize,
    _is_optional: bool,
) -> Vec<CardId> {
    let max = change_num.min(candidates.len());
    if max == 0 {
        return Vec::new();
    }

    let diff_names = sa.ir.different_names;
    let diff_cmc = sa.ir.different_cmc;
    let diff_power = sa.ir.different_power;
    let share_land = sa.ir.share_land_type;
    let budget_cmc = sa.ir.with_total_cmc;
    let budget_power = sa.ir.with_total_power;

    if diff_names
        || diff_cmc
        || diff_power
        || share_land
        || budget_cmc.is_some()
        || budget_power.is_some()
    {
        return resolve_constrained_multi(
            ctx,
            sa,
            candidates,
            chooser,
            max,
            diff_names,
            diff_cmc,
            diff_power,
            share_land,
            budget_cmc,
            budget_power,
        );
    }

    // Standard multi-select — iterative single-card selection to match Java's
    // DeterministicCostDecision flow which asks one card at a time.
    let mut selected = Vec::new();
    let mut remaining: Vec<CardId> = candidates.to_vec();
    for _ in 0..max {
        if remaining.is_empty() {
            break;
        }
        ctx.agents[chooser.index()].snapshot_state(ctx.game, ctx.mana_pools);
        let Some(chosen) = ctx.agents[chooser.index()].choose_single_card_for_zone_change(
            ctx.game,
            chooser,
            &remaining,
            sa.select_prompt().unwrap_or("Select card for zone change"),
            _is_optional,
        ) else {
            break;
        };
        selected.push(chosen);
        remaining.retain(|&cid| cid != chosen);
    }
    selected
}

/// Iterative constrained multi-card selection.
fn resolve_constrained_multi(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    candidates: &[CardId],
    chooser: PlayerId,
    max: usize,
    diff_names: bool,
    diff_cmc: bool,
    diff_power: bool,
    share_land: bool,
    budget_cmc: Option<i32>,
    budget_power: Option<i32>,
) -> Vec<CardId> {
    let mut selected = Vec::new();
    let mut remaining: Vec<CardId> = candidates.to_vec();
    let mut spent_cmc: i32 = 0;
    let mut spent_power: i32 = 0;
    let mut required_land_types: Vec<String> = Vec::new();

    for _ in 0..max {
        // Apply budget filters
        if let Some(b) = budget_cmc {
            remaining.retain(|&cid| ctx.game.card(cid).mana_cost.cmc() + spent_cmc <= b);
        }
        if let Some(b) = budget_power {
            remaining.retain(|&cid| ctx.game.card(cid).base_power.unwrap_or(0) + spent_power <= b);
        }
        if remaining.is_empty() {
            break;
        }

        ctx.agents[chooser.index()].snapshot_state(ctx.game, ctx.mana_pools);
        let Some(chosen) = ctx.agents[chooser.index()].choose_single_card_for_zone_change(
            ctx.game,
            chooser,
            &remaining,
            sa.select_prompt().unwrap_or("Select card for zone change"),
            true,
        ) else {
            break;
        };

        let card = ctx.game.card(chosen);
        let name = card.card_name.clone();
        let cmc = card.mana_cost.cmc();
        let power = card.base_power.unwrap_or(0);
        let land_types = get_land_subtypes(&card.type_line.subtypes);

        if share_land && required_land_types.is_empty() {
            required_land_types = land_types;
        }

        spent_cmc += cmc;
        spent_power += power;
        selected.push(chosen);

        remaining.retain(|&cid| {
            let c = ctx.game.card(cid);
            cid != chosen
                && (!diff_names || c.card_name != name)
                && (!diff_cmc || c.mana_cost.cmc() != cmc)
                && (!diff_power || c.base_power.unwrap_or(0) != power)
                && (!share_land
                    || required_land_types.is_empty()
                    || get_land_subtypes(&c.type_line.subtypes)
                        .iter()
                        .any(|lt| required_land_types.contains(lt)))
        });
    }
    selected
}

/// Random selection (AtRandom$).
pub(super) fn resolve_random_selection(
    ctx: &mut EffectContext,
    candidates: &[CardId],
    count: usize,
) -> Vec<CardId> {
    let mut pool = candidates.to_vec();
    ctx.rng.shuffle_cards(&mut pool);
    pool.truncate(count);
    pool
}

pub(super) fn resolve_defined_players_for_hidden_origin(
    ctx: &EffectContext,
    sa: &SpellAbility,
) -> Vec<PlayerId> {
    let controller = sa.activating_player;
    let def = sa.defined_player().unwrap_or("");
    if def.eq_ignore_ascii_case("Player") {
        (0..ctx.game.players.len())
            .map(|i| PlayerId(i as u32))
            .collect()
    } else if def.eq_ignore_ascii_case("You") {
        vec![controller]
    } else if def.eq_ignore_ascii_case("Opponent") {
        vec![ctx.game.opponent_of(controller)]
    } else {
        let players = resolve_defined_players_with_sa(def, sa, controller, ctx.game);
        if players.is_empty() {
            vec![controller]
        } else {
            players
        }
    }
}

pub(super) fn resolve_defined_player_cards(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    origin_zone: ZoneType,
    pid: PlayerId,
) -> Vec<CardId> {
    let candidates: Vec<_> = ctx
        .game
        .cards_in_zone(origin_zone, pid)
        .to_vec()
        .into_iter()
        .filter(|&cid| matches_with_context(ctx, sa, cid, sa.change_type_selector()))
        .collect();
    if candidates.is_empty() {
        return Vec::new();
    }
    if candidates.len() == 1 {
        return vec![candidates[0]];
    }
    ctx.agents[pid.index()].snapshot_state(ctx.game, ctx.mana_pools);
    ctx.agents[pid.index()]
        .choose_single_card_for_zone_change(
            ctx.game,
            pid,
            &candidates,
            "Select card for zone change",
            false,
        )
        .into_iter()
        .collect()
}

/// DefinedPlayer$ choice: each player chooses a card from their zone.
pub(super) fn resolve_defined_player_choice(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    origin_zone: ZoneType,
) -> Vec<CardId> {
    let mut collected = Vec::new();
    for pid in resolve_defined_players_for_hidden_origin(ctx, sa) {
        collected.extend(resolve_defined_player_cards(ctx, sa, origin_zone, pid));
    }
    collected
}
