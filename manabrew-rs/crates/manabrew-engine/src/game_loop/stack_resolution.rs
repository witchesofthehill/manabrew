use super::cost_payment::CostPaymentContext;
use super::*;
use crate::replacement::replacement_handler::apply_moved_replacement;
use crate::spellability::TargetKind;

impl GameLoop {
    fn trigger_cost_after_effect(sa: &SpellAbility) -> bool {
        if sa.api != Some(crate::ability::api_type::ApiType::Draw) {
            return false;
        }
        let Some(cost) = sa.pay_costs.as_ref() else {
            return false;
        };
        cost.parts.iter().any(|part| {
            matches!(
                part,
                crate::cost::CostPart::Discard { type_filter, .. }
                    if type_filter == "Card"
            )
        }) && !cost.parts.iter().any(|part| {
            matches!(
                part,
                crate::cost::CostPart::Discard { type_filter, .. }
                    if type_filter == "Hand"
            ) || matches!(part, crate::cost::CostPart::Mana { .. })
        })
    }

    fn effect_kind_for_sa(sa: &SpellAbility) -> String {
        if let Some(api) = sa.api {
            return api.name().to_string();
        }
        if sa.is_trigger {
            if let Some(mode) = sa.ir.mode.as_ref() {
                return format!("Trigger({mode})");
            }
            return "Trigger".to_string();
        }
        if sa.is_activated {
            return "ActivatedAbility".to_string();
        }
        if sa.is_spell {
            return "Spell".to_string();
        }
        "Effect".to_string()
    }

