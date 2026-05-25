use super::*;
use crate::player::actions::player_action::STATIC_ALTERNATIVE_ABILITY_INDEX;
use crate::player::actions::{PlayerAction, PlayerActionOutcome};
use crate::player::PlayerController;

impl GameLoop {
    fn describe_priority_action(
        &self,
        game: &GameState,
        action: MainPhaseAction,
        ability_idx: Option<usize>,
    ) -> String {
        let card_name_or_id = |card_id: CardId| -> String {
            game.cards
                .get(card_id.index())
                .map(|c| c.card_name.clone())
                .unwrap_or_else(|| format!("CardId({})", card_id.0))
        };
        match action {
            MainPhaseAction::Pass => "Pass".to_string(),
            MainPhaseAction::Play(play) => {
                format!("Play {}", card_name_or_id(play.card_id))
            }
            MainPhaseAction::ActivateMana(card_id, _) => {
                format!("Activate mana ({})", card_name_or_id(card_id))
            }
            MainPhaseAction::UntapMana(card_id) => {
                format!("Untap mana ({})", card_name_or_id(card_id))
            }
            MainPhaseAction::ActivateAbility(card_id, _) => {
                let idx = ability_idx.unwrap_or_default();
                format!("Activate ability {} ({})", idx, card_name_or_id(card_id))
            }
        }
    }

