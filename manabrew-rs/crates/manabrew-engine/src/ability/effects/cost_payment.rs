//! Cost-payment helpers used by effect resolution.
//!
//! Mirrors Java's `CostPayment` + `AbilityUtils.handleUnlessCost` +
//! `DeterministicCostPlumbing` for the subset of costs that effects can ask
//! players to pay during resolution (UnlessCost, cumulative upkeep, etc.).

use forge_foundation::ZoneType;

use crate::cost::{parse_cost, Cost, CostPart};
use crate::event::RunParams;
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::spellability::SpellAbility;
use crate::trigger::handler::TriggerHandler;
use crate::trigger::TriggerType;

use super::effect_context::EffectContext;
use super::effect_resolver::resolve_effect;
use super::zone_triggers::emit_zone_trigger;

pub(super) fn resolve_mana_ability_for_effect_payment(
    ctx: &mut EffectContext,
    player: PlayerId,
    card_id: CardId,
    ab: &crate::ability::activated::ActivatedAbility,
    express_choice: Option<u16>,
) {
    if ab
        .cost
        .parts
        .iter()
        .any(|part| matches!(part, CostPart::Tap))
    {
        let was_tapped = ctx.game.card(card_id).tapped;
        ctx.game.tap(card_id);
        if !was_tapped {
            ctx.trigger_handler.run_trigger(
                TriggerType::Taps,
                RunParams {
                    card: Some(card_id),
                    player: Some(player),
                    ..Default::default()
                },
                false,
            );
        }
    }

    let source_is_snow = ctx.game.card(card_id).type_line.is_snow();
    let mana_params = crate::mana::ManaProductionParams {
        source_card: card_id,
        is_snow: source_is_snow,
        restriction: ab.restrict_valid.as_deref().map(str::to_string),
        adds_no_counter: ab.adds_no_counter,
        adds_keywords: ab.adds_keywords.clone(),
        adds_keywords_valid: ab.adds_keywords_valid.clone(),
        adds_counters: ab.adds_counters.clone(),
        adds_counters_valid: ab.adds_counters_valid.clone(),
        triggers_when_spent: ab.triggers_when_spent.clone(),
    };

    if let Some(produced_ir) = ab.produced_ir.as_ref() {
        let amount_param = ab.amount.as_deref();
        let produced = produced_ir.as_script_text();
        let mana_string = crate::mana::determine_mana_production_ir(
            ctx.game,
            ctx.agents,
            player,
            card_id,
            produced_ir,
            &produced,
            amount_param,
            express_choice,
        );
        if let Some(ref ms) = mana_string {
            crate::mana::add_produced_mana_to_pool(
                &mut ctx.mana_pools[player.index()],
                ms,
                &mana_params,
            );
        }
    }

    if let Some(sub_svar_name) = ab.sub_ability.as_deref() {
        if let Some(sub_text) = ctx
            .game
            .card(card_id)
            .get_s_var(sub_svar_name)
            .map(str::to_string)
        {
            let sub_sa =
                crate::spellability::build_spell_ability(ctx.game, card_id, &sub_text, player);
            resolve_effect(ctx, &sub_sa);
        }
    }

    ctx.trigger_handler.run_trigger(
        TriggerType::TapsForMana,
        RunParams {
            card: Some(card_id),
            player: Some(player),
            activator: Some(player),
            ..Default::default()
        },
        false,
    );
    ctx.trigger_handler.run_trigger(
        TriggerType::ManaAdded,
        RunParams {
            card: Some(card_id),
            player: Some(player),
            activator: Some(player),
            ..Default::default()
        },
        false,
    );

    let pending = ctx.trigger_handler.run_waiting_triggers(ctx.game);
    for pt in pending {
        resolve_effect(ctx, &pt.entry.spell_ability);
    }
}