    pub fn resolve_stack(&mut self, game: &mut GameState, agents: &mut [Box<dyn PlayerAgent>]) {
        let _perf_scope = crate::perf::ParamsLookupScopeGuard::enter(
            crate::perf::ParamsLookupScope::StackResolution,
        );
        if game.stack.is_empty() {
            return;
        }

        if std::env::var("FORGE_STACK_TRACE").is_ok() {
            let names: Vec<String> = game
                .stack
                .iter()
                .map(|entry| {
                    entry
                        .spell_ability
                        .source
                        .map(|cid| game.card(cid).card_name.clone())
                        .unwrap_or_else(|| "<effect>".to_string())
                })
                .collect();
            eprintln!(
                "[stack-trace] RESOLVE start phase={:?} active={:?} priority={:?} depth={} {:?}",
                game.turn.phase,
                game.active_player(),
                game.turn.priority_player,
                game.stack.len(),
                names
            );
        }

        // LKI: Snapshot battlefield state before resolution.
        // Mirrors Java MagicStack line 623: game.copyLastState() before resolving.
        game.copy_last_state();

        let mut entry = game.stack.resolve_stack().unwrap();
        let stack_item_name = entry
            .spell_ability
            .source
            .and_then(|cid| game.cards.get(cid.index()).map(|c| c.card_name.clone()))
            .unwrap_or_else(|| "Ability".to_string());
        self.log_stack_resolved_item(&stack_item_name);
        if std::env::var("FORGE_STACK_TRACE").is_ok() {
            eprintln!(
                "[stack-trace] POP resolving={} remaining_depth={}",
                stack_item_name,
                game.stack.len()
            );
        }

        // Copy spells: resolve effect only. CR 707.10 / 111.11 — a copy of a
        // permanent spell becomes a token (`GameAction.changeZone` line 94).
        if entry.spell_ability.is_copy {
            let should_create_token_copy = (entry.is_creature_spell || entry.is_permanent_spell)
                && entry.spell_ability.source.is_some();
            if should_create_token_copy {
                self.resolve_copied_permanent_as_token(game, agents, &entry);
            } else {
                self.resolve_spell_effect(game, agents, &entry);
            }
            crate::perf::increment(crate::perf::Metric::SpellAbilityClones, 3);
            self.trigger_handler.run_trigger(
                TriggerType::AbilityResolves,
                RunParams {
                    card: entry.spell_ability.source,
                    spell_card: entry.spell_ability.source,
                    spell_controller: Some(entry.spell_ability.activating_player),
                    spell_ability: Some(entry.spell_ability.clone()),
                    source_sa: Some(entry.spell_ability.clone()),
                    cause: Some(entry.spell_ability.clone()),
                    cause_card: entry.spell_ability.source,
                    ..Default::default()
                },
                false,
            );
            apply_continuous_effects(game);
            return;
        }

        // Fizzle check — mirrors Java's MagicStack.hasFizzled() (CR 608.2b).
        // A spell or ability is countered by game rules if ALL of its targets
        // are illegal on resolution. Walk the SA chain; if every targeting node
        // has only invalid targets, the whole thing fizzles.
        if std::env::var("FORGE_TRIGGER_TRACE").is_ok() && entry.optional_trigger_decider.is_some()
        {
            eprintln!(
                "[trigger-trace] RESOLVING optional trigger from stack: {} api={:?}",
                stack_item_name, entry.spell_ability.api
            );
        }
        if Self::has_fizzled(&mut entry.spell_ability, game) {
            crate::agent::notify_all_agents(
                agents,
                crate::agent::GameLogEvent::warning(format!(
                    "{} fizzles (all targets invalid)",
                    stack_item_name
                ))
                .with_player(entry.spell_ability.activating_player),
            );
            // CR 608.2b: A countered spell is still put into its owner's
            // graveyard (or exile for flashback/escape). Only triggers and
            // activated abilities have no physical card to move.
            if !entry.spell_ability.is_trigger
                && !entry.spell_ability.is_activated
                && !entry.spell_ability.is_copy
            {
                if let Some(card_id) = entry.spell_ability.source {
                    let owner = game.card(card_id).owner;
                    let dest = if entry.spell_ability.alt_cost
                        == Some(crate::spellability::AlternativeCost::Harmonize)
                    {
                        apply_moved_replacement(game, card_id, ZoneType::Graveyard, Some(agents))
                    } else if entry.spell_ability.alt_cost
                        == Some(crate::spellability::AlternativeCost::Flashback)
                        || entry.spell_ability.alt_cost
                            == Some(crate::spellability::AlternativeCost::Escape)
                    {
                        ZoneType::Exile
                    } else {
                        // Apply Moved replacement WITH agents for proper RNG consumption
                        // (e.g. Rest in Peace + Leyline of the Void both redirecting).
                        apply_moved_replacement(game, card_id, ZoneType::Graveyard, Some(agents))
                    };
                    self.move_card_with_runtime(game, card_id, dest, owner, agents);
                }
            }
            apply_continuous_effects(game);
            return;
        }

        if entry.spell_ability.is_trigger || entry.spell_ability.is_activated {
            // Optional trigger confirmation — mirrors Java's WrappedAbility.resolve()
            // calling confirmTrigger() FIRST, before cost payment or effect resolution.
            // This happens at resolution time, AFTER the trigger has been on the stack
            // and priority has passed.
            if let Some(decider) = entry.optional_trigger_decider {
                let mut description = entry
                    .optional_trigger_description
                    .clone()
                    .unwrap_or_default();
                if let Some(triggered_card_id) = entry
                    .spell_ability
                    .trigger_objects
                    .get(&crate::ability::AbilityKey::Card)
                    .and_then(|s| s.parse::<u32>().ok())
                    .map(crate::ids::CardId)
                {
                    let triggered_name = game.card(triggered_card_id).card_name.clone();
                    if !triggered_name.is_empty() && !description.contains(&triggered_name) {
                        if !description.is_empty() {
                            description.push(' ');
                        }
                        description.push_str(&format!("Triggered by {triggered_name}."));
                    }
                }
                let api = entry.spell_ability.api;
                let accepted = agents[decider.index()].choose_optional_trigger(
                    decider,
                    &description,
                    entry.spell_ability.source,
                    api,
                );
                if !accepted {
                    apply_continuous_effects(game);
                    return;
                }
            }

            let pay_trigger_cost_after_effect = (entry.spell_ability.is_trigger
                || entry.spell_ability.trigger_source.is_some())
                && Self::trigger_cost_after_effect(&entry.spell_ability);
            if (entry.spell_ability.is_trigger || entry.spell_ability.trigger_source.is_some())
                && !pay_trigger_cost_after_effect
            {
                if let Some(cost) = entry.spell_ability.pay_costs.clone() {
                    let player = entry.spell_ability.activating_player;
                    let source = entry.spell_ability.source.unwrap_or(CardId(0));
                    let api = entry.spell_ability.api;
                    let available = crate::mana::calculate_available_mana_excluding(
                        &self.mana_pools[player.index()],
                        game,
                        player,
                        Some(source),
                    );
                    if !crate::cost::can_pay_with_ability(
                        &cost,
                        game,
                        &available,
                        source,
                        player,
                        Some(&entry.spell_ability),
                    ) {
                        apply_continuous_effects(game);
                        return;
                    }
                    if !self.pay_ability_cost(
                        game,
                        agents,
                        player,
                        source,
                        &cost,
                        api,
                        cost.mandatory,
                        CostPaymentContext::TriggerResolve,
                        Some(&mut entry.spell_ability),
                    ) {
                        apply_continuous_effects(game);
                        return;
                    }
                }
            }

            // Triggered/activated ability: resolve the effect
            if let Some(source_id) = entry
                .spell_ability
                .trigger_source
                .or(entry.spell_ability.source)
            {
                game.card_mut(source_id)
                    .add_ability_resolved_for(Some(&entry.spell_ability));
            }
            self.resolve_spell_effect(game, agents, &entry);
            if pay_trigger_cost_after_effect {
                if let Some(cost) = entry.spell_ability.pay_costs.clone() {
                    let player = entry.spell_ability.activating_player;
                    let source = entry.spell_ability.source.unwrap_or(CardId(0));
                    let api = entry.spell_ability.api;
                    let _ = self.pay_ability_cost(
                        game,
                        agents,
                        player,
                        source,
                        &cost,
                        api,
                        cost.mandatory,
                        CostPaymentContext::TriggerResolve,
                        Some(&mut entry.spell_ability),
                    );
                }
            }
            crate::perf::increment(crate::perf::Metric::SpellAbilityClones, 3);
            self.trigger_handler.run_trigger(
                TriggerType::AbilityResolves,
                RunParams {
                    card: entry.spell_ability.source,
                    spell_card: entry.spell_ability.source,
                    spell_controller: Some(entry.spell_ability.activating_player),
                    spell_ability: Some(entry.spell_ability.clone()),
                    source_sa: Some(entry.spell_ability.clone()),
                    cause: Some(entry.spell_ability.clone()),
                    cause_card: entry.spell_ability.source,
                    ..Default::default()
                },
                false,
            );
            // Fire Cycled trigger if this was a cycling ability
            // (mirrors Java MagicStack resolve → Player.addCycled)
            if entry.spell_ability.is_activated {
                let is_cycling = entry
                    .spell_ability
                    .ir
                    .precost_desc
                    .as_deref()
                    .is_some_and(|d| d.to_lowercase().contains("cycling"));
                if is_cycling {
                    if let Some(source_card) = entry.spell_ability.source {
                        self.trigger_handler.run_trigger(
                            TriggerType::Cycled,
                            RunParams {
                                card: Some(source_card),
                                player: Some(entry.spell_ability.activating_player),
                                ..Default::default()
                            },
                            false,
                        );
                    }
                }
            }
        } else if let Some(card_id) = entry.spell_ability.source {
            let alt_cost = entry.spell_ability.alt_cost;
            let player = entry.spell_ability.activating_player;

            if entry.is_creature_spell || entry.is_permanent_spell {
                // Permanent spell: move to battlefield
                let origin = game.card(card_id).zone;

                // Propagate kicked flag to the card so triggers with
                // ValidCard$ Card.Self+kicked can check it after resolution.
                if entry.spell_ability.kicked {
                    game.card_mut(card_id).set_kicked(true);
                }

                // Mirrors Java `GameAction.changeZone()` setting `castFrom` on
                // the resolving spell's host card so `wasCast`/`wasCastByYou`
                // valid filters (e.g. Sunderflock's ETB) see the card as cast.
                // Set BEFORE resolving the ETB so the trigger pickup matches.
                game.card_mut(card_id).cast_from = entry.cast_from_zone;

                // Resolve any ETB effects defined on the card
                self.resolve_spell_effect(game, agents, &entry);
                crate::perf::increment(crate::perf::Metric::SpellAbilityClones, 3);
                self.trigger_handler.run_trigger(
                    TriggerType::AbilityResolves,
                    RunParams {
                        card: Some(card_id),
                        spell_card: Some(card_id),
                        spell_controller: Some(player),
                        spell_ability: Some(entry.spell_ability.clone()),
                        source_sa: Some(entry.spell_ability.clone()),
                        cause: Some(entry.spell_ability.clone()),
                        cause_card: Some(card_id),
                        ..Default::default()
                    },
                    false,
                );

                if origin != ZoneType::Battlefield {
                    self.move_card_with_runtime(
                        game,
                        card_id,
                        ZoneType::Battlefield,
                        player,
                        agents,
                    );
                }

                // Attach aura to its chosen target.
                // Mirrors Java's GameAction.changeZone (line 373-389) which detects
                // an Aura entering from the stack while not-yet-attached and routes
                // through `attachAuraOnIndirectETB`. For *cast* Auras the spell
                // already has a chosen target — narrow the chooser candidates to
                // that single target so the decision-log emits a `pick_one[1]`
                // (matching Java's deterministic behaviour, which only sees the
                // chosen target after the resolution-time filter). Without this
                // narrowing, the candidate enumeration over the full battlefield
                // can include a *second* legendary creature (e.g. a mirror-match
                // Ashling controlled by the opponent), and the agent ends up
                // attaching the Aura to the wrong card.
                if game.card(card_id).type_line.has_subtype("Aura")
                    && game.card(card_id).attached_to.is_none()
                    && game.card(card_id).attached_to_player.is_none()
                {
                    let enchant_type = game
                        .card(card_id)
                        .keywords
                        .iter_strings()
                        .find_map(|kw| crate::keyword::extract_keyword_cost_str(kw, "Enchant"))
                        .unwrap_or_default()
                        .to_string();
                    let normalized = enchant_type
                        .split_once(':')
                        .map(|(k, _)| k)
                        .unwrap_or(&enchant_type);
                    let can_target_player =
                        normalized.starts_with("Player") || normalized.starts_with("Opponent");

                    let mut candidates: Vec<crate::agent::types::GameEntity> = Vec::new();
                    if let Some(target_card) = entry.spell_ability.target_chosen.target_card {
                        // Cast Aura: only the chosen target is a valid attach
                        // target at resolution time. Skip the full enumeration
                        // and offer just that card.
                        if crate::parsing::enchant_type_matches_card(
                            &enchant_type,
                            game.card(target_card),
                            Some(game.card(card_id)),
                        ) && !crate::staticability::static_ability_cant_attach::cant_attach(
                            &game.cards,
                            game.card(card_id),
                            game.card(target_card),
                            false,
                        ) {
                            candidates.push(crate::agent::types::GameEntity::Card(target_card));
                        }
                    } else if let Some(target_player) =
                        entry.spell_ability.target_chosen.target_player
                    {
                        if Self::is_player_target_valid(target_player, game) {
                            candidates.push(crate::agent::types::GameEntity::Player(target_player));
                        }
                    } else if can_target_player {
                        for i in 0..game.players.len() {
                            let p = crate::ids::PlayerId(i as u32);
                            if Self::is_player_target_valid(p, game) {
                                candidates.push(crate::agent::types::GameEntity::Player(p));
                            }
                        }
                    } else {
                        let battlefield: Vec<CardId> =
                            game.cards_in_all_zones(ZoneType::Battlefield).collect();
                        for cid in battlefield {
                            if !crate::parsing::enchant_type_matches_card(
                                &enchant_type,
                                game.card(cid),
                                Some(game.card(card_id)),
                            ) {
                                continue;
                            }
                            if crate::staticability::static_ability_cant_attach::cant_attach(
                                &game.cards,
                                game.card(card_id),
                                game.card(cid),
                                false,
                            ) {
                                continue;
                            }
                            candidates.push(crate::agent::types::GameEntity::Card(cid));
                        }
                    }

                    if !candidates.is_empty() {
                        let chooser = entry.spell_ability.activating_player;
                        let chosen = agents[chooser.index()].choose_single_entity_for_effect(
                            chooser,
                            &candidates,
                            false,
                        );
                        let attached = matches!(
                            chosen,
                            Some(crate::agent::types::GameEntity::Card(_))
                                | Some(crate::agent::types::GameEntity::Player(_))
                        );
                        match chosen {
                            Some(crate::agent::types::GameEntity::Card(c)) => {
                                game.attach_to(card_id, c);
                            }
                            Some(crate::agent::types::GameEntity::Player(p)) => {
                                game.attach_to_player(card_id, p);
                            }
                            None => {}
                        }
                        // Refresh continuous effects so any abilities the Aura
                        // grants its newly enchanted host (e.g. Leyline
                        // Immersion's `AddAbility$ AddMana` granting `{T}: Add
                        // five mana of any combination of colors`) become
                        // visible immediately. Without this, downstream
                        // playability checks in the same priority loop see
                        // the host without the granted ability and may filter
                        // out spells the player should be able to cast.
                        if attached {
                            crate::staticability::layer::apply_continuous_effects(game);
                        }
                    }
                }

                // Evoke: register a one-shot ETB trigger that sacrifices this creature.
                // This mirrors Forge Java semantics where Evoke uses a ChangesZone trigger
                // and allows normal ETB abilities to trigger before the sacrifice resolves.
                // Java parity: `CardFactoryUtil` attaches the "sacrifice when it enters"
                // trigger once per Evoke keyword on the card, not once per cast. A card
                // with both intrinsic `Evoke:1 U` and a granted `Evoke:4` (e.g. an
                // Elemental in hand under Ashling, the Limitless) therefore carries
                // two Evoke sac triggers. All of them fire on ETB; the first sacrifice
                // succeeds and the rest are no-ops because the creature has already
                // left the battlefield, but each one still consumes a stack entry.
                if alt_cost == Some(crate::spellability::AlternativeCost::Evoke) {
                    let evoke_keyword_count =
                        (entry.spell_ability.evoke_keyword_count as usize).max(1);
                    self.register_evoke_sacrifice_triggers(
                        game,
                        card_id,
                        player,
                        evoke_keyword_count,
                    );
                }

                // Register triggers for the new permanent
                self.trigger_handler.register_active_trigger(game, card_id);

                if game.card(card_id).type_line.has_subtype("Room")
                    && game.card(card_id).has_s_var("RoomRightSplitCost")
                {
                    let card_state_name = entry
                        .spell_ability
                        .ir
                        .card_state_name
                        .clone()
                        .or_else(|| Some("LeftSplit".to_string()));
                    self.trigger_handler.run_trigger(
                        TriggerType::UnlockDoor,
                        RunParams {
                            card: Some(card_id),
                            player: Some(player),
                            card_state_name,
                            ..Default::default()
                        },
                        true,
                    );
                }

                // Emit ChangesZone trigger (ETB)
                crate::ability::effects::emit_zone_trigger(
                    &mut self.trigger_handler,
                    card_id,
                    origin,
                    ZoneType::Battlefield,
                );

                // -- Post-ETB effects for alternative costs --

                // Dash: grant haste, register delayed trigger to return to hand at EOT
                if alt_cost == Some(crate::spellability::AlternativeCost::Dash) {
                    game.card_mut(card_id).pump_keywords.add("Haste");
                    self.trigger_handler.register_delayed_trigger(
                        crate::trigger::handler::DelayedTrigger {
                            mode: TriggerType::Phase,
                            trigger_mode: Box::new(crate::trigger::trigger_phase::TriggerPhase {
                                phases: vec![forge_foundation::PhaseType::EndOfTurn],
                                valid_player: None,
                            }) as Box<dyn crate::trigger::TriggerBehavior>,
                            params: crate::parsing::Params::default(),
                            execute_svar: format!(
                                "DB$ ChangeZone | Origin$ Battlefield | Destination$ Hand | Defined$ CardUID_{}", card_id.0
                            ),
                            controller: player,
                            source_card: card_id,
                            created_turn: game.turn.turn_number,
                            created_phase: game.turn.phase,
                            target_card: Some(card_id),
                            remembered_amount: 0,
                            remembered_cards: Vec::new(),
                            remembered_players: Vec::new(),
                            remembered_lki_cards: Vec::new(),
                            sort_after_active: false,
                trigger_order: None,
                        },
                    );
                }

                // Warp: mark card so it can be cast from exile on a later turn,
                // and register delayed trigger to exile at EOT.
                // Mirrors Java PermanentEffect + StaticAbilityCastWithFlash for Warp.
                if alt_cost == Some(crate::spellability::AlternativeCost::Warp) {
                    game.card_mut(card_id)
                        .keywords
                        .add(crate::card::KEYWORD_WARP_EXILED);
                    self.trigger_handler.register_delayed_trigger(
                        crate::trigger::handler::DelayedTrigger {
                            mode: TriggerType::Phase,
                            trigger_mode: Box::new(crate::trigger::trigger_phase::TriggerPhase {
                                phases: vec![forge_foundation::PhaseType::EndOfTurn],
                                valid_player: None,
                            }) as Box<dyn crate::trigger::TriggerBehavior>,
                            params: crate::parsing::Params::default(),
                            execute_svar: format!(
                                "DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | Defined$ CardUID_{}", card_id.0
                            ),
                            controller: player,
                            source_card: card_id,
                            created_turn: game.turn.turn_number,
                            created_phase: game.turn.phase,
                            target_card: Some(card_id),
                            remembered_amount: 0,
                            remembered_cards: Vec::new(),
                            remembered_players: Vec::new(),
                            remembered_lki_cards: Vec::new(),
                            sort_after_active: false,
                trigger_order: None,
                        },
                    );
                }

                // Bestow: attach to a creature as an Aura
                if alt_cost == Some(crate::spellability::AlternativeCost::Bestow) {
                    if let Some(target) = entry.spell_ability.target_chosen.target_card {
                        game.card_mut(card_id).unanimate_bestow();
                        game.attach_to(card_id, target);
                    }
                }

                // Morph/Megamorph: enter face-down as a 2/2 creature
                if alt_cost.is_some_and(|ac| ac.is_morph()) {
                    let is_mega = alt_cost == Some(crate::spellability::AlternativeCost::Megamorph);
                    let c = game.card_mut(card_id);
                    c.set_face_down(true);
                    c.static_set_power = Some(crate::spellability::MORPH_PT);
                    c.static_set_toughness = Some(crate::spellability::MORPH_PT);

                    // Add "turn face up" activated ability (morph cost → SetState TurnFaceUp).
                    // This is a game rule, not a card ability — face-down morph creatures
                    // can always be turned face up by paying the morph cost.
                    let morph_cost = c
                        .get_keyword_cost(if is_mega { "Megamorph" } else { "Morph" })
                        .unwrap_or_else(|| "3".to_string());
                    let mega_param = if is_mega { " | Mega$ True" } else { "" };
                    let ab_text = format!(
                        "AB$ SetState | Cost$ {} | Mode$ TurnFaceUp{}",
                        morph_cost, mega_param
                    );
                    let ab_index = c.activated_abilities.len();
                    if let Some(parsed) =
                        crate::ability::activated::parse_activated_ability(&ab_text, ab_index)
                    {
                        c.activated_abilities.push(parsed);
                    }
                }

                // Blitz: grant haste + "dies: draw a card" + sacrifice at EOT
                if alt_cost == Some(crate::spellability::AlternativeCost::Blitz) {
                    game.card_mut(card_id).pump_keywords.add("Haste");
                    let trig_id = game.card(card_id).triggers.len() as u32;
                    let params = crate::parsing::Params::from_raw(
                        "Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self"
                    );
                    let dies_trigger = crate::trigger::Trigger {
                        id: trig_id,
                        base: {
                            let mut base =
                                crate::game_loop::trigger_replacement_base::TriggerReplacementBase::default();
                            base.card_trait_base.set_id(trig_id as i32);
                            base.card_trait_base.set_intrinsic(false);
                            base.valid_host_zones = Some(vec![ZoneType::Battlefield]);
                            base
                        },
                        kind: crate::trigger::TriggerType::ChangesZone,
                        mode: Box::new(crate::trigger::trigger_changes_zone::TriggerChangesZone),
                        ir: crate::trigger::TriggerIr::from_params(&params),
                        execute: "BlitzDiesDraw".to_string(),
                        optional: false,
                        description: "When this creature dies, draw a card.".to_string(),
                        static_trigger: false,
                        trigger_remembered: Vec::new(),
                        spawning_ability: None,
                    };
                    game.card_mut(card_id).add_trigger(dies_trigger);
                    game.card_mut(card_id)
                        .set_s_var("BlitzDiesDraw", "DB$ Draw | NumCards$ 1 | Defined$ You");
                    self.trigger_handler.unregister_active_triggers(card_id);
                    self.trigger_handler.register_active_trigger(game, card_id);

                    self.trigger_handler.register_delayed_trigger(
                        crate::trigger::handler::DelayedTrigger {
                            mode: TriggerType::Phase,
                            trigger_mode: Box::new(crate::trigger::trigger_phase::TriggerPhase {
                                phases: vec![forge_foundation::PhaseType::EndOfTurn],
                                valid_player: None,
                            })
                                as Box<dyn crate::trigger::TriggerBehavior>,
                            params: crate::parsing::Params::default(),
                            execute_svar: format!("DB$ Sacrifice | Defined$ CardUID_{}", card_id.0),
                            controller: player,
                            source_card: card_id,
                            created_turn: game.turn.turn_number,
                            created_phase: game.turn.phase,
                            target_card: Some(card_id),
                            remembered_amount: 0,
                            remembered_cards: Vec::new(),
                            remembered_players: Vec::new(),
                            remembered_lki_cards: Vec::new(),
                            sort_after_active: false,
                            trigger_order: None,
                        },
                    );
                }
            } else {
                // Non-permanent spell: resolve effect, then route to destination zone
                self.resolve_spell_effect(game, agents, &entry);
                crate::perf::increment(crate::perf::Metric::SpellAbilityClones, 3);
                self.trigger_handler.run_trigger(
                    TriggerType::AbilityResolves,
                    RunParams {
                        card: Some(card_id),
                        spell_card: Some(card_id),
                        spell_controller: Some(player),
                        spell_ability: Some(entry.spell_ability.clone()),
                        source_sa: Some(entry.spell_ability.clone()),
                        cause: Some(entry.spell_ability.clone()),
                        cause_card: Some(card_id),
                        ..Default::default()
                    },
                    false,
                );
                let owner = game.card(card_id).owner;
                // Only move if still in stack zone (some effects move the card themselves)
                if game.card(card_id).zone != ZoneType::Exile
                    && game.card(card_id).zone != ZoneType::Library
                    && game.card(card_id).zone != ZoneType::Hand
                {
                    // Determine destination based on alternative cost / keywords
                    let dest = if alt_cost == Some(crate::spellability::AlternativeCost::Harmonize)
                    {
                        apply_moved_replacement(game, card_id, ZoneType::Graveyard, Some(agents))
                    } else if alt_cost == Some(crate::spellability::AlternativeCost::Flashback)
                        || alt_cost == Some(crate::spellability::AlternativeCost::Escape)
                    {
                        ZoneType::Exile
                    } else if entry.spell_ability.buyback_paid {
                        // Buyback: return to hand instead of graveyard
                        ZoneType::Hand
                    } else if game.card(card_id).has_rebound()
                        && entry.cast_from_zone == Some(ZoneType::Hand)
                    {
                        // Rebound: exile instead of graveyard (will be cast next upkeep)
                        self.trigger_handler.register_delayed_trigger(
                            crate::trigger::handler::DelayedTrigger {
                                mode: TriggerType::Phase,
                                trigger_mode: Box::new(
                                    crate::trigger::trigger_phase::TriggerPhase {
                                        phases: vec![forge_foundation::PhaseType::Upkeep],
                                        valid_player: Some(
                                            crate::parsing::cached_compiled_selector("You"),
                                        ),
                                    },
                                )
                                    as Box<dyn crate::trigger::TriggerBehavior>,
                                params: crate::parsing::Params::default(),
                                execute_svar: format!(
                                    "DB$ Play | Defined$ CardUID_{} | WithoutManaCost$ True",
                                    card_id.0
                                ),
                                controller: player,
                                source_card: card_id,
                                created_turn: game.turn.turn_number,
                                created_phase: game.turn.phase,
                                target_card: Some(card_id),
                                remembered_amount: 0,
                                remembered_cards: Vec::new(),
                                remembered_players: Vec::new(),
                                remembered_lki_cards: Vec::new(),
                                sort_after_active: false,
                                trigger_order: None,
                            },
                        );
                        ZoneType::Exile
                    } else {
                        apply_moved_replacement(game, card_id, ZoneType::Graveyard, Some(agents))
                    };
                    self.move_card_with_runtime(game, card_id, dest, owner, agents);
                }
            }
        }

        // Mark resolution complete on the stack.
        game.stack.finish_resolving();

        // Continuous effects might change after resolution
        apply_continuous_effects(game);

        // LKI: Second snapshot after resolution and SBAs, before processing triggers.
        // Mirrors Java MagicStack line 676: game.copyLastState() in finishResolving().
        // Java does not run SBA here; it defers that to the next priority loop.
        // Keep the snapshot pre-SBA so deep parity aligns with Java's
        // GameEventPlayerPriority boundary.
        game.copy_last_state();

        // Java parity: triggers fired during resolution are queued now and only
        self.trigger_handler.flush_waiting_triggers(game);
    }