    pub fn priority_round(
        &mut self,
        game: &mut GameState,
        agents: &mut [Box<dyn PlayerAgent>],
        is_main_phase: bool,
    ) {
        let _perf_scope =
            crate::perf::ParamsLookupScopeGuard::enter(crate::perf::ParamsLookupScope::Priority);
        let mut priority_player = game.active_player();
        let mut last_notified_priority: Option<PlayerId> = None;
        let mut passed_count = 0;
        let num_players = game.players.len();
        while passed_count < num_players {
            if game.game_over {
                return;
            }
            self.with_shared_state_mutation(game, agents, |_this, game, _agents| {
                game.turn.priority_player = priority_player;
            });

            // Java parity: GameEventPlayerPriority is fired before
            // checkStateBasedEffects() / addAllTriggeredAbilitiesToStack().
            if last_notified_priority != Some(priority_player) {
                self.notify_priority_changed(game, agents, priority_player);
                last_notified_priority = Some(priority_player);
            }
            if game.game_over {
                return;
            }

            // Mirrors Java's checkStateBasedEffects():
            //   do { checkStateEffects(); } while (addAllTriggeredAbilitiesToStack());
            // SBA check may cause triggers (e.g. creature dies → death triggers),
            // and processing triggers may cause more SBA (e.g. token creation
            // causing legend rule). Loop until stable.
            loop {
                let sba_changed = super::check_sba(game, &mut self.trigger_handler, agents);
                if game.game_over {
                    return;
                }
                // Process pending triggers and put them on the stack.
                // Mirrors Java's addAllTriggeredAbilitiesToStack() inside
                // checkStateBasedEffects(). This must happen BEFORE the player
                // gets to choose an action, so triggers are already on the stack
                // when the player sees their options.
                let stack_before = game.stack.len();
                self.with_shared_state_mutation(game, agents, |this, game, agents| {
                    this.process_triggers(game, agents);
                });
                let triggers_added = game.stack.len() > stack_before;
                // Keep looping while either SBA changed state or new triggers were added
                if !sba_changed && !triggers_added {
                    break;
                }
            }
            if game.game_over {
                return;
            }

            // ── Fast-forward: skip prompt if player has a standing pass-until ──
            // The declaration is consumed every time. The frontend re-sends it
            // on the next prompt if still auto-passing. Prevents stale
            // declarations from persisting across turns.
            {
                let pass_until = {
                    let agent = agents[priority_player.index()].as_mut();
                    let val = agent.get_pass_until_phase().map(|o| o.map(str::to_owned));
                    agent.clear_pass_until();
                    val
                };
                if let Some(until) = pass_until {
                    let current_phase = game.turn.phase;
                    // Never fast-forward through active combat phases after
                    // attackers are declared. Empty combat may still honor
                    // pass-until stops, including a declare-attackers stop.
                    let has_declared_attackers = self.combat.has_attackers();
                    let is_active_combat = has_declared_attackers
                        && matches!(
                            current_phase,
                            forge_foundation::PhaseType::CombatDeclareAttackers
                                | forge_foundation::PhaseType::CombatDeclareBlockers
                                | forge_foundation::PhaseType::CombatFirstStrikeDamage
                                | forge_foundation::PhaseType::CombatDamage
                                | forge_foundation::PhaseType::CombatEnd
                        );
                    let should_skip = if is_active_combat {
                        false
                    } else if game.stack.is_empty() {
                        match until.as_deref() {
                            // None = atomic single pass, no fast-forward
                            None => false,
                            Some(step_str) => {
                                match forge_foundation::PhaseType::from_step_string(step_str) {
                                    Some(target) => current_phase.is_before(target),
                                    None => false,
                                }
                            }
                        }
                    } else {
                        false
                    };

                    if should_skip {
                        self.log_priority_pass(game, priority_player);
                        passed_count += 1;
                        priority_player = game.next_player(priority_player);
                        self.with_shared_state_mutation(game, agents, |_this, game, _agents| {
                            game.turn.priority_player = priority_player;
                        });
                        continue;
                    }
                }
            }

            let mut action_space = if self.provide_priority_action_space {
                // Refresh continuous static effects before enumerating the
                // action space. Otherwise granted keywords from statics
                // (e.g. Ashling's `AddKeyword$ Evoke:4 | AffectedZone$ Hand`)
                // may be stale when a new card just entered hand or the
                // zone set changed, and the first playability check misses
                // those grants.
                crate::staticability::layer::apply_continuous_effects(game);
                Some(self.action_space(game, priority_player, is_main_phase))
            } else {
                None
            };
            if action_space.as_ref().is_some_and(|space| space.is_empty()) {
                self.invalidate_mana_undo_for_player(priority_player);
                self.log_priority_pass(game, priority_player);
                passed_count += 1;
                priority_player = game.next_player(priority_player);
                self.with_shared_state_mutation(game, agents, |_this, game, _agents| {
                    game.turn.priority_player = priority_player;
                });
                continue;
            }
            self.log_waiting_for_priority(game, priority_player);
            let action = {
                let _perf_scope = crate::perf::ParamsLookupScopeGuard::enter(
                    crate::perf::ParamsLookupScope::PriorityChoice,
                );
                {
                    let _perf_scope = crate::perf::ParamsLookupScopeGuard::enter(
                        crate::perf::ParamsLookupScope::PrioritySnapshot,
                    );
                    crate::perf::increment_priority_snapshot();
                    let agent = agents[priority_player.index()].as_mut();
                    let mut controller = PlayerController::new(game, priority_player, agent);
                    controller.snapshot_state(&self.mana_pools);
                }
                if self.is_aborted() {
                    game.game_over = true;
                    return;
                }
                let mut request_action_space = || {
                    // Refresh continuous static effects before enumerating the
                    // action space. Otherwise granted keywords from statics
                    // (e.g. Ashling's `AddKeyword$ Evoke:4 | AffectedZone$ Hand`)
                    // may be stale when a new card just entered hand or the
                    // zone set changed, and the first playability check misses
                    // those grants.
                    crate::staticability::layer::apply_continuous_effects(game);
                    self.action_space(game, priority_player, is_main_phase)
                };
                agents[priority_player.index()].choose_action(
                    priority_player,
                    action_space.as_ref(),
                    &mut request_action_space,
                )
            };

            // Concede preempts any pending snapshot restore so an in-flight
            // rewind can't block exit. Drop the conceder's pending request
            // so the next iteration doesn't replay it via apply_pending_snapshot_restore.
            if action == PlayerAction::Concede {
                let _ = agents[priority_player.index()].take_restore_request();
                self.with_shared_state_mutation(game, agents, |_this, game, _agents| {
                    crate::player::concede(game, priority_player);
                });
                if game.alive_players().len() > 1 {
                    agents[priority_player.index()].snapshot_state(game, &self.mana_pools);
                    agents[priority_player.index()]
                        .notify(crate::agent::notification::GameNotification::GameOver);
                }
                passed_count = 0;
                priority_player = game.next_player(priority_player);
                self.with_shared_state_mutation(game, agents, |_this, game, _agents| {
                    game.turn.priority_player = priority_player;
                });
                continue;
            }

            if self.apply_pending_snapshot_restore(game, agents) {
                passed_count = 0;
                priority_player = game.turn.priority_player;
                continue;
            }

            let priority_action = if action == PlayerAction::PassPriority {
                MainPhaseAction::Pass
            } else {
                if action_space.is_none() {
                    crate::staticability::layer::apply_continuous_effects(game);
                    action_space = Some(self.action_space(game, priority_player, is_main_phase));
                }
                let action_space = action_space
                    .as_ref()
                    .expect("non-pass priority action requires action space");
                let agent = agents[priority_player.index()].as_mut();
                let mut controller = PlayerController::new(game, priority_player, agent);
                match action.run(
                    &mut controller,
                    &action_space.playable,
                    &action_space.tappable_lands,
                    &action_space.untappable_lands,
                    &action_space.activatable,
                ) {
                    PlayerActionOutcome::Priority(action) => action,
                    PlayerActionOutcome::Pending | PlayerActionOutcome::Target(_) => {
                        crate::agent::notify_all_agents(
                            agents,
                            crate::agent::GameLogEvent::warning(
                                "Illegal action ignored: unsupported priority action",
                            )
                            .with_player(priority_player),
                        );
                        passed_count += 1;
                        priority_player = game.next_player(priority_player);
                        self.with_shared_state_mutation(game, agents, |_this, game, _agents| {
                            game.turn.priority_player = priority_player;
                        });
                        continue;
                    }
                }
            };
            let _perf_scope = crate::perf::ParamsLookupScopeGuard::enter(
                crate::perf::ParamsLookupScope::PriorityExecution,
            );
            match priority_action {
                MainPhaseAction::Pass => {
                    self.invalidate_mana_undo_for_player(priority_player);
                    self.log_priority_pass(game, priority_player);
                    passed_count += 1;
                    priority_player = game.next_player(priority_player);
                    self.with_shared_state_mutation(game, agents, |_this, game, _agents| {
                        game.turn.priority_player = priority_player;
                    });
                }
                MainPhaseAction::Play(play) => {
                    let action_space = action_space
                        .as_ref()
                        .expect("play priority action requires action space");
                    self.invalidate_mana_undo_for_player(priority_player);
                    self.log_priority_response(
                        game,
                        priority_player,
                        &self.describe_priority_action(game, priority_action, None),
                    );
                    if !action_space.playable.contains(&play) {
                        crate::agent::notify_all_agents(
                            agents,
                            crate::agent::GameLogEvent::warning(
                                "Illegal action ignored: unplayable card",
                            )
                            .with_player(priority_player),
                        );
                        passed_count += 1;
                        priority_player = game.next_player(priority_player);
                        self.with_shared_state_mutation(game, agents, |_this, game, _agents| {
                            game.turn.priority_player = priority_player;
                        });
                        continue;
                    }

                    // Room UnlockDoor: route through the activated-ability branch of
                    // play_spell_ability. Java models this as a StaticAbilityApiBased.
                    if play.mode == crate::agent::PlayCardMode::UnlockDoor {
                        let unlock_ab_idx = game
                            .card(play.card_id)
                            .activated_abilities
                            .iter()
                            .find(|ab| ab.is_unlock_door)
                            .map(|ab| ab.ability_index);
                        if let Some(ability_idx) = unlock_ab_idx {
                            let played = self.with_shared_state_mutation(
                                game,
                                agents,
                                |this, game, agents| {
                                    let ability_text = game
                                        .card(play.card_id)
                                        .activated_abilities
                                        .iter()
                                        .find(|ab| ab.ability_index == ability_idx)
                                        .map(|ab| ab.ability_text.clone())?;
                                    let mut sa = crate::spellability::build_spell_ability(
                                        game,
                                        play.card_id,
                                        &ability_text,
                                        priority_player,
                                    );
                                    sa.is_activated = true;
                                    this.play_spell_ability(
                                        game,
                                        agents,
                                        priority_player,
                                        PreparedSpellAbility {
                                            spell_ability: sa,
                                            activated_ability_index: Some(ability_idx),
                                            static_alternative_cost_prepared: false,
                                        },
                                    )
                                },
                            );
                            if played.is_some() {
                                self.with_shared_state_mutation(
                                    game,
                                    agents,
                                    |this, game, agents| {
                                        this.process_triggers(game, agents);
                                    },
                                );
                                passed_count = 0;
                            }
                            // Whether activated or not, skip the normal play_card path
                            continue;
                        }
                    }

                    let played =
                        self.with_shared_state_mutation(game, agents, |this, game, agents| {
                            let card_name = game.card(play.card_id).card_name.clone();
                            if game.card(play.card_id).is_land()
                                || play.mode == crate::agent::PlayCardMode::BackFaceLand
                            {
                                this.play_land(
                                    game,
                                    agents,
                                    priority_player,
                                    play.card_id,
                                    &card_name,
                                    play.mode,
                                )
                                .map(|(card_id, card_name)| PlaySpellAbilityResult::CardPlayed {
                                    card_id,
                                    card_name,
                                })
                            } else if let Some(result) = this.play_special_card_action(
                                game,
                                agents,
                                priority_player,
                                play.card_id,
                                play.mode,
                            ) {
                                result.map(|(card_id, card_name)| {
                                    PlaySpellAbilityResult::CardPlayed { card_id, card_name }
                                })
                            } else {
                                let prepared = this.prepare_card_spell_ability(
                                    game,
                                    priority_player,
                                    play.card_id,
                                    play,
                                )?;
                                this.play_spell_ability(game, agents, priority_player, prepared)
                            }
                        });
                    if let Some(PlaySpellAbilityResult::CardPlayed {
                        card_id: played_id,
                        card_name: played_name,
                    }) = played
                    {
                        let set_code = game.card(played_id).set_code.clone().unwrap_or_default();
                        for agent in agents.iter_mut() {
                            agent.snapshot_state(game, &self.mana_pools);
                            agent.notify(
                                crate::agent::notification::GameNotification::CardPlayed {
                                    player: priority_player,
                                    card_id: played_id,
                                    card_name: played_name.clone(),
                                    set_code: set_code.clone(),
                                },
                            );
                        }
                        // Process SpellCast / BecomesTarget triggers immediately so they
                        // go on the stack ABOVE the spell (resolving before it).
                        // Mirrors Java's MagicStack.addAndUnfreeze() which runs waiting
                        // triggers right after the spell is placed on the stack.
                        self.with_shared_state_mutation(game, agents, |this, game, agents| {
                            this.process_triggers(game, agents);
                        });
                        passed_count = 0;
                    } else {
                        crate::agent::notify_all_agents(
                            agents,
                            crate::agent::GameLogEvent::warning("Card play failed")
                                .with_player(priority_player),
                        );
                    }
                }
                MainPhaseAction::ActivateMana(land_id, requested_ability_idx) => {
                    let action_space = action_space
                        .as_ref()
                        .expect("mana priority action requires action space");
                    self.log_priority_response(
                        game,
                        priority_player,
                        &self.describe_priority_action(game, priority_action, None),
                    );
                    if !action_space.tappable_lands.contains(&land_id) {
                        crate::agent::notify_all_agents(
                            agents,
                            crate::agent::GameLogEvent::warning(
                                "Illegal action ignored: permanent can't tap for mana",
                            )
                            .with_player(priority_player),
                        );
                        passed_count += 1;
                        priority_player = game.next_player(priority_player);
                        self.with_shared_state_mutation(game, agents, |_this, game, _agents| {
                            game.turn.priority_player = priority_player;
                        });
                        continue;
                    }
                    let undo_record = self.begin_mana_undo_action(game, priority_player, land_id);
                    let pool_snapshot = self.pool(priority_player).begin_tap_tracking();

                    let mana_abs: Vec<_> = {
                        let c = game.card(land_id);
                        c.activated_abilities
                            .iter()
                            .filter(|ab| ab.is_mana_ability)
                            .cloned()
                            .collect()
                    };
                    if !mana_abs.is_empty() {
                        // Separate tap-cost mana abilities from non-tap-cost ones.
                        // Dual lands (e.g. Breeding Pool = Forest Island) generate
                        // separate {T}: Add {G} and {T}: Add {U} abilities.  The
                        // player must choose ONE; we must not fire both.
                        let (tap_abs, non_tap_abs): (Vec<_>, Vec<_>) =
                            mana_abs.iter().partition(|ab| {
                                ab.cost
                                    .parts
                                    .iter()
                                    .any(|p| matches!(p, crate::cost::CostPart::Tap))
                            });

                        let chosen_ab: Option<crate::ability::activated::ActivatedAbility> =
                            if let Some(req_idx) = requested_ability_idx {
                                tap_abs
                                    .iter()
                                    .chain(non_tap_abs.iter())
                                    .find(|ab| ab.ability_index == req_idx)
                                    .map(|ab| (*ab).clone())
                            } else if tap_abs.len() <= 1 {
                                tap_abs.first().map(|ab| (*ab).clone()).or_else(|| {
                                    if non_tap_abs.len() == 1 {
                                        Some((*non_tap_abs[0]).clone())
                                    } else {
                                        None
                                    }
                                })
                            } else {
                                // Multiple tap-cost abilities — ask the player to choose a color.
                                let mut color_options: Vec<(String, usize)> = Vec::new();
                                for (i, ab) in tap_abs.iter().enumerate() {
                                    if let Some(produced_ir) = ab.produced_ir.as_ref() {
                                        let chosen_colors =
                                            game.card(land_id).chosen_colors.clone();
                                        let names = produced_ir.to_color_names(&chosen_colors);
                                        for name in names {
                                            if !color_options.iter().any(|(n, _)| *n == name) {
                                                color_options.push((name, i));
                                            }
                                        }
                                    }
                                }
                                let color_names: Vec<String> =
                                    color_options.iter().map(|(n, _)| n.clone()).collect();
                                let chosen_idx = if color_names.len() == 1 {
                                    Some(0usize)
                                } else {
                                    agents[priority_player.index()]
                                        .choose_color(priority_player, &color_names)
                                        .and_then(|chosen| {
                                            color_options.iter().position(|(n, _)| *n == chosen)
                                        })
                                };
                                chosen_idx.and_then(|ci| {
                                    let (_, ab_idx) = &color_options[ci];
                                    tap_abs.get(*ab_idx).map(|ab| (*ab).clone())
                                })
                            };

                        let chosen_idx = chosen_ab.as_ref().map(|ab| ab.ability_index);
                        let chosen_is_tap = chosen_ab
                            .as_ref()
                            .map(|ab| {
                                ab.cost
                                    .parts
                                    .iter()
                                    .any(|p| matches!(p, crate::cost::CostPart::Tap))
                            })
                            .unwrap_or(false);

                        if let Some(ab) = chosen_ab {
                            self.with_shared_state_mutation(game, agents, |this, game, agents| {
                                this.resolve_mana_ability(
                                    game,
                                    agents,
                                    priority_player,
                                    land_id,
                                    &ab,
                                    None,
                                );
                            });
                        }

                        if chosen_is_tap {
                            for ab in &non_tap_abs {
                                if Some(ab.ability_index) == chosen_idx {
                                    continue;
                                }
                                if !ab.cost.parts.is_empty() {
                                    continue;
                                }
                                let ab = (*ab).clone();
                                self.with_shared_state_mutation(
                                    game,
                                    agents,
                                    |this, game, agents| {
                                        this.resolve_mana_ability(
                                            game,
                                            agents,
                                            priority_player,
                                            land_id,
                                            &ab,
                                            None,
                                        );
                                    },
                                );
                            }
                        }
                    } else {
                        // Legacy fallback for lands with no parsed mana abilities
                        self.with_shared_state_mutation(game, agents, |this, game, agents| {
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
                                this.pool_mut(priority_player).add(atom, 1);
                                this.trigger_handler.run_trigger(
                                    TriggerType::Taps,
                                    RunParams {
                                        card: Some(land_id),
                                        player: Some(priority_player),
                                        ..Default::default()
                                    },
                                    false,
                                );
                                this.trigger_handler.run_trigger(
                                    TriggerType::TapsForMana,
                                    RunParams {
                                        card: Some(land_id),
                                        player: Some(priority_player),
                                        ..Default::default()
                                    },
                                    false,
                                );
                                // Resolve mana triggers inline (e.g. Utopia Sprawl).
                                let pending = this.trigger_handler.run_waiting_triggers(game);
                                if !pending.is_empty() {
                                    this.mark_mana_undo_disqualified();
                                }
                                for pt in pending {
                                    this.resolve_single_effect(
                                        game,
                                        agents,
                                        &pt.entry.spell_ability,
                                        None,
                                    );
                                }
                            }
                        });
                    }

                    // Record ALL mana produced by this tap for rollback — single snapshot
                    // covers base ability + granted abilities + aura triggers.
                    let produced = self.pool(priority_player).end_tap_tracking(&pool_snapshot);
                    let produced_count = produced.len();
                    if !produced.is_empty() {
                        self.with_shared_state_mutation(game, agents, |_this, game, _agents| {
                            game.card_mut(land_id).last_mana_produced = Some(produced);
                        });
                    }
                    self.finish_mana_undo_action(undo_record, produced_count);
                    passed_count = 0;
                }
                MainPhaseAction::UntapMana(land_id) => {
                    let action_space = action_space
                        .as_ref()
                        .expect("mana undo priority action requires action space");
                    self.log_priority_response(
                        game,
                        priority_player,
                        &self.describe_priority_action(game, priority_action, None),
                    );
                    if !action_space.untappable_lands.contains(&land_id) {
                        crate::agent::notify_all_agents(
                            agents,
                            crate::agent::GameLogEvent::warning(
                                "Illegal action ignored: land can't be untapped for mana rollback",
                            )
                            .with_player(priority_player),
                        );
                        passed_count += 1;
                        priority_player = game.next_player(priority_player);
                        self.with_shared_state_mutation(game, agents, |_this, game, _agents| {
                            game.turn.priority_player = priority_player;
                        });
                        continue;
                    }
                    self.with_shared_state_mutation(game, agents, |this, game, _agents| {
                        this.undo_mana_action(game, priority_player, land_id);
                    });
                    passed_count = 0;
                }
                MainPhaseAction::ActivateAbility(card_id, ability_idx) => {
                    let action_space = action_space
                        .as_ref()
                        .expect("ability priority action requires action space");
                    self.invalidate_mana_undo_for_player(priority_player);
                    self.log_priority_response(
                        game,
                        priority_player,
                        &self.describe_priority_action(game, priority_action, Some(ability_idx)),
                    );
                    if !action_space.activatable.contains(&(card_id, ability_idx)) {
                        crate::agent::notify_all_agents(
                            agents,
                            crate::agent::GameLogEvent::warning(
                                "Illegal action ignored: ability not activatable",
                            )
                            .with_player(priority_player),
                        );
                        passed_count += 1;
                        priority_player = game.next_player(priority_player);
                        self.with_shared_state_mutation(game, agents, |_this, game, _agents| {
                            game.turn.priority_player = priority_player;
                        });
                        continue;
                    }
                    let activated =
                        self.with_shared_state_mutation(game, agents, |this, game, agents| {
                            if ability_idx == STATIC_ALTERNATIVE_ABILITY_INDEX {
                                let can_play_sorcery = is_main_phase
                                    && priority_player == game.active_player()
                                    && game.stack.is_empty();
                                let (ab, sa) = this.prepare_static_alternative_activated_ability(
                                    game,
                                    priority_player,
                                    card_id,
                                    can_play_sorcery,
                                )?;
                                return this
                                    .play_prepared_activated_ability_on_stack(
                                        game,
                                        agents,
                                        priority_player,
                                        card_id,
                                        &ab,
                                        sa,
                                    )
                                    .then_some(PlaySpellAbilityResult::AbilityActivated);
                            }
                            let ability_text = game
                                .card(card_id)
                                .activated_abilities
                                .iter()
                                .find(|ab| ab.ability_index == ability_idx)
                                .map(|ab| ab.ability_text.clone())?;
                            let mut sa = crate::spellability::build_spell_ability(
                                game,
                                card_id,
                                &ability_text,
                                priority_player,
                            );
                            sa.is_activated = true;
                            this.play_spell_ability(
                                game,
                                agents,
                                priority_player,
                                PreparedSpellAbility {
                                    spell_ability: sa,
                                    activated_ability_index: Some(ability_idx),
                                    static_alternative_cost_prepared: false,
                                },
                            )
                        });
                    if activated.is_some() {
                        // Process triggers immediately after ability activation so
                        // they go on the stack above the ability (mirroring the
                        // Play arm and Java's addAndUnfreeze behaviour).
                        self.with_shared_state_mutation(game, agents, |this, game, agents| {
                            this.process_triggers(game, agents);
                        });
                        passed_count = 0;
                    }
                }
            }
        }
        self.with_shared_state_mutation(game, agents, |_this, game, _agents| {
            game.turn.priority_player = game.active_player();
        });
    }
}