/// Pre-flight feasibility check on a cloned game/pool: can this cost
/// actually be auto-paid? Returns true even when the real session would
/// involve player choices (the auto-pay path is a sound lower bound on
/// "is the cost possible at all").
///
/// Without this gate the real session at the call site below begins
/// payment against the live state, and a cost that turns out to be
/// unpayable can leave partial mutations behind (tapped lands, drained
/// pool, fired triggers) when it aborts mid-way. Cloning + dry-running
/// here is the cheapest way to guarantee atomicity without rewriting
/// the session to be transactional. No agent-kind branching: the
/// check applies uniformly to humans and AI.
fn can_auto_pay_mana_cost_for_effect(
    ctx: &EffectContext,
    payer: PlayerId,
    source: CardId,
    mana_cost: &forge_foundation::ManaCost,
) -> bool {
    let mut game = ctx.game.clone();
    let mut pool = ctx.mana_pools[payer.index()].clone();
    crate::mana::pay_mana_cost_auto(
        &mut game,
        &mut pool,
        payer,
        mana_cost,
        Some(source),
        0,
        &crate::mana::ManaPaymentContext::default(),
        false,
    )
    .is_some()
}

fn pay_mana_cost_for_effect(
    ctx: &mut EffectContext,
    payer: PlayerId,
    source: CardId,
    mana_cost: &forge_foundation::ManaCost,
) -> bool {
    let ctx_ptr: *mut EffectContext<'_> = ctx;
    let card_name = ctx.game.card(source).card_name.clone();
    let cost_str = mana_cost.to_string();
    let payable_mana_cost =
        crate::mana::apply_player_life_payment_keywords(ctx.game, payer, mana_cost);

    if !can_auto_pay_mana_cost_for_effect(ctx, payer, source, &payable_mana_cost) {
        return false;
    }

    crate::game_loop::mana_payment::pay_mana_cost_session_generic(
        ctx.game,
        ctx.agents,
        ctx.mana_pools,
        crate::game_loop::mana_payment::ManaPaymentSession {
            player: payer,
            card_id: source,
            card_name: &card_name,
            mana_cost: &payable_mana_cost,
            cost_str: &cost_str,
            cost_display_str: &cost_str,
            cost_checkpoint_str: &cost_str,
            is_activated_ability: false,
            reserved_sacrifices: &[],
        },
        |game, player, cid, ab, _reserved| {
            crate::game_loop::GameLoop::mana_source_available_for_payment(game, player, cid)
                && crate::cost::can_pay_ignoring_mana(&ab.cost, game, cid, player)
        },
        |game, agents, mana_pools, session| unsafe {
            let ctx = &mut *ctx_ptr;
            let saved_game = game.clone();
            let saved_pool = mana_pools[session.player.index()].clone();
            let payment_ctx = crate::mana::ManaPaymentContext::default();
            let auto_result = {
                let game_ptr: *mut GameState = game;
                let trigger_handler_ptr: *mut TriggerHandler = ctx.trigger_handler;
                let mut callback = crate::game_loop::GameLoop::make_mana_payment_callback(
                    trigger_handler_ptr,
                    game_ptr,
                    agents,
                    session.player,
                    session.card_id,
                );
                crate::mana::pay_mana_cost_auto_with_callback(
                    game,
                    &mut mana_pools[session.player.index()],
                    session.player,
                    session.mana_cost,
                    Some(session.card_id),
                    0,
                    &payment_ctx,
                    false,
                    &mut callback,
                )
            };

            let Some(result) = auto_result.filter(|r| !r.cancelled) else {
                *game = saved_game;
                mana_pools[session.player.index()] = saved_pool;
                return None;
            };

            if result.life_paid > 0 {
                game.player_lose_life(session.player, result.life_paid);
                ctx.trigger_handler.run_trigger(
                    TriggerType::LifeLost,
                    RunParams {
                        player: Some(session.player),
                        life_amount: Some(result.life_paid),
                        ..Default::default()
                    },
                    false,
                );
            }

            Some(
                result
                    .choices
                    .iter()
                    .map(|choice| crate::agent::ManaCostAction::TapLand {
                        card_id: choice.card_id,
                        mana_ability_index: Some(choice.mana_ability_index.unwrap_or(0)),
                        express_choice: choice.mana_ability_index.map(|_| choice.chosen_atom),
                    })
                    .chain(std::iter::once(crate::agent::ManaCostAction::Pay {
                        auto: false,
                    }))
                    .collect(),
            )
        },
        |game, mana_pools, player| unsafe {
            let ctx = &mut *ctx_ptr;
            let mut test_pool = mana_pools[player.index()].clone();
            if let Some(test_life_to_pay) = test_pool.try_pay_cost_with_phyrexian_life(
                &payable_mana_cost,
                false,
                game.player(player).life,
            ) {
                let life_to_pay = mana_pools[player.index()]
                    .try_pay_cost_with_phyrexian_life(
                        &payable_mana_cost,
                        false,
                        game.player(player).life,
                    )
                    .expect("tested phyrexian payment should still be legal");
                if life_to_pay != test_life_to_pay {
                    return false;
                }
                if life_to_pay > 0 {
                    game.player_lose_life(player, life_to_pay);
                    ctx.trigger_handler.run_trigger(
                        TriggerType::LifeLost,
                        RunParams {
                            player: Some(player),
                            life_amount: Some(life_to_pay),
                            ..Default::default()
                        },
                        false,
                    );
                }
                true
            } else {
                false
            }
        },
        |_game, _agents, _mana_pools, player, card_id, ab, express_choice| unsafe {
            let ctx = &mut *ctx_ptr;
            resolve_mana_ability_for_effect_payment(ctx, player, card_id, ab, express_choice);
            true
        },
        |_game, player, land_id| unsafe {
            let ctx = &mut *ctx_ptr;
            ctx.trigger_handler.run_trigger(
                TriggerType::TapsForMana,
                RunParams {
                    card: Some(land_id),
                    player: Some(player),
                    activator: Some(player),
                    ..Default::default()
                },
                false,
            );
            ctx.trigger_handler.run_trigger(
                TriggerType::ManaAdded,
                RunParams {
                    card: Some(land_id),
                    player: Some(player),
                    activator: Some(player),
                    ..Default::default()
                },
                false,
            );
            let pending = ctx.trigger_handler.run_waiting_triggers(ctx.game);
            for pt in pending {
                resolve_effect(ctx, &pt.entry.spell_ability);
            }
        },
        |_game, _mana_pools, _player| Vec::new(),
        |_game, _mana_pools, _player, _card_id| (),
        |_game, _mana_pools, _record, _produced_count| {},
        |_game, _mana_pools, _player, _card_id| false,
    )
    .paid
}

