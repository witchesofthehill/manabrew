use super::*;

use forge_foundation::{ManaCost, ZoneType};

use crate::ability::activated::ActivatedAbility;

#[derive(Clone, Copy)]
pub(crate) struct ManaPaymentSession<'a> {
    pub player: PlayerId,
    pub card_id: CardId,
    pub card_name: &'a str,
    pub mana_cost: &'a ManaCost,
    pub cost_str: &'a str,
    pub cost_display_str: &'a str,
    pub cost_checkpoint_str: &'a str,
    pub is_activated_ability: bool,
    pub reserved_sacrifices: &'a [CardId],
}

#[derive(Clone, Copy)]
pub(crate) struct ManaPaymentResult {
    pub paid: bool,
    pub preserve_taps_on_failure: bool,
}

impl ManaPaymentResult {
    fn paid() -> Self {
        Self {
            paid: true,
            preserve_taps_on_failure: false,
        }
    }

    fn failed() -> Self {
        Self {
            paid: false,
            preserve_taps_on_failure: false,
        }
    }

    fn failed_preserving_taps() -> Self {
        Self {
            paid: false,
            preserve_taps_on_failure: true,
        }
    }
}

fn notify_mana_payment_resolved(
    agents: &mut [Box<dyn PlayerAgent>],
    player: PlayerId,
    actions: &[ManaCostAction],
) {
    let notification = crate::agent::notification::GameNotification::ManaPaymentResolved {
        player,
        actions: actions.to_vec(),
    };
    for agent in agents.iter_mut() {
        agent.notify(notification.clone());
    }
}

pub(crate) fn pay_mana_cost_session_generic<
    FAvail,
    FAuto,
    FTryPay,
    FResolveAbility,
    FBasicLandTap,
    FUndoable,
    FBeginUndo,
    FFinishUndo,
    FUndo,
    TUndo,