    pub(crate) fn resolve_spell_effect(
        &mut self,
        game: &mut GameState,
        agents: &mut [Box<dyn PlayerAgent>],
        entry: &StackEntry,
    ) {
        // Reset shared parity tables for this stack resolution. The
        // change-zone table must exist (not None) so that moves performed
        // during this resolution are recorded for the post-pass
        // `ChangesZoneAll` trigger fire below.
        game.clear_pending_damage_maps();
        game.clear_pending_change_zone_table();
        game.ensure_pending_change_zone_table();

        // Mirrors Java `MagicStack.resolveStack` (MagicStack.java:651-653):
        // call `handleRemembering` on the root SA before resolving so
        // `RememberTargets$` populates the host's remembered lists in time
        // for sub-abilities like `RememberObjects$ RememberedController`.
        crate::ability::ability_utils::handle_remembering(game, &entry.spell_ability);

        // Walk the SpellAbility chain: resolve each node's effect, propagating
        // the parent SA's chosen target card so sub-abilities can resolve
        // `Defined$ ParentTarget`. Mirrors Java's resolveApiAbility() + resolveSubAbilities().
        let mut parent_target_card: Option<CardId> = None;
        let mut parent_target_player = None;
        let mut parent_target_stack_entry: Option<u32> = None;
        let mut inherited_trigger_index = entry.spell_ability.trigger_index;
        let root_kicked = entry.spell_ability.kicked;
        let mut current = Some(&entry.spell_ability);
        let mut is_first = true;
        while let Some(sa) = current {
            // Refresh agent snapshots between sub-abilities so that prompts
            // (e.g. "choose discard") reflect state changes from earlier
            // sub-abilities (e.g. "draw 2" before "discard 2").
            if !is_first {
                for agent in agents.iter_mut() {
                    agent.snapshot_state(game, &self.mana_pools);
                }
            }
            is_first = false;

            // Propagate kicked flag from root SA to sub-abilities for condition checks
            let mut sa_with_ctx;
            let needs_ctx_clone = (root_kicked && !sa.kicked)
                || (parent_target_card.is_some() && sa.target_chosen.target_card.is_none())
                || (parent_target_player.is_some() && sa.target_chosen.target_player.is_none())
                || (parent_target_stack_entry.is_some()
                    && sa.target_chosen.target_stack_entry.is_none())
                || (inherited_trigger_index.is_some() && sa.trigger_index.is_none());
            let sa_ref = if needs_ctx_clone {
                sa_with_ctx = sa.clone();
                if root_kicked && !sa_with_ctx.kicked {
                    sa_with_ctx.kicked = true;
                }
                if sa_with_ctx.target_chosen.target_card.is_none() {
                    sa_with_ctx.target_chosen.target_card = parent_target_card;
                }
                if sa_with_ctx.target_chosen.target_player.is_none() {
                    sa_with_ctx.target_chosen.target_player = parent_target_player;
                }
                if sa_with_ctx.target_chosen.target_stack_entry.is_none() {
                    sa_with_ctx.target_chosen.target_stack_entry = parent_target_stack_entry;
                }
                if sa_with_ctx.trigger_index.is_none() {
                    sa_with_ctx.trigger_index = inherited_trigger_index;
                }
                &sa_with_ctx
            } else {
                sa
            };
            self.resolve_single_effect(game, agents, sa_ref, parent_target_card);
            parent_target_card = sa_ref.target_chosen.target_card;
            parent_target_player = sa_ref.target_chosen.target_player;
            parent_target_stack_entry = sa_ref.target_chosen.target_stack_entry;
            inherited_trigger_index = sa_ref.trigger_index;
            current = sa.get_sub_ability();
        }

        // Mirror Java's `SpellAbility.resolve` post-pass: fire `ChangesZoneAll`
        // for every move accumulated during this spell/ability so triggers like
        // Teval's "whenever a card leaves your graveyard, create a token" see
        // moves performed by the resolving SA chain (e.g. its DBReturn pulling
        // a land from the graveyard back onto the battlefield).
        if let Some(table) = game.pending_change_zone_table.take() {
            table.trigger_changes_zone_all(&mut self.trigger_handler, game, None);
        }

        // Avoid leaking shared tables into subsequent stack entries.
        game.clear_pending_damage_maps();
        game.clear_pending_change_zone_table();
        game.stack.clear_recently_removed();
    }