#[derive(Clone, Copy)]
enum EffectCostPaymentMode {
    Unless { spell_context: bool },
    CumulativeUpkeep,
    Echo,
}

fn should_confirm_effect_cost_part(mode: EffectCostPaymentMode, part: &CostPart) -> bool {
    match mode {
        EffectCostPaymentMode::Unless { spell_context } => {
            if spell_context {
                return false;
            }
            match part {
                CostPart::DamageYou(_) => true,
                CostPart::PayLife(_) => true,
                CostPart::Draw(_) => true,
                CostPart::Mill(_) => true,
                CostPart::AddMana { .. } => true,
                CostPart::Discard { type_filter, .. } => type_filter.eq_ignore_ascii_case("Hand"),
                // Java parity: DeterministicCostPlumbing.visit(CostSacrifice) sets
                //   shouldAsk = (payCostFromSource && !mandatory) || "OriginalHost"
                // payCostFromSource ↔ type_filter == "CARDNAME". Arbitrary type
                // filters (e.g. Permanent.nonLand for Rottenmouth Viper's
                // UnlessCost) skip the confirm prompt and go straight to the
                // sacrifice picker.
                CostPart::Sacrifice { type_filter, .. } => {
                    type_filter.eq_ignore_ascii_case("CARDNAME")
                        || type_filter.eq_ignore_ascii_case("OriginalHost")
                }
                _ => false,
            }
        }
        EffectCostPaymentMode::CumulativeUpkeep | EffectCostPaymentMode::Echo => matches!(
            part,
            CostPart::DamageYou(_)
                | CostPart::PayLife(_)
                | CostPart::Draw(_)
                | CostPart::Mill(_)
                | CostPart::AddMana { .. }
                | CostPart::FlipCoin(_)
        ),
    }
}

