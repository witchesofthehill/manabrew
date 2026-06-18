use std::collections::BTreeMap;

use forge_foundation::ZoneType;

use super::{emit_zone_trigger_with_lki_counters, EffectContext};
use crate::ability::spell_ability_effect::get_target_players;
use crate::card::CounterType;
use crate::event::RunParams;
use crate::ids::{CardId, PlayerId};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

/// Perform the actual sacrifice of a card: fire triggers, move to graveyard, emit zone change.
/// If `exploit_source` is Some, also fires the Exploited trigger for the Exploit keyword.
///
/// Returns the sacrificed `CardId` on success, or `None` if the card was not on the
/// battlefield or was prevented from being sacrificed (Sigarda et al.). Callers use the
/// return value to accumulate per-controller batches for the trailing `SacrificedOnce`
/// trigger fired once at the end of `resolve()`.
fn do_sacrifice(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    card_id: crate::ids::CardId,
    sacrificing_player: PlayerId,
    exploit_source: Option<crate::ids::CardId>,
) -> Option<CardId> {
    if ctx.game.card(card_id).zone != ZoneType::Battlefield {
        return None;
    }
    if crate::staticability::static_ability_cant_sacrifice::cant_sacrifice(
        &ctx.game.cards,
        ctx.game.card(card_id),
        Some(sa),
        false,
    ) {
        return None;
    }
    let owner = ctx.game.card(card_id).owner;

    // Capture +1/+1 counter count BEFORE the card moves to graveyard.
    // Needed for Modular death triggers which move counters to target
    // artifact creature (CR 702.43b). Counters are cleared during move_card.
    let lki_p1p1 = *ctx
        .game
        .card(card_id)
        .counters
        .get(&crate::card::CounterType::P1P1)
        .unwrap_or(&0);
    let lki_power = ctx.game.card(card_id).power();
    let lki_toughness = ctx.game.card(card_id).toughness();
    // Capture LKI counters for death triggers (e.g. Servant of the Scale)
    let lki_counters = ctx.game.card(card_id).counters.clone();
    ctx.game.card_mut(card_id).lki_counters = Some(lki_counters);
    ctx.game
        .card_mut(card_id)
        .set_lki_power_toughness(Some(lki_power), Some(lki_toughness));

    // Clear temporary Animate triggers before firing events (CR 400.7).
    {
        let card = ctx.game.card_mut(card_id);
        card.clear_pump_triggers();
    }
    // Fire Sacrificed trigger
    ctx.trigger_handler.run_trigger(
        TriggerType::Sacrificed,
        RunParams {
            card: Some(card_id),
            player: Some(sacrificing_player),
            ..Default::default()
        },
        false,
    );
    // Emit ChangesZone before move so LKI state (counters, keywords)
    // is still available for trigger matching.
    emit_zone_trigger_with_lki_counters(
        ctx.trigger_handler,
        card_id,
        ZoneType::Battlefield,
        ZoneType::Graveyard,
        lki_p1p1,
        lki_power,
        lki_toughness,
    );
    ctx.move_card(card_id, ZoneType::Graveyard, owner);
    ctx.trigger_handler.flush_waiting_triggers(ctx.game);
    // Fire Exploited trigger when the sacrifice is from the Exploit keyword
    if let Some(source_id) = exploit_source {
        ctx.trigger_handler.run_trigger(
            TriggerType::Exploited,
            RunParams {
                card: Some(source_id),
                exploited_card: Some(card_id),
                player: Some(sacrificing_player),
                ..Default::default()
            },
            false,
        );
    }
    Some(card_id)
}

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `SacrificeEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(SacrificeEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    if let Some(echo_cost_str) = sa.ir.echo.as_deref() {
        let source_id = match sa.source {
            Some(cid) if ctx.game.card(cid).zone == ZoneType::Battlefield => cid,
            _ => return,
        };
        let controller = ctx.game.card(source_id).controller;
        let cost = crate::cost::parse_cost(echo_cost_str);
        let available_mana = crate::mana::calculate_available_mana(
            &ctx.mana_pools[controller.index()],
            ctx.game,
            controller,
        );
        let can_pay = crate::cost::can_pay_with_ability(
            &cost,
            ctx.game,
            &available_mana,
            source_id,
            controller,
            Some(sa),
        );
        let cost_kind = cost.to_simple_string();
        let cost_display = crate::cost::to_prompt_string(&cost);
        let prompt = if cost_display.is_empty() {
            "Pay this cost?".to_string()
        } else {
            format!("Pay {}?", cost_display)
        };
        ctx.agents[controller.index()].snapshot_state(ctx.game, ctx.mana_pools);
        let wants_to_pay = ctx.agents[controller.index()].pay_cost_to_prevent_effect(
            controller,
            if cost_kind.is_empty() {
                "Echo"
            } else {
                cost_kind.as_str()
            },
            &prompt,
            Some(source_id),
            sa.api,
            true,
            &[],
            &if sa.stack_description.is_empty() {
                sa.rebuilt_description()
            } else {
                sa.stack_description.clone()
            },
        );
        let paid =
            wants_to_pay && can_pay && super::try_pay_echo(ctx, sa, source_id, controller, &cost);

        ctx.trigger_handler.run_trigger(
            TriggerType::PayEcho,
            RunParams {
                card: Some(source_id),
                echo_paid: Some(paid),
                ..Default::default()
            },
            false,
        );

        if paid || ctx.game.card(source_id).controller != controller {
            return;
        }
        if let Some(cid) = do_sacrifice(ctx, sa, source_id, controller, None) {
            let mut by_controller: BTreeMap<PlayerId, Vec<CardId>> = BTreeMap::new();
            by_controller.insert(controller, vec![cid]);
            crate::game_loop::fire_sacrificed_once_for_batch(
                ctx.game,
                ctx.trigger_handler,
                &by_controller,
            );
        }
        return;
    }

    // ── Cumulative Upkeep ────────────────────────────────────────────────
    // Mirrors Java SacrificeEffect lines 52-75: when CumulativeUpkeep$ is set,
    // add an Age counter, build merged cost (base cost × age counters),
    // ask player to pay, sacrifice if not paid.
    if let Some(cum_cost_str) = sa.ir.cumulative_upkeep.as_deref() {
        let source_id = match sa.source {
            Some(cid) if ctx.game.card(cid).zone == ZoneType::Battlefield => cid,
            _ => return,
        };
        let controller = ctx.game.card(source_id).controller;

        // 1. Add Age counter (mirrors Java host.addCounter(CounterEnumType.AGE, 1, ...))
        ctx.game
            .card_mut(source_id)
            .add_counter(&CounterType::Age, 1);

        // 2. Count age counters to determine how many times to pay
        let n = ctx
            .game
            .card(source_id)
            .counters
            .get(&CounterType::Age)
            .copied()
            .unwrap_or(0) as usize;

        // 3. Build merged cost: N copies of the base cost
        //    Mirrors Java Cost.mergeTo(cumCost, n, sa)
        let base_cost = crate::cost::parse_cost(cum_cost_str);
        let mut merged_parts = Vec::new();
        let mut merged_mana: Option<(
            forge_foundation::ManaCost,
            i32,
            bool,
            bool,
            bool,
            Option<String>,
        )> = None;
        for _ in 0..n {
            for part in base_cost.parts.iter().cloned() {
                match part {
                    crate::cost::CostPart::Mana {
                        cost,
                        x_min,
                        is_exiled_creature_cost,
                        is_enchanted_creature_cost,
                        is_cost_pay_any_number_of_times,
                        max_waterbend,
                    } => {
                        if let Some((
                            total_cost,
                            total_x_min,
                            total_exiled,
                            total_enchanted,
                            total_any_times,
                            total_max_waterbend,
                        )) = &mut merged_mana
                        {
                            *total_cost = total_cost.add(&cost);
                            *total_x_min += x_min;
                            *total_exiled |= is_exiled_creature_cost;
                            *total_enchanted |= is_enchanted_creature_cost;
                            *total_any_times |= is_cost_pay_any_number_of_times;
                            if total_max_waterbend.is_none() {
                                *total_max_waterbend = max_waterbend;
                            }
                        } else {
                            merged_mana = Some((
                                cost,
                                x_min,
                                is_exiled_creature_cost,
                                is_enchanted_creature_cost,
                                is_cost_pay_any_number_of_times,
                                max_waterbend,
                            ));
                        }
                    }
                    other => merged_parts.push(other),
                }
            }
        }
        if let Some((
            cost,
            x_min,
            is_exiled_creature_cost,
            is_enchanted_creature_cost,
            is_cost_pay_any_number_of_times,
            max_waterbend,
        )) = merged_mana
        {
            merged_parts.push(crate::cost::CostPart::Mana {
                cost,
                x_min,
                is_exiled_creature_cost,
                is_enchanted_creature_cost,
                is_cost_pay_any_number_of_times,
                max_waterbend,
            });
        }
        let merged_cost = crate::cost::Cost {
            parts: merged_parts,
            has_tap: false,
            mandatory: false,
        };

        // 4. Pay the merged cost (payCostToPreventEffect flow)
        let paid = super::try_pay_cumulative_upkeep(ctx, sa, source_id, controller, &merged_cost);

        // 5. Fire PayCumulativeUpkeep trigger
        ctx.trigger_handler.run_trigger(
            TriggerType::PayCumulativeUpkeep,
            RunParams {
                card: Some(source_id),
                cumulative_upkeep_paid: Some(paid),
                ..Default::default()
            },
            false,
        );

        // 6. If not paid, sacrifice
        if !paid {
            if let Some(cid) = do_sacrifice(ctx, sa, source_id, controller, None) {
                let mut by_controller: BTreeMap<PlayerId, Vec<CardId>> = BTreeMap::new();
                by_controller.insert(controller, vec![cid]);
                crate::game_loop::fire_sacrificed_once_for_batch(
                    ctx.game,
                    ctx.trigger_handler,
                    &by_controller,
                );
            }
        }
        return;
    }

    let sac_valid = sa
        .ir
        .sac_valid
        .clone()
        .unwrap_or_else(|| "Self".to_string());
    // How many permanents to sacrifice (e.g. Annihilator N).
    let amount: usize = sa
        .ir
        .amount
        .as_deref()
        .and_then(|s| s.parse().ok())
        .unwrap_or(1);

    // Detect Exploit keyword sacrifice — fires TriggerType::Exploited after each sacrifice.
    let is_exploit = sa.ir.exploit;
    let exploit_source = if is_exploit { sa.source } else { None };

    let optional = sa.ir.optional_present;
    let is_strict = sa.ir.strict_amount;
    let defined = sa.defined().map(|s| s.to_lowercase()).unwrap_or_default();

    let sacrificing_players = get_target_players(ctx.game, sa);

    // Track per-controller batches so a single SacrificedOnce trigger fires after
    // each player's batch (mirrors Java GameAction.sacrifice line 2133-2138).
    let mut by_controller: BTreeMap<PlayerId, Vec<CardId>> = BTreeMap::new();
    let mut record_sac = |player: PlayerId, sacrificed: Option<CardId>| {
        if let Some(cid) = sacrificed {
            by_controller.entry(player).or_default().push(cid);
        }
    };

    for sacrificing_player in sacrificing_players {
        if optional {
            let source_name = sa.source.map(|cid| ctx.game.card(cid).card_name.as_str());
            let accepted = ctx.agents[sacrificing_player.index()].confirm_action(
                sacrificing_player,
                None,
                "Do you want to sacrifice?",
                &[],
                sa.source,
                Some(crate::ability::api_type::ApiType::Sacrifice),
            );
            if !accepted {
                continue;
            }
        }

        // When Optional$ True, Java uses choosePermanentsToSacrifice(min=0, max=amount)
        // which allows the player to sacrifice fewer than `amount` creatures.
        // We match this by collecting all chosen cards at once via choose_cards_for_effect.
        if optional
            && !sac_valid.eq_ignore_ascii_case("Self")
            && defined.strip_prefix("carduid_").is_none()
        {
            let valid: Vec<_> = ctx
                .game
                .cards_in_zone(ZoneType::Battlefield, sacrificing_player)
                .to_vec()
                .into_iter()
                .filter(|&cid| {
                    crate::ability::ability_utils::matches_valid_cards_for_sa(
                        ctx.game,
                        sa,
                        ctx.game.card(cid),
                        None,
                        &sac_valid,
                    )
                })
                .filter(|&cid| {
                    !crate::staticability::static_ability_cant_sacrifice::cant_sacrifice(
                        &ctx.game.cards,
                        ctx.game.card(cid),
                        Some(sa),
                        false,
                    )
                })
                .collect();

            let min_targets = if is_strict { amount } else { 0 };
            let chosen = if valid.is_empty() {
                vec![]
            } else {
                ctx.agents[sacrificing_player.index()].choose_cards_for_effect(
                    sacrificing_player,
                    &valid,
                    min_targets,
                    amount,
                )
            };

            for card_id in chosen {
                let sacrificed = do_sacrifice(ctx, sa, card_id, sacrificing_player, exploit_source);
                record_sac(sacrificing_player, sacrificed);
                if sa.ir.remember_sacrificed {
                    if let Some(source_id) = sa.source {
                        ctx.game.card_mut(source_id).add_remembered_card(card_id);
                    }
                }
            }
            continue;
        }

        // Repeat the sacrifice `amount` times (e.g. Annihilator N).
        for _ in 0..amount {
            let card_to_sacrifice = if let Some(uid_str) = defined.strip_prefix("carduid_") {
                // Specific card by ID (e.g. delayed trigger for Blitz sacrifice-at-EOT)
                uid_str
                    .parse::<u32>()
                    .ok()
                    .map(crate::ids::CardId)
                    .filter(|&cid| ctx.game.card(cid).zone == ZoneType::Battlefield)
            } else if sac_valid.eq_ignore_ascii_case("Self") {
                // Sacrifice the source card itself
                sa.source
                    .filter(|&cid| ctx.game.card(cid).zone == ZoneType::Battlefield)
            } else {
                // Find valid cards controlled by the sacrificing player
                let valid: Vec<_> = ctx
                    .game
                    .cards_in_zone(ZoneType::Battlefield, sacrificing_player)
                    .to_vec()
                    .into_iter()
                    .filter(|&cid| {
                        crate::ability::ability_utils::matches_valid_cards_for_sa(
                            ctx.game,
                            sa,
                            ctx.game.card(cid),
                            None,
                            &sac_valid,
                        )
                    })
                    .collect();

                if valid.is_empty() {
                    None
                } else if sa.ir.random {
                    // Random$ True — reservoir-sample a single element, matching
                    // Java's `Aggregates.random(Iterable, 1)` at
                    // `forge-core/.../Aggregates.java`. The reservoir form consumes
                    // N-1 RNG draws for an N-element source, which is materially
                    // different from a single `nextInt(N)` call. RNG-parity with
                    // Java breaks unless we mirror the same draw count here.
                    let mut picked: Option<crate::ids::CardId> = None;
                    let mut i = 0i32;
                    for &cid in valid.iter() {
                        i += 1;
                        if i == 1 {
                            picked = Some(cid);
                        } else {
                            let j = ctx.rng.next_int(i);
                            if j < 1 {
                                picked = Some(cid);
                            }
                        }
                    }
                    picked
                } else {
                    ctx.agents[sacrificing_player.index()].choose_sacrifice(
                        sacrificing_player,
                        &valid,
                        sa.source,
                    )
                }
            };

            if let Some(card_id) = card_to_sacrifice {
                let sacrificed = do_sacrifice(ctx, sa, card_id, sacrificing_player, exploit_source);
                record_sac(sacrificing_player, sacrificed);
                // RememberSacrificed$ True — remember the sacrificed card on the source
                // so downstream ConditionDefined$ Remembered checks can find it.
                if sa.ir.remember_sacrificed {
                    if let Some(source_id) = sa.source {
                        ctx.game.card_mut(source_id).add_remembered_card(card_id);
                    }
                }
            }
        }
    }

    // `record_sac` is unused past this point; NLL releases its &mut on
    // `by_controller` so the next call can take a shared reference.
    crate::game_loop::fire_sacrificed_once_for_batch(ctx.game, ctx.trigger_handler, &by_controller);
}