>(
    game: &mut GameState,
    agents: &mut [Box<dyn PlayerAgent>],
    mana_pools: &mut [ManaPool],
    session: ManaPaymentSession<'_>,
    mana_ability_available: FAvail,
    mut auto_pay: FAuto,
    mut try_pay_from_pool: FTryPay,
    mut resolve_mana_ability: FResolveAbility,
    mut on_basic_land_tap: FBasicLandTap,
    mut undoable_mana_sources: FUndoable,
    mut begin_mana_undo: FBeginUndo,
    mut finish_mana_undo: FFinishUndo,
    mut undo_mana_action: FUndo,
) -> ManaPaymentResult
where
    FAvail: Fn(&GameState, PlayerId, CardId, &ActivatedAbility, &[CardId]) -> bool,
    FAuto: FnMut(
        &mut GameState,
        &mut [Box<dyn PlayerAgent>],
        &mut [ManaPool],
        ManaPaymentSession<'_>,
    ) -> Option<Vec<ManaCostAction>>,
    FTryPay: FnMut(&mut GameState, &mut [ManaPool], PlayerId) -> bool,
    FResolveAbility: FnMut(
        &mut GameState,
        &mut [Box<dyn PlayerAgent>],
        &mut [ManaPool],
        PlayerId,
        CardId,
        &ActivatedAbility,
        Option<u16>,
    ) -> bool,
    FBasicLandTap: FnMut(&mut GameState, PlayerId, CardId),
    FUndoable: FnMut(&GameState, &[ManaPool], PlayerId) -> Vec<CardId>,
    FBeginUndo: FnMut(&GameState, &[ManaPool], PlayerId, CardId) -> TUndo,
    FFinishUndo: FnMut(&mut GameState, &mut [ManaPool], TUndo, usize),
    FUndo: FnMut(&mut GameState, &mut [ManaPool], PlayerId, CardId) -> bool,
{
    let saved_pool = mana_pools[session.player.index()].clone();
    let mut mana_loop_invalid_count = 0u32;
    let mut executed_actions: Vec<ManaCostAction> = Vec::new();

    loop {
        let mana_sources =
            mana::collect_mana_payment_sources(game, session.player, session.reserved_sacrifices);
        let tappable_lands = mana_sources.source_cards.clone();
        let mana_ability_options = mana_sources.mana_ability_options;
        let untappable_lands = undoable_mana_sources(game, mana_pools, session.player);
        let pool_ref = mana_pools[session.player.index()].clone();
        let can_confirm_from_pool = {
            let mut confirm_pool = pool_ref.clone();
            confirm_pool.source_colors = None;
            confirm_pool.total_sources = None;
            confirm_pool.try_pay(session.mana_cost)
        };

        agents[session.player.index()].snapshot_state(game, mana_pools);
        let action = agents[session.player.index()].pay_mana_cost(
            session.player,
            session.card_id,
            session.card_name,
            session.cost_str,
            session.cost_display_str,
            session.cost_checkpoint_str,
            can_confirm_from_pool,
            session.is_activated_ability,
            session.reserved_sacrifices,
            &mana_ability_options,
            &tappable_lands,
            &untappable_lands,
            &pool_ref,
        );

        match action {
            ManaCostAction::TapLand {
                card_id: land_id,
                mana_ability_index,
                express_choice,
            } => {
                if !tappable_lands.contains(&land_id) {
                    mana_loop_invalid_count += 1;
                    if mana_loop_invalid_count > 3 {
                        mana_pools[session.player.index()] = saved_pool.clone();
                        return ManaPaymentResult::failed();
                    }
                    continue;
                }
                mana_loop_invalid_count = 0;
                let mana_ab = {
                    let c = game.card(land_id);
                    mana_ability_index
                        .and_then(|idx| c.activated_abilities.get(idx))
                        .filter(|ab| {
                            ab.is_mana_ability
                                && mana_ability_available(
                                    game,
                                    session.player,
                                    land_id,
                                    ab,
                                    session.reserved_sacrifices,
                                )
                        })
                        .cloned()
                        .or_else(|| {
                            c.activated_abilities
                                .iter()
                                .find(|ab| {
                                    ab.is_mana_ability
                                        && mana_ability_available(
                                            game,
                                            session.player,
                                            land_id,
                                            ab,
                                            session.reserved_sacrifices,
                                        )
                                })
                                .cloned()
                        })
                };
                if let Some(ab) = mana_ab {
                    // Snapshot BEFORE the ability produces mana so we can
                    // capture everything this tap adds to the pool —
                    // base production, aura-granted mana, doublers, and
                    // TapsForMana trigger payloads — in a single diff.
                    // Without this, the untap path below only knows about
                    // the land's native atoms and leaves the aura-added
                    // mana orphaned in the pool.
                    let player_idx = session.player.index();
                    let undo_record = begin_mana_undo(game, mana_pools, session.player, land_id);
                    let pool_snapshot = mana_pools[player_idx].begin_tap_tracking();
                    let resolved = resolve_mana_ability(
                        game,
                        agents,
                        mana_pools,
                        session.player,
                        land_id,
                        &ab,
                        express_choice,
                    );
                    let produced = mana_pools[player_idx].end_tap_tracking(&pool_snapshot);
                    let produced_count = produced.len();
                    if resolved {
                        executed_actions.push(ManaCostAction::TapLand {
                            card_id: land_id,
                            mana_ability_index: Some(mana_ability_index.unwrap_or(0)),
                            express_choice,
                        });
                    }
                    if resolved && !produced.is_empty() {
                        game.card_mut(land_id).last_mana_produced = Some(produced);
                    }
                    finish_mana_undo(game, mana_pools, undo_record, produced_count);
                } else if let Some(atom) = basic_land_mana_atom(game.card(land_id)) {
                    executed_actions.push(ManaCostAction::TapLand {
                        card_id: land_id,
                        mana_ability_index: Some(0),
                        express_choice: None,
                    });
                    let player_idx = session.player.index();
                    let undo_record = begin_mana_undo(game, mana_pools, session.player, land_id);
                    let pool_snapshot = mana_pools[player_idx].begin_tap_tracking();
                    game.tap(land_id);
                    // Fire ProduceMana replacement (e.g. Nyxbloom Ancient triples mana)
                    // before adding to pool. Mirrors Java AbilityManaPart.produceMana
                    // which always invokes ReplacementHandler.run(ProduceMana, ...)
                    // even for the implicit basic-land tap (every land has an
                    // intrinsic AbilityManaPart in Forge's CardFactoryUtil).
                    let mana_letter = crate::mana::ManaPool::atom_to_letter(atom).to_string();
                    let mut event =
                        crate::replacement::replacement_handler::ReplacementEvent::ProduceMana {
                            source: land_id,
                            activator: session.player,
                            mana: mana_letter.clone(),
                        };
                    let result =
                        crate::replacement::replacement_handler::apply_replacements_with_agents(
                            game, agents, &mut event,
                        );
                    let final_mana = if result == crate::replacement::ReplacementResult::Updated {
                        if let crate::replacement::replacement_handler::ReplacementEvent::ProduceMana {
                            mana,
                            ..
                        } = event
                        {
                            mana
                        } else {
                            mana_letter
                        }
                    } else {
                        mana_letter
                    };
                    for token in final_mana.split_whitespace() {
                        if let Some(produced_atom) = crate::mana::mana_atom_from_produced(token) {
                            mana_pools[player_idx].add(produced_atom, 1);
                        }
                    }
                    on_basic_land_tap(game, session.player, land_id);
                    let produced = mana_pools[player_idx].end_tap_tracking(&pool_snapshot);
                    let produced_count = produced.len();
                    if !produced.is_empty() {
                        game.card_mut(land_id).last_mana_produced = Some(produced);
                    }
                    finish_mana_undo(game, mana_pools, undo_record, produced_count);
                }
            }
            ManaCostAction::UntapLand(land_id) => {
                if !untappable_lands.contains(&land_id) {
                    continue;
                }
                if undo_mana_action(game, mana_pools, session.player, land_id) {
                    executed_actions.push(ManaCostAction::UntapLand(land_id));
                }
            }
            ManaCostAction::Pay { auto } => {
                if auto {
                    if let Some(mut auto_trace) = auto_pay(game, agents, mana_pools, session) {
                        let attempted_and_failed =
                            matches!(auto_trace.last(), Some(ManaCostAction::AttemptedAndFailed));
                        executed_actions.append(&mut auto_trace);
                        if attempted_and_failed {
                            notify_mana_payment_resolved(agents, session.player, &executed_actions);
                            mana_pools[session.player.index()] = saved_pool.clone();
                            return ManaPaymentResult::failed();
                        }
                        executed_actions.push(ManaCostAction::Pay { auto: false });
                        notify_mana_payment_resolved(agents, session.player, &executed_actions);
                        return ManaPaymentResult::paid();
                    }
                    executed_actions.push(ManaCostAction::AttemptedAndFailed);
                    notify_mana_payment_resolved(agents, session.player, &executed_actions);
                    mana_pools[session.player.index()] = saved_pool.clone();
                    return ManaPaymentResult::failed();
                }

                if try_pay_from_pool(game, mana_pools, session.player) {
                    executed_actions.push(ManaCostAction::Pay { auto: false });
                    notify_mana_payment_resolved(agents, session.player, &executed_actions);
                    return ManaPaymentResult::paid();
                }

                mana_loop_invalid_count += 1;
                if mana_loop_invalid_count > 3 {
                    executed_actions.push(ManaCostAction::AttemptedAndFailed);
                    notify_mana_payment_resolved(agents, session.player, &executed_actions);
                    mana_pools[session.player.index()] = saved_pool.clone();
                    return ManaPaymentResult::failed();
                }
            }
            ManaCostAction::AttemptedAndFailed => {
                executed_actions.push(ManaCostAction::AttemptedAndFailed);
                notify_mana_payment_resolved(agents, session.player, &executed_actions);
                mana_pools[session.player.index()] = saved_pool.clone();
                return ManaPaymentResult::failed_preserving_taps();
            }
        }
    }
}