fn try_pay_effect_cost(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    source: CardId,
    payer: PlayerId,
    cost: &Cost,
    mode: EffectCostPaymentMode,
) -> bool {
    let available_mana =
        crate::mana::calculate_available_mana(&ctx.mana_pools[payer.index()], ctx.game, payer);
    if !crate::cost::can_pay_with_ability(cost, ctx.game, &available_mana, source, payer, Some(sa))
    {
        return false;
    }

    for part in &cost.parts {
        if !matches!(
            part,
            CostPart::FlipCoin(_)
                | CostPart::DamageYou(_)
                | CostPart::PayLife(_)
                | CostPart::Mana { .. }
                | CostPart::PayEnergy(_)
                | CostPart::PayShards(_)
                | CostPart::Draw(_)
                | CostPart::Mill(_)
                | CostPart::Discard { .. }
                | CostPart::Sacrifice { .. }
                | CostPart::AddCounter { .. }
                | CostPart::AddMana { .. }
        ) {
            return false;
        }
    }

    for part in &cost.parts {
        if should_confirm_effect_cost_part(mode, part) {
            let card_name = sa.source.map(|cid| ctx.game.card(cid).card_name.clone());
            let kind = effect_cost_part_kind(part);
            let message = format!(
                "Pay {} cost for {}?",
                kind,
                card_name.as_deref().unwrap_or("unknown")
            );
            if !ctx.agents[payer.index()].confirm_payment(payer, kind, &message, sa.source, sa.api)
            {
                return false;
            }
        }
    }

    for part in &cost.parts {
        match part {
            CostPart::FlipCoin(amount) => {
                let resolved_amount = amount.resolve(ctx.game, source, payer);
                for _ in 0..resolved_amount {
                    let called_heads = ctx.agents[payer.index()].choose_binary(
                        payer,
                        "Call the coin flip",
                        crate::agent::BinaryChoiceKind::HeadsOrTails,
                        None,
                        Some(source),
                        None,
                    );
                    let is_heads = ctx.rng.next_int(2) == 0;
                    let won = called_heads == is_heads;
                    ctx.trigger_handler.run_trigger(
                        TriggerType::FlippedCoin,
                        RunParams {
                            player: Some(payer),
                            coin_flip_won: Some(won),
                            ..Default::default()
                        },
                        false,
                    );
                }
            }
            CostPart::DamageYou(amount) => {
                ctx.game
                    .deal_damage_to_player(payer, amount.resolve(ctx.game, source, payer));
                ctx.trigger_handler.run_trigger(
                    TriggerType::DamageDone,
                    RunParams {
                        damage_target_player: Some(payer),
                        damage_amount: Some(amount.resolve(ctx.game, source, payer)),
                        is_combat_damage: Some(false),
                        ..Default::default()
                    },
                    false,
                );
            }
            CostPart::PayLife(amount) => {
                ctx.game
                    .player_lose_life(payer, amount.resolve(ctx.game, source, payer));
                ctx.trigger_handler.run_trigger(
                    TriggerType::LifeLost,
                    RunParams {
                        player: Some(payer),
                        life_amount: Some(amount.resolve(ctx.game, source, payer)),
                        ..Default::default()
                    },
                    false,
                );
            }
            CostPart::Mana {
                cost: mana_cost, ..
            } => {
                if !pay_mana_cost_for_effect(ctx, payer, source, mana_cost) {
                    return false;
                }
            }
            CostPart::PayEnergy(amount) => {
                ctx.game
                    .player_add_energy(payer, -amount.resolve(ctx.game, source, payer));
            }
            CostPart::PayShards(amount) => {
                ctx.game
                    .player_add_shards(payer, -amount.resolve(ctx.game, source, payer));
            }
            CostPart::Draw(amount) => {
                for _ in 0..amount.resolve(ctx.game, source, payer) {
                    ctx.game.draw_card(payer);
                }
            }
            CostPart::Mill(amount) => {
                for _ in 0..amount.resolve(ctx.game, source, payer) {
                    if let Some(top) = ctx.game.take_top_card_from_zone(ZoneType::Library, payer) {
                        ctx.move_card(top, ZoneType::Graveyard, payer);
                        ctx.trigger_handler.run_trigger(
                            TriggerType::Milled,
                            RunParams {
                                card: Some(top),
                                player: Some(payer),
                                ..Default::default()
                            },
                            false,
                        );
                        emit_zone_trigger(
                            ctx.trigger_handler,
                            top,
                            ZoneType::Library,
                            ZoneType::Graveyard,
                        );
                    }
                }
            }
            CostPart::AddCounter {
                amount,
                counter_type,
            } => {
                let amount_n = amount.resolve(ctx.game, source, payer);
                ctx.game
                    .card_mut(source)
                    .add_counter(counter_type, amount_n);
            }
            CostPart::Discard {
                amount,
                type_filter,
            } => {
                if type_filter == "Hand" {
                    let hand = ctx.game.cards_in_zone(ZoneType::Hand, payer).to_vec();
                    for cid in hand {
                        ctx.game.discard_card(
                            cid,
                            payer,
                            Some(sa),
                            Some(ctx.agents),
                            ctx.trigger_handler,
                        );
                    }
                    continue;
                }
                for _ in 0..amount.resolve(ctx.game, source, payer) {
                    let valid: Vec<CardId> = ctx
                        .game
                        .cards_in_zone(ZoneType::Hand, payer)
                        .to_vec()
                        .into_iter()
                        .filter(|&cid| {
                            if type_filter == "Card" || type_filter.is_empty() {
                                true
                            } else {
                                crate::ability::effects::helpers::matches_change_type(
                                    ctx.game.card(cid),
                                    type_filter,
                                    &[],
                                )
                            }
                        })
                        .collect();
                    if valid.is_empty() {
                        return false;
                    }
                    let chosen =
                        ctx.agents[payer.index()].choose_cards_for_effect(payer, &valid, 1, 1);
                    if let Some(&cid) = chosen.first() {
                        ctx.game.discard_card(
                            cid,
                            payer,
                            Some(sa),
                            Some(ctx.agents),
                            ctx.trigger_handler,
                        );
                    }
                }
            }
            CostPart::Sacrifice {
                amount,
                type_filter,
            } => {
                for _ in 0..amount.resolve(ctx.game, source, payer) {
                    let valid = crate::cost::get_sacrifice_targets_for_cost(
                        ctx.game,
                        payer,
                        type_filter,
                        Some(sa),
                    );
                    if valid.is_empty() {
                        return false;
                    }
                    if let Some(chosen) =
                        ctx.agents[payer.index()].choose_sacrifice(payer, &valid, sa.source)
                    {
                        let owner = ctx.game.card(chosen).owner;
                        ctx.trigger_handler.run_trigger(
                            TriggerType::Sacrificed,
                            RunParams {
                                card: Some(chosen),
                                player: Some(payer),
                                ..Default::default()
                            },
                            false,
                        );
                        ctx.move_card(chosen, ZoneType::Graveyard, owner);
                        emit_zone_trigger(
                            ctx.trigger_handler,
                            chosen,
                            ZoneType::Battlefield,
                            ZoneType::Graveyard,
                        );
                    }
                }
            }
            CostPart::AddMana { .. } => {}
            _ => return false,
        }
    }

    true
}

