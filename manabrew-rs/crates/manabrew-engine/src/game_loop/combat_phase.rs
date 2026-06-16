use super::*;
use crate::card::card_damage_history::TrackedEntity;

impl GameLoop {
    pub fn step_combat(&mut self, game: &mut GameState, agents: &mut [Box<dyn PlayerAgent>]) {
        let _perf_scope =
            crate::perf::ParamsLookupScopeGuard::enter(crate::perf::ParamsLookupScope::Combat);
        let active = game.active_player();
        let defending = game.opponent_of(active);
        self.combat.clear_with_cards(&mut game.cards);
        game.turn.combat_block_assignments.clear();
        self.combat.attacking_player = Some(active);
        self.combat.defending_player = Some(defending);

        // Begin Combat
        self.set_phase(game, agents, PhaseType::CombatBegin);
        self.emit_phase_trigger(game, PhaseType::CombatBegin);
        self.step_with_priority(game, agents, false);
        if game.game_over {
            self.combat.clear_with_cards(&mut game.cards);
            return;
        }

        // EndCombatPhase (issue #22): if requested, exit combat early
        if game.end_combat_requested {
            game.end_combat_requested = false;
            self.combat.clear_with_cards(&mut game.cards);
            return;
        }

        // Recompute continuous effects before evaluating attack/block legality.
        // CantAttack / CantBlock flags are set here.
        apply_continuous_effects(game);
        self.trigger_handler.reset_active_triggers(game);

        // LKI: Snapshot battlefield state before combat declarations.
        // Mirrors Java's Game.copyLastState() called before declare attackers.
        game.copy_last_state();

        // Declare Attackers — freeze the stack during declarations.
        game.stack.freeze_stack();
        self.set_phase(game, agents, PhaseType::CombatDeclareAttackers);
        let available_attackers = combat::get_available_attackers(game, active);
        let possible_defenders = combat::get_possible_defenders(game, active);

        // Compute attack requirements (must-attack from statics + goad)
        let must_attackers = if available_attackers.is_empty() {
            Vec::new()
        } else {
            let requirements = combat::attack_requirement::compute_attack_requirements(
                &game.cards,
                &available_attackers,
                defending,
            );
            combat::attack_requirement::must_attack_ids(&requirements)
        };

        // Java's PhaseHandler uses a do-while loop: declare attackers, validate,
        // and re-prompt if invalid.  We mirror this so RNG consumption matches.
        let mut chosen_attackers: Vec<(CardId, combat::DefenderId)> = Vec::new();
        if !available_attackers.is_empty() {
            // Java parity: attacker declaration retries until a legal attack
            // set is found. A low cap can prematurely accept an invalid/no-attack
            // outcome on crowded boards (e.g. Silent Arbiter + MustAttack).
            // Keep a very high guard only as a last-resort safety valve.
            let max_attempts = 5000;
            for _attempt in 0..max_attempts {
                agents[active.index()].snapshot_state(game, &self.mana_pools);
                self.game_log.log(
                    GameLogEntryType::PriorityWaiting,
                    2,
                    format!(
                        "Waiting for {} attacker declaration",
                        game.player(active).name
                    ),
                );
                let agent = &mut agents[active.index()];
                let mut picked =
                    agent.choose_attackers(active, &available_attackers, &possible_defenders);
                if self.apply_pending_snapshot_restore(game, agents) {
                    return;
                }
                self.game_log.log(
                    GameLogEntryType::PriorityResponse,
                    2,
                    format!(
                        "{} declared {} attacker(s)",
                        game.player(active).name,
                        picked.len()
                    ),
                );

                // Validate attack restrictions (OnlyAlone, NotAlone, NeedGreaterPower, etc.)
                let attacker_ids: Vec<CardId> = picked.iter().map(|(a, _)| *a).collect();
                let illegal = combat::attack_restriction::validate_attack_restrictions(
                    &attacker_ids,
                    &game.cards,
                );
                if !illegal.is_empty() {
                    picked.retain(|(id, _)| !illegal.contains(id));
                }

                // Check AttackRestrict limits (global + per-defender).
                let global_max =
                    crate::staticability::static_ability_attack_restrict::global_attack_restrict(
                        &game.cards,
                    );

                // Global limit applies to ALL attackers regardless of defender.
                let mut invalid = false;
                if let Some(max) = global_max {
                    if picked.len() > max as usize {
                        invalid = true;
                    }
                }

                // Mirror Java's validateAttackers + countViolations + getLegalAttackers:
                // Count must-attack violations in the agent's raw declaration and compare
                // against the minimum violations achievable by the best legal attack.
                // If the agent's declaration has more violations, mark as invalid and retry
                // (matching Java's RNG consumption for the retry loop).
                if !invalid {
                    let current_violations = must_attackers
                        .iter()
                        .filter(|&&m| !picked.iter().any(|(a, _)| *a == m))
                        .count();
                    if current_violations > 0 {
                        // Compute minimum possible violations: try the best attack
                        // which includes as many must-attackers as possible within
                        // the global max. If all must-attackers fit within the limit,
                        // best_violations = 0. Otherwise, best_violations = must_count - max.
                        let max_attackers = global_max.unwrap_or(i32::MAX) as usize;
                        let best_violations = must_attackers.len().saturating_sub(max_attackers);
                        if current_violations > best_violations {
                            invalid = true;
                        }
                    }
                }

                // Per-defender limit: only count attackers going to that defender.
                // Crawlspace's "ValidDefender$ You" only restricts attacks against
                // the Crawlspace controller, not attacks against planeswalkers.
                if !invalid {
                    let defender_max =
                        crate::staticability::static_ability_attack_restrict::attack_restrict_num_for_defender(
                            &game.cards,
                            defending,
                        );
                    if let Some(max) = defender_max {
                        let attackers_to_defender = picked
                            .iter()
                            .filter(|(_, def)| def.controlling_player(game) == defending)
                            .count();
                        if attackers_to_defender > max as usize {
                            invalid = true;
                        }
                    }
                }

                if invalid {
                    // Declaration invalid — re-prompt like Java's PhaseHandler.
                    agents[active.index()].notify(
                        crate::agent::notification::GameNotification::Event(
                            crate::agent::GameLogEvent::warning("Attack declaration invalid"),
                        ),
                    );
                    continue;
                }

                chosen_attackers = picked;
                break;
            }
        }

        // Java parity: pre-mark declared attackers before optional attack-cost
        // resolution so they are not valid enlist targets.
        // Java does this by temporarily tapping non-vigilance attackers and
        // treating them as attacking before OptionalAttackCost is paid.
        let premarked_attackers: Vec<(CardId, combat::DefenderId)> = chosen_attackers.clone();
        for &(attacker_id, def) in &premarked_attackers {
            let defending_player = def.controlling_player(game);
            game.card_mut(attacker_id)
                .set_attacking_player(defending_player);
            if !game.card(attacker_id).has_vigilance() {
                game.card_mut(attacker_id).set_tapped(true);
            }
        }

        // Java parity: optional attack costs (Exert/Enlist) are chosen immediately
        // after attackers are declared and before CantAttackUnless payments.
        {
            let declared_attackers: Vec<CardId> = chosen_attackers
                .iter()
                .map(|(attacker, _)| *attacker)
                .collect();
            let mut optional_exert_by_attacker: std::collections::HashMap<
                CardId,
                Vec<(i32, String)>,
            > = std::collections::HashMap::new();
            let mut optional_enlist_by_attacker: std::collections::HashMap<
                CardId,
                Vec<(i32, String)>,
            > = std::collections::HashMap::new();

            for &attacker in &declared_attackers {
                let static_abilities = game.card(attacker).static_abilities.clone();
                for st in &static_abilities {
                    if !st.check_mode(&crate::staticability::StaticMode::OptionalAttackCost) {
                        continue;
                    }
                    let Some(cost_raw) = st.ir.cost.as_deref() else {
                        continue;
                    };
                    let parsed = crate::cost::parse_cost(cost_raw);
                    for part in parsed.parts {
                        match part {
                            crate::cost::CostPart::Exert {
                                amount,
                                type_filter,
                            } => {
                                let amount_n = amount.resolve(game, attacker, active);
                                optional_exert_by_attacker
                                    .entry(attacker)
                                    .or_default()
                                    .push((amount_n, type_filter));
                            }
                            crate::cost::CostPart::Enlist {
                                amount,
                                type_filter,
                            } => {
                                let amount_n = amount.resolve(game, attacker, active);
                                optional_enlist_by_attacker
                                    .entry(attacker)
                                    .or_default()
                                    .push((amount_n, type_filter));
                            }
                            _ => {}
                        }
                    }
                }
            }

            let possible_exerters: Vec<CardId> = declared_attackers
                .iter()
                .copied()
                .filter(|cid| optional_exert_by_attacker.contains_key(cid))
                .collect();
            if !possible_exerters.is_empty() {
                let chosen = agents[active.index()].exert_attackers(active, &possible_exerters);
                for attacker in chosen {
                    // Exert is paid unconditionally once chosen via exert_attackers
                    // (mirrors HumanPlay.payCostDuringAbilityResolve's CostExert case).
                    if let Some(parts) = optional_exert_by_attacker.get(&attacker).cloned() {
                        for (resolved, type_filter) in parts {
                            if resolved > 0 {
                                self.pay_exert_cost(
                                    game,
                                    agents,
                                    active,
                                    attacker,
                                    &type_filter,
                                    resolved,
                                );
                            }
                        }
                    }
                }
            }

            // Re-check enlist targets AFTER exert loop — exerting taps creatures,
            // which can invalidate enlist candidates.
            let enlist_can_pay = !crate::cost::get_enlist_targets(game, active).is_empty();
            let possible_enlisters: Vec<CardId> = if enlist_can_pay {
                declared_attackers
                    .iter()
                    .copied()
                    .filter(|cid| optional_enlist_by_attacker.contains_key(cid))
                    .collect()
            } else {
                Vec::new()
            };

            if !possible_enlisters.is_empty() {
                let chosen = agents[active.index()].enlist_attackers(active, &possible_enlisters);
                for attacker in chosen {
                    if let Some(parts) = optional_enlist_by_attacker.get(&attacker).cloned() {
                        for (resolved, type_filter) in parts {
                            if resolved > 0 {
                                self.pay_enlist_cost(
                                    game,
                                    agents,
                                    active,
                                    attacker,
                                    &type_filter,
                                    resolved,
                                );
                            }
                        }
                    }
                }
            }
        }

        // Check attack costs (Propaganda, Ghostly Prison effects)
        {
            let mut cost_failures = Vec::new();
            for &(attacker_id, defender) in &chosen_attackers {
                let cost = combat::attack_cost::get_attack_cost(
                    &game.cards,
                    game.card(attacker_id),
                    defender,
                );
                if cost > 0 {
                    let controller = game.card(attacker_id).controller;
                    let attacker_name = game.card(attacker_id).card_name.clone();
                    let description = format!("Pay {{{}}} to attack with {}", cost, attacker_name);

                    // Loop: let the agent tap lands / pay / decline
                    loop {
                        let tappable_lands = self.get_tappable_lands(game, controller);
                        let pool_snapshot = self.pool(controller).clone();
                        let untappable_lands =
                            self.get_untappable_lands(game, controller, &pool_snapshot);
                        let pool_total = self.pool(controller).total_mana();

                        agents[controller.index()].snapshot_state(game, &self.mana_pools);
                        let action = agents[controller.index()].pay_combat_cost(
                            controller,
                            attacker_id,
                            cost,
                            &description,
                            &tappable_lands,
                            &untappable_lands,
                            pool_total,
                        );

                        match action {
                            CombatCostAction::TapLand(land_id) => {
                                if !tappable_lands.contains(&land_id) {
                                    continue;
                                }
                                let undo_record =
                                    self.begin_mana_undo_action(game, controller, land_id);
                                let pool_snapshot = self.pool(controller).begin_tap_tracking();
                                // Use actual mana ability when available
                                let mana_ab = {
                                    let c = game.card(land_id);
                                    c.activated_abilities
                                        .iter()
                                        .find(|ab| ab.is_mana_ability)
                                        .cloned()
                                };
                                if let Some(ab) = mana_ab {
                                    self.with_shared_state_mutation(
                                        game,
                                        agents,
                                        |this, game, agents| {
                                            this.resolve_mana_ability(
                                                game, agents, controller, land_id, &ab, None,
                                            );
                                        },
                                    );
                                } else {
                                    let atom_opt = {
                                        let c = game.card(land_id);
                                        if c.is_land() && !c.tapped {
                                            basic_land_mana_atom(c)
                                        } else {
                                            None
                                        }
                                    };
                                    if let Some(atom) = atom_opt {
                                        game.tap(land_id);
                                        self.pool_mut(controller).add(atom, 1);
                                        self.trigger_handler.run_trigger(
                                            TriggerType::Taps,
                                            RunParams {
                                                card: Some(land_id),
                                                player: Some(controller),
                                                ..Default::default()
                                            },
                                            false,
                                        );
                                        self.trigger_handler.run_trigger(
                                            TriggerType::TapsForMana,
                                            RunParams {
                                                card: Some(land_id),
                                                player: Some(controller),
                                                ..Default::default()
                                            },
                                            false,
                                        );
                                    }
                                }
                                let produced =
                                    self.pool(controller).end_tap_tracking(&pool_snapshot);
                                self.finish_mana_undo_action(undo_record, produced.len());
                            }
                            CombatCostAction::UntapLand(land_id) => {
                                if !untappable_lands.contains(&land_id) {
                                    continue;
                                }
                                self.undo_mana_action(game, controller, land_id);
                            }
                            CombatCostAction::Pay => {
                                self.invalidate_mana_undo_for_player(controller);
                                let pool = &mut self.mana_pools[controller.index()];
                                if pool.total_mana() >= cost {
                                    pool.spend_generic(cost);
                                    // Successfully paid
                                } else {
                                    // Not enough mana — treat as decline
                                    cost_failures.push(attacker_id);
                                }
                                break;
                            }
                            CombatCostAction::Decline => {
                                self.invalidate_mana_undo_for_player(controller);
                                cost_failures.push(attacker_id);
                                break;
                            }
                        }
                    }
                }
            }
            chosen_attackers.retain(|(id, _)| !cost_failures.contains(id));
        }

        // Undo temporary attack markers for attackers removed by cost payment.
        for &(attacker_id, _) in &premarked_attackers {
            if !chosen_attackers.iter().any(|(id, _)| *id == attacker_id) {
                game.card_mut(attacker_id).clear_attacking_player();
                if !game.card(attacker_id).has_vigilance() {
                    game.card_mut(attacker_id).set_tapped(false);
                }
            }
        }

        if !chosen_attackers.is_empty() {
            crate::agent::notify_all_agents(
                agents,
                crate::agent::GameLogEvent::action("Combat phase begins").with_player(active),
            );
            let attackers_msg = chosen_attackers
                .iter()
                .map(|(attacker_id, defender)| {
                    let attacker_name = game.card(*attacker_id).card_name.clone();
                    let defender_name = match defender {
                        combat::DefenderId::Player(pid) => game.player(*pid).name.clone(),
                        combat::DefenderId::Permanent(cid) => game.card(*cid).card_name.clone(),
                    };
                    format!("{attacker_name} -> {defender_name}")
                })
                .collect::<Vec<_>>()
                .join(", ");
            crate::agent::notify_all_agents(
                agents,
                crate::agent::GameLogEvent::action(format!("Attackers: {attackers_msg}"))
                    .with_player(active),
            );
        }

        // Tap attackers (Vigilance skips tapping)
        let num_attackers = chosen_attackers.len() as i32;
        game.player_attack_combat_reset(active);
        for &(attacker_id, defender) in &chosen_attackers {
            if !game.card(attacker_id).has_vigilance() {
                // We pre-tapped attackers before OptionalAttackCost resolution to
                // mirror Java legality checks; untap first so this tap emits the
                // declaration-time Taps trigger once.
                if game.card(attacker_id).tapped {
                    game.untap(attacker_id);
                }
                game.tap(attacker_id);
                // Java attacker.tap(...) emits Taps triggers when a creature becomes tapped
                // as part of attacker declaration.
                self.trigger_handler.run_trigger(
                    TriggerType::Taps,
                    RunParams {
                        card: Some(attacker_id),
                        player: Some(active),
                        ..Default::default()
                    },
                    false,
                );
            }
            game.card_mut(attacker_id).mark_attacked_this_turn();
            // Set attacking_player to the controlling player of the defender
            let def_player = defender.controlling_player(game);
            game.card_mut(attacker_id).set_attacking_player(def_player);
            self.combat.declare_attacker(
                attacker_id,
                defender,
                game.card(attacker_id).zone_timestamp,
            );

            // Record attack in damage history
            game.card_mut(attacker_id)
                .damage_history
                .record_attack(num_attackers - 1);
            game.card_mut(attacker_id)
                .damage_history
                .set_creature_attacked_this_combat(
                    Some(match defender {
                        combat::DefenderId::Player(pid) => TrackedEntity::Player(pid),
                        combat::DefenderId::Permanent(cid) => TrackedEntity::Card(cid),
                    }),
                    num_attackers - 1,
                    matches!(defender, combat::DefenderId::Permanent(_)),
                );
            if let combat::DefenderId::Player(pid) = defender {
                if !game
                    .player(active)
                    .attacked_players_this_turn
                    .contains(&pid)
                {
                    game.player_record_attacked_player(active, pid);
                }
                if !game
                    .player(active)
                    .attacked_players_this_combat
                    .contains(&pid)
                {
                    game.player_record_attacked_player(active, pid);
                }
            }

            crate::ability::effects::ring_tempts_you_effect::sync_ring_effect(
                game,
                &mut self.trigger_handler,
                active,
            );

            // Fire Attacks trigger for each attacker
            self.trigger_handler.run_trigger(
                TriggerType::Attacks,
                RunParams {
                    attacker: Some(attacker_id),
                    card: Some(attacker_id),
                    defending_player: Some(def_player),
                    num_attackers: Some(num_attackers as usize),
                    ..Default::default()
                },
                false,
            );
        }
        // Fire AttackersDeclaredOneTarget-style batches first, then the aggregate event.
        if !chosen_attackers.is_empty() {
            let mut grouped_attackers: std::collections::HashMap<combat::DefenderId, Vec<CardId>> =
                std::collections::HashMap::new();
            for &(attacker_id, defender) in &chosen_attackers {
                grouped_attackers
                    .entry(defender)
                    .or_default()
                    .push(attacker_id);
            }
            let mut attacked_player_ids = Vec::new();
            let mut attacked_card_ids = Vec::new();
            for (defender, attackers) in &grouped_attackers {
                let mut params = RunParams {
                    attacker_ids: Some(attackers.clone()),
                    player: Some(game.active_player()),
                    attacking_player: Some(game.active_player()),
                    ..Default::default()
                };
                match defender {
                    combat::DefenderId::Player(pid) => {
                        params.attacked_player = Some(*pid);
                        params.defenders_player_ids = Some(vec![*pid]);
                        attacked_player_ids.push(*pid);
                    }
                    combat::DefenderId::Permanent(cid) => {
                        params.attacked_card = Some(*cid);
                        params.defenders_card_ids = Some(vec![*cid]);
                        attacked_card_ids.push(*cid);
                    }
                }
                self.trigger_handler.run_trigger(
                    TriggerType::AttackersDeclaredOneTarget,
                    params,
                    false,
                );
            }

            let attacker_ids: Vec<CardId> = chosen_attackers.iter().map(|(a, _)| *a).collect();
            self.trigger_handler.run_trigger(
                TriggerType::AttackersDeclared,
                RunParams {
                    player: Some(game.active_player()),
                    attacking_player: Some(game.active_player()),
                    attacker_ids: Some(attacker_ids),
                    defenders_player_ids: if attacked_player_ids.is_empty() {
                        None
                    } else {
                        Some(attacked_player_ids)
                    },
                    defenders_card_ids: if attacked_card_ids.is_empty() {
                        None
                    } else {
                        Some(attacked_card_ids)
                    },
                    ..Default::default()
                },
                false,
            );
        }
        // Recompute continuous effects now that `attacking_player` is set on
        // declared attackers.  This allows effects like Watchdog's
        // "Affected$ Creature.attackingYou | AddPower$ -1" to apply correctly.
        apply_continuous_effects(game);
        self.trigger_handler.reset_active_triggers(game);
        // Unfreeze the stack now that attackers are declared.
        game.stack.unfreeze_stack();
        // Java parity: PhaseHandler sets givePriorityToPlayer = inCombat() after
        // declare attackers. In Java, inCombat() returns `combat != null` (true
        // whenever the combat object exists, regardless of whether attackers were
        // declared), so priority is always given here.
        self.step_with_priority(game, agents, false);
        if game.game_over {
            self.combat.clear_with_cards(&mut game.cards);
            return;
        }

        // Java parity: PhaseHandler still advances into COMBAT_DECLARE_BLOCKERS
        // even when it will be skipped due to no attackers.
        self.combat.remove_absent_combatants(&game.cards);
        if !self.combat.has_attackers() {
            self.set_phase(game, agents, PhaseType::CombatDeclareBlockers);
        }
        if self.combat.has_attackers() {
            // Run DeclareBlocker replacement effects before declaring blockers.
            {
                use crate::replacement::replacement_handler::{
                    apply_replacements, ReplacementEvent,
                };
                use crate::replacement::ReplacementResult;
                let mut event = ReplacementEvent::DeclareBlocker { player: defending };
                let result = apply_replacements(game, &mut event);
                if result == ReplacementResult::Skipped || result == ReplacementResult::Replaced {
                    // Blockers phase was prevented — skip to damage
                }
            }

            // Declare Blockers — freeze the stack during declarations.
            game.stack.freeze_stack();
            self.set_phase(game, agents, PhaseType::CombatDeclareBlockers);
            let attacker_card_ids: Vec<CardId> =
                self.combat.attackers.iter().map(|(a, _)| *a).collect();
            let available_blockers = combat::get_available_blockers(game, defending);
            let legal_blockers =
                combat::filter_legal_blockers(game, &attacker_card_ids, &available_blockers);
            let has_any_legal_blocker = !legal_blockers.is_empty();

            if has_any_legal_blocker {
                agents[defending.index()].snapshot_state(game, &self.mana_pools);
                self.game_log.log(
                    GameLogEntryType::PriorityWaiting,
                    2,
                    format!(
                        "Waiting for {} blocker declaration",
                        game.player(defending).name
                    ),
                );
                let max_blockers = {
                    let raw =
                        crate::staticability::static_ability_block_restrict::block_restrict_num(
                            &game.cards,
                            defending,
                        );
                    if raw < i32::MAX {
                        Some(raw as usize)
                    } else {
                        None
                    }
                };
                let mut chosen_blockers = {
                    let def_agent = &mut agents[defending.index()];
                    def_agent.choose_blockers(
                        defending,
                        &attacker_card_ids,
                        &available_blockers,
                        max_blockers,
                    )
                };
                if self.apply_pending_snapshot_restore(game, agents) {
                    return;
                }
                // Ignore duplicate blocker assignments; first assignment wins.
                let mut seen_blockers = std::collections::HashSet::new();
                chosen_blockers.retain(|(blocker, _)| seen_blockers.insert(*blocker));
                self.game_log.log(
                    GameLogEntryType::PriorityResponse,
                    2,
                    format!(
                        "{} declared {} blocker assignment(s)",
                        game.player(defending).name,
                        chosen_blockers.len()
                    ),
                );

                for (blocker, attacker) in chosen_blockers.into_iter() {
                    // Validate: use comprehensive evasion check
                    if !combat::can_creature_block(game, blocker, attacker) {
                        continue; // illegal block
                    }
                    self.combat.declare_blocker(
                        blocker,
                        attacker,
                        game.card(blocker).zone_timestamp,
                    );

                    // Fire Blocks trigger for each (blocker, attacker) pair
                    self.trigger_handler.run_trigger(
                        TriggerType::Blocks,
                        RunParams {
                            blocker: Some(blocker),
                            blocked_attacker: Some(attacker),
                            card: Some(blocker),
                            ..Default::default()
                        },
                        false,
                    );
                }

                // Block cost checking (War Cadence effects)
                {
                    let mut block_cost_failures = Vec::new();
                    for &(blocker_id, attacker_id) in &self.combat.blockers {
                        let cost = combat::block_cost::get_block_cost(
                            &game.cards,
                            game.card(blocker_id),
                            game.card(attacker_id),
                        );
                        if cost > 0 {
                            let controller = game.card(blocker_id).controller;
                            let pool = &mut self.mana_pools[controller.index()];
                            if pool.total_mana() >= cost {
                                pool.spend_generic(cost);
                            } else {
                                block_cost_failures.push(blocker_id);
                            }
                        }
                    }
                    self.combat
                        .blockers
                        .retain(|(b, _)| !block_cost_failures.contains(b));
                }

                // Block validation (Menace, can't block alone)
                let invalid_blocks = combat::validate_blocks(game, &self.combat);
                for (blocker_id, attacker_id) in &invalid_blocks {
                    self.combat
                        .blockers
                        .retain(|(b, a)| !(b == blocker_id && a == attacker_id));
                }

                // Must-block enforcement: auto-assign blockers to required targets
                let all_legal_blockers: Vec<CardId> = available_blockers.clone();
                for &blocker_id in &all_legal_blockers {
                    let must_targets =
                        combat::compute_must_block_targets(game, &self.combat, blocker_id);
                    if must_targets.is_empty() {
                        continue;
                    }
                    let currently_blocking: Vec<CardId> = self
                        .combat
                        .blockers
                        .iter()
                        .filter(|(b, _)| *b == blocker_id)
                        .map(|(_, a)| *a)
                        .collect();
                    if !must_targets.iter().any(|t| currently_blocking.contains(t)) {
                        // Not blocking any required target — force-assign first
                        if combat::can_creature_block(game, blocker_id, must_targets[0]) {
                            self.combat.declare_blocker(
                                blocker_id,
                                must_targets[0],
                                game.card(blocker_id).zone_timestamp,
                            );
                        }
                    }
                }

                // Record damage history for blockers
                for &(blocker_id, attacker_id) in &self.combat.blockers {
                    game.card_mut(blocker_id).damage_history.record_block();
                    game.card_mut(attacker_id)
                        .damage_history
                        .record_got_blocked();
                }

                // Publish finalized blocker assignments for UI snapshots in this combat.
                game.turn.combat_block_assignments = self.combat.blockers.clone();

                if !self.combat.blockers.is_empty() {
                    let blockers_msg = self
                        .combat
                        .blockers
                        .iter()
                        .map(|(blocker_id, attacker_id)| {
                            let blocker_name = game.card(*blocker_id).card_name.clone();
                            let attacker_name = game.card(*attacker_id).card_name.clone();
                            format!("{blocker_name} -> {attacker_name}")
                        })
                        .collect::<Vec<_>>()
                        .join(", ");
                    crate::agent::notify_all_agents(
                        agents,
                        crate::agent::GameLogEvent::action(format!("Blockers: {blockers_msg}"))
                            .with_player(defending),
                    );
                }
            }

            // Auto-order blockers by declaration order — Java's parity
            // harness sets `legacyOrderCombatants = false` so the agent is
            // never prompted (Combat.java:494). Mirror that to keep the RNG
            // and trace aligned with Java.
            for &(attacker_id, _) in &self.combat.attackers.clone() {
                let blockers_for = self.combat.get_blockers_for(attacker_id);
                if blockers_for.len() > 1 {
                    self.combat.damage_order.insert(attacker_id, blockers_for);
                }
            }

            // Unfreeze the stack now that blockers are declared.
            game.stack.unfreeze_stack();

            // Fire BlockersDeclared batch trigger before the priority
            // window so these triggers are on the stack when players
            // receive priority (CR 509.4). Mirrors Java's
            // declareBlockersTurnBasedAction() which fires all block
            // triggers before mainLoopStep() gives priority.
            self.trigger_handler.run_trigger(
                TriggerType::BlockersDeclared,
                RunParams {
                    blocker_ids: Some(self.combat.blockers.iter().map(|(b, _)| *b).collect()),
                    ..Default::default()
                },
                false,
            );

            // Fire AttackerBlocked / AttackerUnblocked triggers
            for &(attacker_id, defender_id) in &self.combat.attackers.clone() {
                if self.combat.is_blocked(attacker_id) {
                    let blockers_for = self.combat.get_blockers_for(attacker_id);
                    self.trigger_handler.run_trigger(
                        TriggerType::AttackerBlocked,
                        RunParams {
                            attacker: Some(attacker_id),
                            card: Some(attacker_id),
                            defending_player: Some(defender_id.controlling_player(game)),
                            ..Default::default()
                        },
                        false,
                    );
                    self.trigger_handler.run_trigger(
                        TriggerType::AttackerBlockedOnce,
                        RunParams {
                            attacker: Some(attacker_id),
                            card: Some(attacker_id),
                            blocker_ids: Some(blockers_for.clone()),
                            defending_player: Some(defender_id.controlling_player(game)),
                            ..Default::default()
                        },
                        false,
                    );
                    for blocker_id in blockers_for {
                        self.trigger_handler.run_trigger(
                            TriggerType::AttackerBlockedByCreature,
                            RunParams {
                                attacker: Some(attacker_id),
                                card: Some(attacker_id),
                                blocker: Some(blocker_id),
                                blocked_attacker: Some(attacker_id),
                                defending_player: Some(defender_id.controlling_player(game)),
                                ..Default::default()
                            },
                            false,
                        );
                    }
                } else {
                    self.trigger_handler.run_trigger(
                        TriggerType::AttackerUnblocked,
                        RunParams {
                            attacker: Some(attacker_id),
                            card: Some(attacker_id),
                            ..Default::default()
                        },
                        false,
                    );
                    self.trigger_handler.run_trigger(
                        TriggerType::AttackerUnblockedOnce,
                        RunParams {
                            attacker: Some(attacker_id),
                            card: Some(attacker_id),
                            ..Default::default()
                        },
                        false,
                    );
                }
            }

            self.step_with_priority(game, agents, false);
            if game.game_over {
                self.combat.clear_with_cards(&mut game.cards);
                game.turn.combat_block_assignments.clear();
                return;
            }
        }

        // Java parity: combatants may leave/re-enter during declare blockers
        // priority (e.g. sacrificing an attacker). Re-prune before damage.
        self.combat.remove_absent_combatants(&game.cards);

        // Pre-populate LKI cache for all combat participants so that if a
        // creature dies during damage, its combat role is already recorded.
        for &(attacker_id, _) in &self.combat.attackers.clone() {
            self.combat.save_lki(attacker_id);
        }
        for &(blocker_id, _) in &self.combat.blockers.clone() {
            self.combat.save_lki(blocker_id);
        }

        self.set_phase(game, agents, PhaseType::CombatFirstStrikeDamage);
        self.combat.remove_absent_combatants(&game.cards);
        if self.combat.has_attackers() {
            // LKI: Snapshot battlefield state before first strike damage.
            // Mirrors Java's Game.copyLastState() called before damage resolution.
            game.copy_last_state();

            let fs_unblocked_choices = self.choose_assign_as_unblocked(game, agents, true);
            let fs_events =
                self.combat
                    .resolve_damage_step(game, agents, true, &fs_unblocked_choices);
            // Record damage in source damage history for player-targeted combat damage
            for event in &fs_events {
                if event.target_player.is_some() && event.amount > 0 {
                    game.card_mut(event.source)
                        .damage_history
                        .record_damage(event.amount, true);
                }
            }
            let fs_damage_assigned = !fs_events.is_empty();
            self.fire_combat_damage_triggers(&fs_events);
            // Flush triggers before SBA so that triggers from creatures about
            // to die (e.g. enrage) are matched while still on the battlefield.
            self.trigger_handler.flush_waiting_triggers(game);
            // Java parity: skip priority when no first-strike damage assigned.
            if fs_damage_assigned {
                self.step_with_priority(game, agents, false);
            }
            if game.game_over {
                self.combat.clear_with_cards(&mut game.cards);
                game.turn.combat_block_assignments.clear();
                return;
            }
        }

        self.set_phase(game, agents, PhaseType::CombatDamage);
        self.combat.remove_absent_combatants(&game.cards);
        if self.combat.has_attackers() {
            // Run AssignDealDamage replacement effects for each attacker.
            {
                use crate::replacement::replacement_handler::{
                    apply_replacements, ReplacementEvent,
                };
                let attacker_ids: Vec<CardId> =
                    self.combat.attackers.iter().map(|(a, _)| *a).collect();
                for &attacker_id in &attacker_ids {
                    let mut event = ReplacementEvent::AssignDealDamage { card: attacker_id };
                    apply_replacements(game, &mut event);
                }
            }

            // LKI: Snapshot battlefield state before combat damage.
            // Mirrors Java's Game.copyLastState() called before damage resolution.
            game.copy_last_state();

            let unblocked_choices = self.choose_assign_as_unblocked(game, agents, false);
            let dmg_events =
                self.combat
                    .resolve_damage_step(game, agents, false, &unblocked_choices);
            // Record damage in source damage history for player-targeted combat damage
            for event in &dmg_events {
                if event.target_player.is_some() && event.amount > 0 {
                    game.card_mut(event.source)
                        .damage_history
                        .record_damage(event.amount, true);
                }
            }
            // Java parity: skip priority when no damage was actually assigned
            // (e.g. 0-power attackers). Mirrors PhaseHandler.java lines 335-343
            // where assignCombatDamage returns false → givePriorityToPlayer = false.
            let damage_assigned = !dmg_events.is_empty();
            if damage_assigned {
                self.notify_state_changed(game, agents);
            }
            self.fire_combat_damage_triggers(&dmg_events);
            // Flush triggers before SBA so that triggers from creatures about
            // to die (e.g. enrage) are matched while still on the battlefield.
            self.trigger_handler.flush_waiting_triggers(game);
            if damage_assigned {
                self.step_with_priority(game, agents, false);
            }
            if game.game_over {
                self.combat.clear_with_cards(&mut game.cards);
                game.turn.combat_block_assignments.clear();
                return;
            }
        }

        // End combat
        self.set_phase(game, agents, PhaseType::CombatEnd);
        self.emit_phase_trigger(game, PhaseType::CombatEnd);
        // Revert any `ControlGain$ LoseControl$ EndOfCombat` steals (Threaten-
        // style "attack and return").
        crate::ability::effects::control_gain_effect::end_of_combat_hook(game);
        self.step_with_priority(game, agents, false);

        // End-of-combat damage history reset and must_block cleanup
        for card in game.cards.iter_mut() {
            if card.zone == ZoneType::Battlefield && card.is_creature() {
                card.damage_history.end_combat();
                card.must_block = false;
                card.must_block_cards.clear();
            }
        }

        self.combat.clear_with_cards(&mut game.cards);
        game.turn.combat_block_assignments.clear();
        // Recompute continuous effects after combat ends so that stale
        // combat-dependent modifiers (e.g. Watchdog's "creatures attacking you
        // get -1/-0") are cleared.  Without this, static_power_modifier lingers
        // until the next apply_continuous_effects call, causing snapshot drift.
        apply_continuous_effects(game);
        self.trigger_handler.reset_active_triggers(game);
    }