    /// Check whether a spell/ability should fizzle (CR 608.2b).
    /// Mirrors Java's `MagicStack.hasFizzled()`.
    ///
    /// Walks the SpellAbility chain. If every targeting node has only invalid
    /// targets, the whole spell/ability is countered by game rules.
    /// Returns `false` if no node uses targeting at all.
    fn has_fizzled(sa: &mut SpellAbility, game: &GameState) -> bool {
        let result = Self::has_fizzled_inner(sa, game, None);
        // Java: `return fizzle != null && fizzle;`
        result.unwrap_or(false)
    }

    /// Recursive helper mirroring Java's `hasFizzled(sa, source, fizzle)`.
    /// Returns `Option<bool>`:
    ///   `None`        = no targeting node seen in chain yet
    ///   `Some(true)`  = all targeting nodes have only invalid targets
    ///   `Some(false)` = at least one valid target found somewhere
    fn has_fizzled_inner(
        sa: &mut SpellAbility,
        game: &GameState,
        mut fizzle: Option<bool>,
    ) -> Option<bool> {
        if sa.uses_targeting() {
            // Check if we actually have any chosen targets (mirrors Java's
            // `!sa.isZeroTargets()` — Rust stores at most one target per slot
            // so having any slot filled means non-zero targets)
            let has_any_chosen = !sa.target_chosen.all_target_cards().is_empty()
                || sa.target_chosen.target_player.is_some()
                || sa.target_chosen.target_stack_entry.is_some();

            if has_any_chosen {
                // This node uses targeting and has chosen targets — fizzling
                // is now possible.
                if fizzle.is_none() {
                    fizzle = Some(true);
                }

                // Check each chosen target. If ANY is still valid, fizzle = false.
                // Mirrors Java's for loop over `sa.getTargets()`.

                for target_card_id in sa.target_chosen.all_target_cards() {
                    if Self::is_card_target_valid(
                        sa,
                        target_card_id,
                        if sa.target_chosen.target_card == Some(target_card_id) {
                            sa.target_chosen.target_card_zone_timestamp
                        } else {
                            None
                        },
                        game,
                    ) {
                        fizzle = Some(false);
                    } else {
                        if sa.target_chosen.target_card == Some(target_card_id) {
                            sa.target_chosen.target_card = None;
                            sa.target_chosen.target_card_zone_timestamp = None;
                        }
                        sa.target_chosen.divided_map.remove(&target_card_id);
                    }
                }

                if let Some(target_player_id) = sa.target_chosen.target_player {
                    if Self::is_player_target_valid(target_player_id, game) {
                        fizzle = Some(false);
                    } else {
                        sa.target_chosen.target_player = None;
                    }
                }

                if let Some(target_stack_id) = sa.target_chosen.target_stack_entry {
                    if game.stack.find_by_id(target_stack_id).is_some() {
                        fizzle = Some(false);
                    } else {
                        sa.target_chosen.target_stack_entry = None;
                    }
                }

                // CantFizzle param (e.g. Gilded Drake) overrides fizzle
                if sa.ir.cant_fizzle {
                    fizzle = Some(false);
                }
            }
        }

        // Recurse into sub-abilities — mirrors Java's:
        //   if (sa.getSubAbility() != null)
        //       fizzle = hasFizzled(sa.getSubAbility(), source, fizzle);
        if let Some(sub) = sa.get_sub_ability_mut() {
            fizzle = Self::has_fizzled_inner(sub, game, fizzle);
        }

        fizzle
    }