/// Build an `UnlessCost` into a concrete `Cost` at resolution time.
/// Mirrors Java `AbilityUtils.calculateUnlessCost`.
///
/// Supported forms:
/// - `ChosenNumber` — numeric cost equal to the host's `chosen_number`
/// - `DefinedCost_<Defined>` — generic mana cost equal to the CMC of the
///   first card the `Defined$` expression resolves to (`_MinusN` / `_PlusN`
///   suffix adjusts the amount)
/// - literal cost string — passed through `parse_cost`
///
/// Returns `None` when a `DefinedCost_*` reference resolves to nothing (Java
/// returns `null`, which short-circuits the unless-cost branch).
fn calculate_unless_cost(game: &GameState, sa: &SpellAbility, unless_cost: &str) -> Option<Cost> {
    if unless_cost == "ChosenNumber" {
        let n = sa
            .source
            .map(|cid| game.card(cid).chosen_number.unwrap_or(0))
            .unwrap_or(0);
        return Some(parse_cost(&n.to_string()));
    }

    if let Some(tail) = unless_cost.strip_prefix("DefinedCost_") {
        let mut parts = tail.split('_');
        let defined = parts.next().unwrap_or("");
        let modifier = parts.next();
        let defined_cards = crate::ability::ability_utils::get_defined_cards(
            game,
            sa.source,
            defined,
            Some(sa.activating_player),
        );
        let first = *defined_cards.first()?;
        let mut generic = game.card(first).mana_cost.cmc() as i32;
        if let Some(m) = modifier {
            if let Some(n) = m.strip_prefix("Minus").and_then(|s| s.parse::<i32>().ok()) {
                generic = (generic - n).max(0);
            } else if let Some(n) = m.strip_prefix("Plus").and_then(|s| s.parse::<i32>().ok()) {
                generic += n;
            }
        }
        return Some(parse_cost(&generic.to_string()));
    }

    Some(parse_cost(unless_cost))
}