impl GameLoop {
    pub(crate) fn make_mana_payment_callback<'a>(
        trigger_handler: *mut TriggerHandler,
        game: *mut GameState,
        agents: &'a mut [Box<dyn PlayerAgent>],
        player: PlayerId,
        source: CardId,
    ) -> impl FnMut(mana::ManaPayCallback<'_>) -> Option<CardId> + 'a {
        move |kind: mana::ManaPayCallback<'_>| -> Option<CardId> {
            match kind {
                mana::ManaPayCallback::ChooseSacrifice(valid) => {
                    agents[player.index()].choose_sacrifice(player, valid, Some(source))
                }
                mana::ManaPayCallback::ChooseColor(valid_colors) => {
                    // Always invoke the agent — humans go through their
                    // interactive `ChooseColor` modal, AI returns a
                    // default. The engine never branches on agent kind.
                    let _ = agents[player.index()].choose_color(player, valid_colors);
                    None
                }
                mana::ManaPayCallback::ChooseTapType {
                    valid,
                    min,
                    max,
                    chosen,
                } => {
                    chosen.extend(
                        agents[player.index()].choose_cards_for_effect(player, valid, min, max),
                    );
                    chosen.first().copied()
                }
                mana::ManaPayCallback::ConfirmSelfSacrifice(source_id) => {
                    if agents[player.index()].confirm_payment(
                        player,
                        "Sacrifice",
                        "Sacrifice for mana",
                        None,
                        Some(crate::ability::api_type::ApiType::Mana),
                    ) {
                        Some(source_id)
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
                    let game = &mut *game;
                    let trigger_handler = &mut *trigger_handler;
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
                    let game = &mut *game;
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
        }
    }

    pub(crate) fn pay_mana_cost_session<FAvail, FAuto, FTryPay>(
        &mut self,
        game: &mut GameState,
        agents: &mut [Box<dyn PlayerAgent>],
        session: ManaPaymentSession<'_>,
        mana_ability_available: FAvail,
        mut auto_pay: FAuto,
        mut try_pay_from_pool: FTryPay,
    ) -> ManaPaymentResult
    where
        FAvail: Fn(&GameState, PlayerId, CardId, &ActivatedAbility, &[CardId]) -> bool,
        FAuto: FnMut(
            &mut GameLoop,
            &mut GameState,
            &mut [Box<dyn PlayerAgent>],
            ManaPaymentSession<'_>,
        ) -> Option<Vec<ManaCostAction>>,
        FTryPay: FnMut(&mut GameLoop, &mut GameState, PlayerId) -> bool,
    {
        let self_ptr: *mut GameLoop = self;
        let agents_ptr: *mut [Box<dyn PlayerAgent>] = std::ptr::from_mut(agents);
        let paid = pay_mana_cost_session_generic(
            game,
            agents,
            &mut self.mana_pools,
            session,
            mana_ability_available,
            |game, agents, _mana_pools, session| unsafe {
                auto_pay(&mut *self_ptr, game, agents, session)
            },
            |game, _mana_pools, player| unsafe { try_pay_from_pool(&mut *self_ptr, game, player) },
            |game, agents, _mana_pools, player, card_id, ab, express_choice| unsafe {
                (&mut *self_ptr).resolve_mana_ability(
                    game,
                    agents,
                    player,
                    card_id,
                    ab,
                    express_choice,
                )
            },
            |game, player, land_id| unsafe {
                let this = &mut *self_ptr;
                let agents = &mut *agents_ptr;
                this.trigger_handler.run_trigger(
                    TriggerType::TapsForMana,
                    RunParams {
                        card: Some(land_id),
                        player: Some(player),
                        ..Default::default()
                    },
                    false,
                );
                this.trigger_handler.run_trigger(
                    TriggerType::ManaAdded,
                    RunParams {
                        card: Some(land_id),
                        player: Some(player),
                        activator: Some(player),
                        ..Default::default()
                    },
                    false,
                );
                let pending = this.trigger_handler.run_waiting_triggers(game);
                if !pending.is_empty() {
                    this.mark_mana_undo_disqualified();
                }
                for pt in pending {
                    this.resolve_single_effect(game, agents, &pt.entry.spell_ability, None);
                }
            },
            |_game, _mana_pools, player| unsafe { (&mut *self_ptr).undoable_mana_sources(player) },
            |game, mana_pools, player, card_id| unsafe {
                (&mut *self_ptr)
                    .begin_mana_undo_action_with_mana_slice(game, mana_pools, player, card_id)
            },
            |_game, _mana_pools, record, produced_count| unsafe {
                (&mut *self_ptr).finish_mana_undo_action(record, produced_count);
            },
            |game, mana_pools, player, card_id| unsafe {
                (&mut *self_ptr).undo_mana_action_with_mana_slice(game, mana_pools, player, card_id)
            },
        );
        self.invalidate_mana_undo_for_player(session.player);
        paid
    }
}