    /// Check if a card target is still valid at resolution time.
    /// The card must still be in a zone that makes it a legal target:
    /// - For Battlefield targets (Creature/Permanent/Any): must be on battlefield
    /// - For CardInZone targets: must be in the specified zone
    /// - The card must also still be targetable (hexproof etc.)
    fn is_card_target_valid(
        sa: &SpellAbility,
        target_card_id: CardId,
        target_zone_timestamp: Option<u64>,
        game: &GameState,
    ) -> bool {
        // Check if card index is valid
        if target_card_id.index() >= game.cards.len() {
            return false;
        }

        let card = game.card(target_card_id);

        // Java parity: target object identity uses both card id and game timestamp.
        if let Some(chosen_ts) = target_zone_timestamp {
            if card.zone_timestamp != chosen_ts {
                return false;
            }
        }

        // Determine expected zone from target restrictions
        let expected_zone = if let Some(ref tr) = sa.target_restrictions {
            match &tr.target_kind {
                TargetKind::Creature(_) | TargetKind::Permanent(_) | TargetKind::Any => {
                    Some(ZoneType::Battlefield)
                }
                TargetKind::CardInZone { zone, .. } => Some(*zone),
                _ => Some(ZoneType::Battlefield), // default
            }
        } else {
            Some(ZoneType::Battlefield) // default
        };

        // Card must be in the expected zone
        if let Some(zone) = expected_zone {
            if card.zone != zone {
                return false;
            }
        }

        // Card must still be targetable (hexproof, shroud, protection, etc.)
        // Use the activating player as the source controller
        crate::spellability::target_restrictions::can_be_targeted_by_sa(
            game,
            target_card_id,
            sa.activating_player,
            sa,
        )
    }