/// Resolve a SpellAbility with Java-style `UnlessCost` payment flow.
/// Mirrors `AbilityUtils.handleUnlessCost(...)` for the core branch:
/// if a payer pays the cost, resolution is gated by `UnlessSwitched`.
pub(super) fn resolve_effect_with_unless_cost(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    unless_cost: &str,
) {
    let source = match sa.source {
        Some(cid) => cid,
        None => {
            super::effect_resolver::resolve_effect_once(ctx, sa);
            return;
        }
    };
    let Some(cost) = calculate_unless_cost(ctx.game, sa, unless_cost) else {
        // Java: when `calculateUnlessCost` returns null, resolve the effect
        // without the unless-branch at all.
        super::effect_resolver::resolve_effect_once(ctx, sa);
        return;
    };
    let payers = resolve_unless_payers(sa, ctx.game);
    let resolve_subs = sa.ir.unless_resolve_subs.as_deref();
    let exec_subs_when_paid = resolve_subs.is_none_or(|value| value == "WhenPaid");
    let exec_subs_when_not_paid = resolve_subs.is_none_or(|value| value == "WhenNotPaid");
    // Java parity: payCostToPreventEffect → payWithDeterministicDecision →
    // CostPutCounter.visit() always pays from source without calling confirm().
    // No extra RNG/prompt consumption — just attempt to pay if able.
    let mut already_paid = false;
    for payer in payers {
        if ctx.game.player(payer).has_lost {
            continue;
        }
        let available_mana =
            crate::mana::calculate_available_mana(&ctx.mana_pools[payer.index()], ctx.game, payer);
        if !crate::cost::can_pay_with_ability(
            &cost,
            ctx.game,
            &available_mana,
            source,
            payer,
            Some(sa),
        ) {
            continue;
        }
        let cost_kind = cost.to_simple_string();
        let prompt = format!(
            "Pay {} to prevent {}?",
            if cost_kind.is_empty() {
                "this cost".to_string()
            } else {
                cost_kind.clone()
            },
            sa.source
                .map(|cid| ctx.game.card(cid).card_name.clone())
                .unwrap_or_else(|| "this effect".to_string())
        );
        let card_name = sa.source.map(|cid| ctx.game.card(cid).card_name.as_str());
        ctx.agents[payer.index()].snapshot_state(ctx.game, ctx.mana_pools);
        let pay_life_unless = matches!(cost.parts.as_slice(), [CostPart::PayLife(_)])
            && !is_spell_payment_context(sa, ctx.game);
        if pay_life_unless {
            let kind = effect_cost_part_kind(&cost.parts[0]);
            let message = format!("Pay {} cost for {}?", kind, card_name.unwrap_or("unknown"));
            if !ctx.agents[payer.index()].confirm_payment(payer, kind, &message, sa.source, sa.api)
            {
                continue;
            }
        }
        if !ctx.agents[payer.index()].pay_cost_to_prevent_effect(
            payer,
            if cost_kind.is_empty() {
                "UnlessCost"
            } else {
                cost_kind.as_str()
            },
            &prompt,
            sa.source,
            sa.api,
            true,
        ) {
            continue;
        }
        let paid = if pay_life_unless {
            try_pay_unless_cost_without_confirm(ctx, sa, source, payer, &cost)
        } else {
            try_pay_unless_cost(ctx, sa, source, payer, &cost)
        };
        if paid {
            already_paid = true;
        }
    }

    let is_switched = sa.ir.unless_switched;
    if already_paid == is_switched {
        if sa.ir.optional_decider_text.is_some() {
            let decider = sa
                .ir
                .optional_decider_text
                .as_deref()
                .and_then(|defined| {
                    crate::ability::ability_utils::resolve_defined_players_with_sa(
                        defined,
                        sa,
                        sa.activating_player,
                        ctx.game,
                    )
                    .into_iter()
                    .next()
                })
                .unwrap_or(sa.activating_player);
            let card_name = sa.source.map(|cid| ctx.game.card(cid).card_name.clone());
            let prompt = sa
                .ir
                .spell_description_text
                .as_deref()
                .unwrap_or("Use this optional effect?");
            ctx.agents[decider.index()].snapshot_state(ctx.game, ctx.mana_pools);
            if !ctx.agents[decider.index()].confirm_action(
                decider,
                Some("OptionalEffect"),
                prompt,
                &[],
                sa.source,
                sa.api,
            ) {
                return;
            }
        }
        super::effect_resolver::resolve_effect_once(ctx, sa);
    }

    if (already_paid && exec_subs_when_paid) || (!already_paid && exec_subs_when_not_paid) {
        let mut current = sa.sub_ability.as_deref();
        while let Some(sub_sa) = current {
            resolve_effect(ctx, sub_sa);
            current = sub_sa.sub_ability.as_deref();
            if ctx.game.game_over {
                break;
            }
        }
    }
}