    fn choose_assign_as_unblocked(
        &mut self,
        game: &GameState,
        agents: &mut [Box<dyn PlayerAgent>],
        first_strike_only: bool,
    ) -> std::collections::HashSet<CardId> {
        let mut choices = std::collections::HashSet::new();
        for &(attacker_id, _) in &self.combat.attackers {
            if !self.combat.is_blocked(attacker_id) {
                continue;
            }
            let attacker = game.card(attacker_id);
            let has_fs = attacker.has_first_strike();
            let has_ds = attacker.has_double_strike();
            let deals_in_step = if first_strike_only {
                has_fs || has_ds
            } else {
                !has_fs || has_ds
            };
            if !deals_in_step {
                continue;
            }
            if !crate::staticability::static_ability_assign_combat_damage_as_unblocked::has_optional_assign_as_unblocked(
                &game.cards,
                attacker,
            ) {
                continue;
            }

            let controller = attacker.controller;
            let desc = format!(
                "Have {} assign combat damage as though unblocked?",
                attacker.card_name
            );
            agents[controller.index()].snapshot_state(game, &self.mana_pools);
            if agents[controller.index()].choose_optional_trigger(
                controller,
                &desc,
                Some(attacker_id),
                None,
            ) {
                choices.insert(attacker_id);
            }
        }
        choices
    }
}