    /// Check if a player target is still valid (player must still be alive).
    fn is_player_target_valid(target_player_id: PlayerId, game: &GameState) -> bool {
        if target_player_id.index() >= game.players.len() {
            return false;
        }
        !game.player(target_player_id).has_lost
    }

    /// Resolve a single effect line by delegating to the effects module.
    pub(crate) fn resolve_single_effect(
        &mut self,
        game: &mut GameState,
        agents: &mut [Box<dyn PlayerAgent>],
        sa: &SpellAbility,
        parent_target_card: Option<CardId>,
    ) {
        let source_name = sa
            .source
            .and_then(|cid| game.cards.get(cid.index()).map(|c| c.card_name.clone()))
            .unwrap_or_else(|| "Unknown source".to_string());
        let effect_kind = Self::effect_kind_for_sa(sa);
        let mut event = crate::agent::GameLogEvent::stack(format!(
            "Effect resolved: {} | source={}",
            effect_kind, source_name
        ))
        .with_player(sa.activating_player);
        if let Some(source_id) = sa.source {
            event = event.with_source_card(source_id);
        }
        if let Some(target_id) = sa.target_chosen.target_card {
            event = event.with_target_card(target_id);
        }
        crate::agent::notify_all_agents(agents, event);

        let mut ctx = EffectContext {
            game,
            combat: Some(&mut self.combat),
            agents,
            trigger_handler: &mut self.trigger_handler,
            token_templates: &self.token_templates,
            token_art_variants: &self.token_art_variants,
            token_fallback: &self.token_fallback,
            edition_dates: &self.edition_dates,
            mana_pools: &mut self.mana_pools,
            parent_target_card,
            rng: &mut *self.game_rng,
        };
        effects::resolve_effect(&mut ctx, sa);
    }