fn resolve_unless_payers(sa: &SpellAbility, game: &GameState) -> Vec<PlayerId> {
    let pays = sa
        .ir
        .unless_payer_text
        .as_deref()
        .unwrap_or("TargetedController");
    if pays.eq_ignore_ascii_case("TargetedController") {
        if let Some(pid) = sa.target_chosen.target_player {
            vec![pid]
        } else if let Some(cid) = sa.target_chosen.target_card {
            // Card target: controller of the targeted card.
            vec![game.card(cid).controller]
        } else {
            vec![game.opponent_of(sa.activating_player)]
        }
    } else {
        // Use sa-aware resolution so "Remembered" / "TriggeredPlayer" / etc.
        // work — e.g. Rottenmouth Viper's "UnlessPayer$ Remembered" has to
        // resolve via host.remembered_players (set by ChooseGenericEffect's
        // TempRemember$ Chooser), not fall back to the controller.
        crate::ability::ability_utils::resolve_defined_players_with_sa(
            pays,
            sa,
            sa.activating_player,
            game,
        )
    }
}

pub(crate) fn try_pay_unless_cost(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    source: CardId,
    payer: PlayerId,
    cost: &Cost,
) -> bool {
    try_pay_effect_cost(
        ctx,
        sa,
        source,
        payer,
        cost,
        EffectCostPaymentMode::Unless {
            spell_context: is_spell_payment_context(sa, ctx.game),
        },
    )
}

fn try_pay_unless_cost_without_confirm(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    source: CardId,
    payer: PlayerId,
    cost: &Cost,
) -> bool {
    try_pay_effect_cost(
        ctx,
        sa,
        source,
        payer,
        cost,
        EffectCostPaymentMode::Unless {
            spell_context: true,
        },
    )
}

/// Pay the merged cumulative upkeep cost. Mirrors Java's payCostToPreventEffect
/// flow for cumulative upkeep in SacrificeEffect. Supports FlipCoin, Mill, Mana,
/// and other standard cost parts.
pub(crate) fn try_pay_cumulative_upkeep(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    source: CardId,
    payer: PlayerId,
    cost: &Cost,
) -> bool {
    try_pay_effect_cost(
        ctx,
        sa,
        source,
        payer,
        cost,
        EffectCostPaymentMode::CumulativeUpkeep,
    )
}

pub(crate) fn try_pay_echo(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    source: CardId,
    payer: PlayerId,
    cost: &Cost,
) -> bool {
    try_pay_effect_cost(ctx, sa, source, payer, cost, EffectCostPaymentMode::Echo)
}

/// Mirrors Java's `DeterministicCostPlumbing.isSpellPaymentContext()`.
/// Returns true if the SA represents a spell being cast (not a trigger/activated ability).
pub(crate) fn is_spell_payment_context(sa: &SpellAbility, game: &GameState) -> bool {
    if sa.is_spell {
        return true;
    }
    if let Some(cid) = sa.source {
        let card = game.card(cid);
        if card.type_line.is_instant() || card.type_line.is_sorcery() {
            return true;
        }
    }
    false
}

/// Cost part kind label for special effect-payment confirm prompts.
fn effect_cost_part_kind(part: &CostPart) -> &'static str {
    match part {
        CostPart::DamageYou(_) => "DamageYou",
        CostPart::PayLife(_) => "PayLife",
        CostPart::Draw(_) => "Draw",
        CostPart::Mill(_) => "Mill",
        CostPart::AddMana { .. } => "AddMana",
        CostPart::FlipCoin(_) => "FlipCoin",
        _ => "Cost",
    }
}