    /// CR 707.10 / 111.11 — copy of a permanent spell becomes a token.
    fn register_evoke_sacrifice_triggers(
        &mut self,
        game: &GameState,
        card_id: CardId,
        player: PlayerId,
        evoke_keyword_count: usize,
    ) {
        for i in 0..evoke_keyword_count {
            self.trigger_handler.register_delayed_trigger(
                crate::trigger::handler::DelayedTrigger {
                    mode: TriggerType::ChangesZone,
                    trigger_mode: Box::new(crate::trigger::trigger_changes_zone::TriggerChangesZone)
                        as Box<dyn crate::trigger::TriggerBehavior>,
                    params: crate::parsing::Params::from_raw(
                        "Mode$ ChangesZone | Destination$ Battlefield | ValidCard$ Card.Self",
                    ),
                    execute_svar: "DB$ Sacrifice".to_string(),
                    controller: player,
                    source_card: card_id,
                    created_turn: game.turn.turn_number,
                    created_phase: game.turn.phase,
                    target_card: Some(card_id),
                    remembered_amount: 0,
                    remembered_cards: Vec::new(),
                    remembered_players: Vec::new(),
                    remembered_lki_cards: Vec::new(),
                    sort_after_active: i > 0,
                    trigger_order: None,
                },
            );
        }
    }

    fn resolve_copied_permanent_as_token(
        &mut self,
        game: &mut GameState,
        agents: &mut [Box<dyn PlayerAgent>],
        entry: &StackEntry,
    ) {
        use crate::ability::effects::token_effect_base::{TokenCreateTable, TokenEffectBase};
        let Some(original_id) = entry.spell_ability.source else {
            return;
        };
        let player = entry.spell_ability.activating_player;
        let original = game.card(original_id).clone();
        let mut proto = crate::ability::effects::copy_permanent_effect::get_proto_type(
            &entry.spell_ability,
            &original,
            player,
        );
        proto.copied_permanent = Some(original_id);
        let mut token_table = TokenCreateTable::default();
        token_table.put(player, proto, 1);
        let mut trigger_list = crate::card::card_zone_table::CardZoneTable::default();
        let mut ctx = EffectContext {
            game,
            combat: Some(&mut self.combat),
            agents,
            trigger_handler: &mut self.trigger_handler,
            token_templates: &self.token_templates,
            token_art_variants: &self.token_art_variants,
            token_fallback: &self.token_fallback,
            edition_dates: &self.edition_dates,
            mana_pools: &mut self.mana_pools,
            parent_target_card: None,
            rng: &mut *self.game_rng,
        };
        let created = crate::ability::effects::token_effect_base::TOKEN_EFFECT_BASE
            .make_token_table(
                &mut ctx,
                token_table,
                true,
                &mut trigger_list,
                &entry.spell_ability,
            );
        if entry.spell_ability.alt_cost == Some(crate::spellability::AlternativeCost::Evoke) {
            let evoke_keyword_count = (entry.spell_ability.evoke_keyword_count as usize).max(1);
            for &token_id in &created.created {
                self.register_evoke_sacrifice_triggers(game, token_id, player, evoke_keyword_count);
            }
        }
        trigger_list.trigger_changes_zone_all(
            &mut self.trigger_handler,
            game,
            Some(&entry.spell_ability),
        );
    }
}
