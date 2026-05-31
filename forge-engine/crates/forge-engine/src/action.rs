use forge_foundation::ZoneType;

use crate::agent::PlayerAgent;
use crate::card::{Card, CounterType};
use crate::event::RunParams;
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::replacement::replacement_handler::{
    apply_replacements, apply_replacements_with_agents, ReplacementEvent, ReplacementRuntime,
};
use crate::replacement::GameLossReason;
use crate::replacement::ReplacementResult;
use crate::staticability::layer::{apply_continuous_effects, apply_etb_tapped_with_agents};
use crate::trigger::handler::TriggerHandler;
use crate::trigger::TriggerType;

/// Game state mutation methods — moving cards, dealing damage, state-based actions.
impl GameState {
    pub fn record_player_damage_assignment(
        &mut self,
        source: Option<CardId>,
        target_player: Option<PlayerId>,
        amount: i32,
        is_combat: bool,
    ) {
        self.player_record_damage_assignment(source, target_player, amount, is_combat);
    }

    /// Move a card from its current zone to a new zone.
    /// Move a card to a new zone. For Graveyard destinations, checks for zone-redirect
    /// replacement effects (Rest in Peace, Leyline of the Void) and redirects to the
    /// correct zone. Use `move_card_final` to skip the replacement check.
    pub fn move_card(&mut self, card_id: CardId, dest_zone: ZoneType, dest_owner: PlayerId) {
        self.move_card_internal(card_id, dest_zone, dest_owner, None, None, true, false);
    }

    pub fn move_card_with_agents(
        &mut self,
        card_id: CardId,
        dest_zone: ZoneType,
        dest_owner: PlayerId,
        agents: &mut [Box<dyn PlayerAgent>],
    ) {
        self.move_card_internal(
            card_id,
            dest_zone,
            dest_owner,
            Some(agents),
            None,
            true,
            false,
        );
    }

    pub fn move_card_with_agents_and_replacement_runtime(
        &mut self,
        card_id: CardId,
        dest_zone: ZoneType,
        dest_owner: PlayerId,
        agents: &mut [Box<dyn PlayerAgent>],
        runtime: &mut ReplacementRuntime<'_>,
    ) {
        self.move_card_internal(
            card_id,
            dest_zone,
            dest_owner,
            Some(agents),
            Some(runtime.trigger_handler),
            true,
            false,
        );
    }

    fn move_card_without_replacement(
        &mut self,
        card_id: CardId,
        dest_zone: ZoneType,
        dest_owner: PlayerId,
    ) {
        self.move_card_internal(card_id, dest_zone, dest_owner, None, None, false, false);
    }

    /// Discard a card. Mirrors Java's `Player.discard()`.
    ///
    /// Records the discard, marks the card, and moves it to graveyard through
    /// the normal zone-change machinery (which runs replacement effects like
    /// Madness automatically). Fires Discarded triggers afterwards.
    pub fn discard_card(
        &mut self,
        card_id: CardId,
        discard_player: PlayerId,
        sa: Option<&crate::spellability::SpellAbility>,
        agents: Option<&mut [Box<dyn PlayerAgent>]>,
        trigger_handler: &mut TriggerHandler,
    ) {
        let owner = self.card(card_id).owner;
        self.player_record_discard(discard_player, 1);
        self.card_mut(card_id).set_discarded(true);

        // Move to graveyard through normal zone-change with is_discard=true.
        // Replacement effects (e.g. Madness → Exile) are handled generically.
        self.move_card_internal(
            card_id,
            ZoneType::Graveyard,
            owner,
            agents,
            Some(trigger_handler),
            true,
            true, // is_discard
        );

        // RememberDiscarded
        if let Some(sa) = sa {
            if sa.ir.remember_discarded {
                if let Some(source_id) = sa.source {
                    self.card_mut(source_id).add_remembered_card(card_id);
                }
            }
        }

        // Register active triggers on the card in its new zone.
        trigger_handler.register_active_trigger(self, card_id);

        // Emit zone-change trigger for Hand → actual destination.
        let dest_zone = self.card(card_id).zone;
        crate::ability::effects::zone_triggers::emit_zone_trigger(
            trigger_handler,
            card_id,
            ZoneType::Hand,
            dest_zone,
        );

        // Fire Discarded trigger.
        trigger_handler.run_trigger(
            TriggerType::Discarded,
            RunParams {
                card: Some(card_id),
                player: Some(discard_player),
                ..Default::default()
            },
            false,
        );
        trigger_handler.run_trigger(
            TriggerType::DiscardedAll,
            RunParams {
                card: Some(card_id),
                cards: Some(vec![card_id]),
                player: Some(discard_player),
                ..Default::default()
            },
            false,
        );
    }

    fn move_card_internal(
        &mut self,
        card_id: CardId,
        dest_zone: ZoneType,
        dest_owner: PlayerId,
        mut agents: Option<&mut [Box<dyn PlayerAgent>]>,
        mut trigger_handler: Option<&mut TriggerHandler>,
        apply_move_replacement: bool,
        is_discard: bool,
    ) {
        let (src_zone, src_owner, was_permanent, was_land, is_token) = {
            let card = &self.cards[card_id.index()];
            (
                card.zone,
                card.controller,
                card.type_line.is_permanent(),
                card.is_land(),
                card.is_token,
            )
        };
        if let Ok(filter) = std::env::var("FORGE_CARD_TRACE") {
            if !filter.is_empty()
                && self.cards[card_id.index()]
                    .card_name
                    .eq_ignore_ascii_case(&filter)
            {
                eprintln!(
                    "[card-trace] move {} {:?} {:?} -> {:?} (owner={:?} sick={} cast_from={:?})",
                    self.cards[card_id.index()].card_name,
                    card_id,
                    src_zone,
                    dest_zone,
                    dest_owner,
                    self.cards[card_id.index()].summoning_sick,
                    self.cards[card_id.index()].cast_from,
                );
            }
        }
        let mut moved_event = ReplacementEvent::Moved {
            card: card_id,
            origin: src_zone,
            destination: dest_zone,
            is_discard,
        };
        let tapped_before_replacement = self.card(card_id).tapped;
        if apply_move_replacement {
            if let Some(agents) = agents.as_deref_mut() {
                apply_replacements_with_agents(self, agents, &mut moved_event);
            } else {
                apply_replacements(self, &mut moved_event);
            }
        }
        let dest_zone = match moved_event {
            ReplacementEvent::Moved { destination, .. } => destination,
            _ => dest_zone,
        };
        let replacement_marked_etb_tapped = dest_zone == ZoneType::Battlefield
            && self.card(card_id).tapped
            && !tapped_before_replacement;
        let dest_owner = if dest_zone == ZoneType::Command {
            self.card(card_id).owner
        } else {
            dest_owner
        };
        let host_left_battlefield =
            src_zone == ZoneType::Battlefield && dest_zone != ZoneType::Battlefield;
        if host_left_battlefield && was_permanent {
            self.player_record_permanent_left_battlefield(src_owner);
        }
        // Java `Card.clearCastSA` — the cast-SA link dies once the instance
        // leaves the battlefield (a new cast produces a fresh instance).
        if host_left_battlefield {
            self.card_mut(card_id).cast_sa = None;
            // `ControlGain$ LoseControl$ LeavesPlay` — drop the scheduled
            // revert since the card is no longer on the battlefield.
            crate::ability::effects::control_gain_effect::leaves_play_hook(self, card_id);
        }
        if dest_zone == ZoneType::Graveyard && was_permanent && !is_token {
            self.player_record_permanent_put_into_graveyard(self.card(card_id).owner);
        }
        let forget_effects: Vec<CardId> = self
            .cards
            .iter()
            .filter(|c| {
                c.zone == ZoneType::Command
                    && c.forget_on_moved_origin == Some(src_zone)
                    && c.remembered_cards.contains(&card_id)
            })
            .map(|c| c.id)
            .collect();

        // Tokens and copy-tokens cease to exist when leaving the battlefield (CR 110.5g).
        // Set zone to None (limbo) and remove from source zone without adding to destination.
        if is_token && dest_zone != ZoneType::Battlefield {
            if let Some(table) = self.pending_change_zone_table.as_mut() {
                table.put(Some(src_zone), Some(ZoneType::None), card_id);
            }
            let mut exile_effects = Vec::new();
            for eff_id in forget_effects.iter().copied() {
                let eff = &mut self.cards[eff_id.index()];
                eff.remembered_cards.retain(|&rid| rid != card_id);
                if eff.exile_when_no_remembered && eff.remembered_cards.is_empty() {
                    exile_effects.push(eff_id);
                }
            }
            self.cards[card_id.index()].zone = ZoneType::None;
            if src_zone != ZoneType::None {
                self.remove_card_from_zone(src_zone, src_owner, card_id);
            }
            // Effect cards with ForgetOnMoved should be removed from the game
            // entirely (zone = None), not moved to Exile. Moving them to Exile
            // creates phantom cards that diverge from Java parity.
            for eff_id in exile_effects {
                let controller = self.card(eff_id).controller;
                self.remove_card_from_zone(ZoneType::Command, controller, eff_id);
                self.cards[eff_id.index()].zone = ZoneType::None;
            }
            apply_continuous_effects(self);
            debug_assert!(self.card_zone_location_matches_card(card_id));
            return;
        }

        // Remove from source zone
        if src_zone != ZoneType::None {
            self.remove_card_from_zone(src_zone, src_owner, card_id);
        }

        if src_zone == ZoneType::Exile && dest_zone != ZoneType::Exile {
            self.cards[card_id.index()]
                .keywords
                .retain(|kw| !kw.starts_with(crate::card::KEYWORD_PLOTTED_PREFIX));
        }

        // Update card's zone
        self.cards[card_id.index()].zone = dest_zone;
        if src_zone != dest_zone {
            self.cards[card_id.index()].turn_in_zone = self.turn.turn_number;
        }

        if let Some(table) = self.pending_change_zone_table.as_mut() {
            table.put(Some(src_zone), Some(dest_zone), card_id);
        }

        // Assign a zone timestamp so same-player triggers are ordered by
        // zone entry order (matching Java's Zone.cardList insertion order).
        self.assign_zone_timestamp(card_id);

        // Track LKI: record which zone this card came from on the destination zone.
        self.save_zone_lki(dest_zone, dest_owner, card_id, src_zone);

        // Reset state on zone change
        match dest_zone {
            ZoneType::Battlefield => {
                // A permanent enters under the destination player's control.
                // This must be updated before ETB-trigger registration so
                // triggered abilities inherit the correct controller.
                self.cards[card_id.index()].controller = dest_owner;
                self.cards[card_id.index()].enter_battlefield();
                if replacement_marked_etb_tapped {
                    self.cards[card_id.index()].set_tapped(true);
                }
                // Add to destination zone first so the card is "on the
                // battlefield" when ETB-tapped checks run against it.
                self.add_card_to_zone(dest_zone, dest_owner, card_id);
                if was_land {
                    self.player_record_landfall(dest_owner);
                }
                // Apply ETB-tapped effects (intrinsic + extrinsic). When the
                // replacement chain already tapped this card it also already
                // prompted the affected player to choose the applied effect,
                // so neither the prompt nor the apply pass should fire again
                // here — Java's flow runs the choose-and-apply step exactly
                // once via the replacement chain.
                if !replacement_marked_etb_tapped {
                    apply_etb_tapped_with_agents(self, card_id, agents.as_deref_mut());
                }
                // Keyword ETB counters: K:etbCounter:TYPE:N
                // N can be a literal integer or an SVar name (e.g. "X" for X-cost spells).
                let etb_keywords = self.cards[card_id.index()].keywords.as_string_list();
                for kw in etb_keywords {
                    let mut parts = kw.split(':');
                    let head = parts.next().unwrap_or_default();
                    if !head.eq_ignore_ascii_case("etbCounter") {
                        continue;
                    }
                    let counter_type = parts.next().unwrap_or_default();
                    let amount_str = parts.next().unwrap_or_default();
                    let amount = amount_str.parse::<i32>().unwrap_or_else(|_| {
                        // Resolve SVar reference (e.g. "X" → card.svars["X"] = "Count$xPaid"
                        // → card.svars["XPaid"] = "3").
                        let card = &self.cards[card_id.index()];
                        if let Some(svar_expr) = card.svars.get(amount_str) {
                            if svar_expr == "Count$xPaid" || svar_expr == "Count$XPaid" {
                                card.svars
                                    .get("XPaid")
                                    .and_then(|v| v.parse::<i32>().ok())
                                    .unwrap_or(0)
                            } else {
                                svar_expr.parse::<i32>().unwrap_or(0)
                            }
                        } else {
                            0
                        }
                    });
                    if amount <= 0 {
                        continue;
                    }
                    let ct = crate::ability::effects::parse_counter_type(counter_type);
                    // Respect CantPutCounter (e.g. Solemnity) before placing ETB counters.
                    if !crate::staticability::static_ability_cant_put_counter::any_cant_put_counter_on_card(
                        &self.cards,
                        &self.cards[card_id.index()],
                        &ct,
                    ) {
                        // Fire AddCounter replacement (Hardened Scales, Doubling Season)
                        // ETB counters are treated as effect-based in Java (EffectOnly=true
                        // is set when entering the battlefield in GameAction.moveToPlay).
                        let mut add_event = ReplacementEvent::AddCounter {
                            target: card_id,
                            counter_type: ct.clone(),
                            count: amount,
                            is_effect: true,
                        };
                        if let Some(agents) = agents.as_deref_mut() {
                            apply_replacements_with_agents(self, agents, &mut add_event);
                        } else {
                            apply_replacements(self, &mut add_event);
                        }
                        let final_amount = if let ReplacementEvent::AddCounter { count, .. } = add_event {
                            count
                        } else {
                            amount
                        };
                        if final_amount > 0 {
                            self.cards[card_id.index()].add_counter(&ct, final_amount);
                        }
                    }
                }
                // Planeswalkers enter with loyalty counters equal to printed loyalty.
                // Java exposes this as CardState's synthetic etbCounter replacement.
                if self.cards[card_id.index()].type_line.is_planeswalker() {
                    let loyalty = self.cards[card_id.index()]
                        .initial_loyalty
                        .as_deref()
                        .and_then(|value| value.parse::<i32>().ok())
                        .unwrap_or(0);
                    if loyalty > 0 {
                        let ct = crate::card::CounterType::Loyalty;
                        if !crate::staticability::static_ability_cant_put_counter::any_cant_put_counter_on_card(
                            &self.cards,
                            &self.cards[card_id.index()],
                            &ct,
                        ) {
                            let mut add_event = ReplacementEvent::AddCounter {
                                target: card_id,
                                counter_type: ct.clone(),
                                count: loyalty,
                                is_effect: true,
                            };
                            if let Some(agents) = agents.as_deref_mut() {
                                apply_replacements_with_agents(self, agents, &mut add_event);
                            } else {
                                apply_replacements(self, &mut add_event);
                            }
                            let final_amount = if let ReplacementEvent::AddCounter { count, .. } = add_event {
                                count
                            } else {
                                loyalty
                            };
                            if final_amount > 0 {
                                self.cards[card_id.index()].add_counter(&ct, final_amount);
                            }
                        }
                    }
                }
                // Apply +1/+1 counters from mana that adds counters (Guildmages' Forum, Opal Palace)
                let etb_p1p1 = self.cards[card_id.index()].etb_counters_p1p1;
                if etb_p1p1 > 0 {
                    let ct = crate::card::CounterType::P1P1;
                    if !crate::staticability::static_ability_cant_put_counter::any_cant_put_counter_on_card(
                        &self.cards,
                        &self.cards[card_id.index()],
                        &ct,
                    ) {
                        // Fire AddCounter replacement (Hardened Scales, Doubling Season)
                        // ETB counters from mana are treated as effect-based in Java.
                        let mut add_event = ReplacementEvent::AddCounter {
                            target: card_id,
                            counter_type: ct.clone(),
                            count: etb_p1p1,
                            is_effect: true,
                        };
                        if let Some(agents) = agents {
                            apply_replacements_with_agents(self, agents, &mut add_event);
                        } else {
                            apply_replacements(self, &mut add_event);
                        }
                        let final_count = if let ReplacementEvent::AddCounter { count, .. } = add_event {
                            count
                        } else {
                            etb_p1p1
                        };
                        if final_count > 0 {
                            self.cards[card_id.index()].add_counter(&ct, final_count);
                        }
                    }
                    self.cards[card_id.index()].etb_counters_p1p1 = 0;
                }
                // Sunburst: add counters based on colors of mana spent
                let sunburst = self.cards[card_id.index()].sunburst_count();
                if sunburst > 0 && self.cards[card_id.index()].has_keyword("Sunburst") {
                    let ct = if self.cards[card_id.index()].is_creature() {
                        crate::card::CounterType::P1P1
                    } else {
                        crate::card::CounterType::Charge
                    };
                    if !crate::staticability::static_ability_cant_put_counter::any_cant_put_counter_on_card(
                        &self.cards,
                        &self.cards[card_id.index()],
                        &ct,
                    ) {
                        self.cards[card_id.index()].add_counter(&ct, sunburst);
                    }
                }
                // Update LKI snapshot: card just entered the battlefield.
                // Ensures it's available for later TriggeredCard$CardPower lookups
                // even if it dies within the same resolution chain.
                self.update_lki_snapshot(card_id);
                apply_continuous_effects(self);
                debug_assert!(self.card_zone_location_matches_card(card_id));
                return;
            }
            ZoneType::Graveyard | ZoneType::Hand | ZoneType::Exile | ZoneType::Library => {
                // Detach any attachments before resetting state.
                let attachments: Vec<CardId> = self.cards[card_id.index()].attachments.clone();
                for aura_id in attachments {
                    self.cards[aura_id.index()].attached_to = None;
                    // Bestow: when host leaves, revert aura to creature
                    self.cards[aura_id.index()].is_bestowed = false;
                }
                self.cards[card_id.index()].attachments.clear();
                // Also detach this card from its host if it was an Aura/Equipment.
                self.detach(card_id);

                // Save last-known information before resetting.
                // Mirrors Java's LKI system for trigger SVars like TriggeredCard$CardPower.
                if src_zone == ZoneType::Battlefield {
                    let card = &self.cards[card_id.index()];
                    let lki_p = card.power();
                    let lki_t = card.toughness();
                    let card = &mut self.cards[card_id.index()];
                    card.lki_power = Some(lki_p);
                    card.lki_toughness = Some(lki_t);
                }

                // Reset battlefield state when leaving (including static modifiers).
                let keep_counters =
                    crate::staticability::static_ability_counters_remain::counters_remain(
                        &self.cards,
                        &self.cards[card_id.index()],
                        dest_zone,
                    );
                let card = &mut self.cards[card_id.index()];
                card.tapped = false;
                card.damage = 0;
                card.power_modifier = 0;
                card.toughness_modifier = 0;
                card.static_power_modifier = 0;
                card.static_toughness_modifier = 0;
                card.static_set_power = None;
                card.static_set_toughness = None;
                card.granted_keywords.clear();
                if let Some(type_line) = card.static_type_line_base.take() {
                    card.set_type_line(type_line);
                }
                card.static_added_subtypes.clear();
                card.restore_changed_characteristics_baseline();
                card.cant_attack_static = false;
                card.cant_block_static = false;
                card.summoning_sick = true;
                card.monstrous = false;
                card.controller = card.owner;
                card.face_down = false;
                card.is_bestowed = false;
                // CR 400.7: a permanent that changes zones becomes a new
                // object with no cast history. Mirrors Java's
                // changeZone-creates-new-Card behaviour.
                card.cast_from = None;
                card.reset_crewed();
                if !keep_counters {
                    card.counters.clear();
                }
                // Clear temporary triggers added by Animate effects (e.g.
                // Supernatural Stamina's "when this creature dies, return it").
                // Per CR 400.7 a permanent that changes zones becomes a new
                // object; it must not retain one-shot death-return triggers.
                // Without this, a creature that dies-and-returns would still
                // carry the trigger, making it "immortal" for the rest of the
                // turn.
                card.clear_pump_triggers();
                card.clear_pump_keywords();
                // Restore intrinsic keywords from the animate snapshot so
                // Animate-granted keywords (e.g. Sneak Attack's `Keywords$
                // Haste`) do not persist into the new object the card
                // becomes when it changes zones (CR 400.7).
                if let Some(state) = card.animate_state.take() {
                    if let Some(orig_kws) = state.original_keywords {
                        card.keywords = orig_kws;
                        card.update_keywords();
                    }
                }
                if let Some(state) = card.clone_state.take() {
                    card.restore_clone_snapshot(state);
                } else {
                    card.remove_clone_states();
                }
            }
            ZoneType::Command => {
                // Detach any attachments before resetting state.
                let attachments: Vec<CardId> = self.cards[card_id.index()].attachments.clone();
                for aura_id in attachments {
                    self.cards[aura_id.index()].attached_to = None;
                }
                self.cards[card_id.index()].attachments.clear();
                self.detach(card_id);

                // Commander returning to command zone: reset battlefield state.
                let keep_counters =
                    crate::staticability::static_ability_counters_remain::counters_remain(
                        &self.cards,
                        &self.cards[card_id.index()],
                        dest_zone,
                    );
                let card = &mut self.cards[card_id.index()];
                card.tapped = false;
                card.damage = 0;
                card.power_modifier = 0;
                card.toughness_modifier = 0;
                card.static_power_modifier = 0;
                card.static_toughness_modifier = 0;
                card.static_set_power = None;
                card.static_set_toughness = None;
                card.granted_keywords.clear();
                if let Some(type_line) = card.static_type_line_base.take() {
                    card.set_type_line(type_line);
                }
                card.static_added_subtypes.clear();
                card.restore_changed_characteristics_baseline();
                card.cant_attack_static = false;
                card.cant_block_static = false;
                card.summoning_sick = true;
                card.monstrous = false;
                card.controller = card.owner;
                card.cast_from = None;
                if !keep_counters {
                    card.counters.clear();
                }
                if let Some(state) = card.clone_state.take() {
                    card.restore_clone_snapshot(state);
                } else {
                    card.remove_clone_states();
                }
            }
            _ => {}
        }

        // Add to destination zone
        self.add_card_to_zone(dest_zone, dest_owner, card_id);

        // Commander 903.9a tracking: once a commander enters graveyard or exile,
        // SBA may offer moving it to the command zone exactly once.
        let commander_entered_gy_or_exile = self.card(card_id).is_commander
            && matches!(dest_zone, ZoneType::Graveyard | ZoneType::Exile);
        self.cards[card_id.index()].move_to_command_zone = commander_entered_gy_or_exile;

        // Forget remembered objects for command effects with ForgetOnMoved.
        let mut exile_effects = Vec::new();
        for eff_id in forget_effects {
            let eff = &mut self.cards[eff_id.index()];
            eff.remembered_cards.retain(|&rid| rid != card_id);
            if eff.exile_when_no_remembered && eff.remembered_cards.is_empty() {
                exile_effects.push(eff_id);
            }
        }
        // Effect cards with ForgetOnMoved should be removed from the game
        // entirely (zone = None), not moved to Exile.
        for eff_id in exile_effects {
            let controller = self.card(eff_id).controller;
            self.remove_card_from_zone(ZoneType::Command, controller, eff_id);
            self.cards[eff_id.index()].zone = ZoneType::None;
        }

        // Expire temporary effect cards linked to this host leaving play
        // (Duration$ UntilHostLeavesPlay / UntilHostLeavesPlayOrEOT).
        if host_left_battlefield {
            let linked_effects: Vec<CardId> = self
                .cards
                .iter()
                .filter(|c| c.zone == ZoneType::Command && c.temp_effect_host == Some(card_id))
                .map(|c| c.id)
                .collect();
            for eff_id in linked_effects {
                let controller = self.card(eff_id).controller;
                self.remove_card_from_zone(ZoneType::Command, controller, eff_id);
                self.cards[eff_id.index()].zone = ZoneType::None;
            }

            // Return cards exiled by this host via ChangeZoneAll Duration$ UntilHostLeavesPlay
            // (e.g. Deputy of Detention: exiled permanents return when it leaves).
            let exiled_by_host: Vec<(CardId, PlayerId)> = self
                .cards
                .iter()
                .filter(|c| c.zone == ZoneType::Exile && c.exiled_by == Some(card_id))
                .map(|c| (c.id, c.owner))
                .collect();
            for (exiled_id, owner) in exiled_by_host {
                self.cards[exiled_id.index()].exiled_by = None;
                self.move_card(exiled_id, ZoneType::Battlefield, owner);
                if let Some(handler) = trigger_handler.as_deref_mut() {
                    let returned_zone = self.card(exiled_id).zone;
                    handler.register_active_trigger(self, exiled_id);
                    crate::ability::effects::zone_triggers::emit_zone_trigger(
                        handler,
                        exiled_id,
                        ZoneType::Exile,
                        returned_zone,
                    );
                }
            }
        }

        apply_continuous_effects(self);
        debug_assert!(self.card_zone_location_matches_card(card_id));
    }

    /// Deal damage to a card (creature).
    ///
    /// Runs replacement effects (e.g. damage prevention) before applying.
    /// Mirrors Java `GameAction.addDamage()` calling `ReplacementHandler.run()`.
    pub fn deal_damage_to_card(&mut self, target: CardId, amount: i32) {
        self.deal_damage_to_card_from(target, amount, None, false);
    }

    /// Deal damage to a card with source tracking for replacement effects.
    pub fn deal_damage_to_card_from(
        &mut self,
        target: CardId,
        amount: i32,
        source: Option<CardId>,
        is_combat: bool,
    ) {
        self.deal_damage_to_card_from_with_agents(target, amount, source, is_combat, None);
    }

    /// Deal damage to a card with source tracking and optional agents for RNG parity.
    pub fn deal_damage_to_card_from_with_agents(
        &mut self,
        target: CardId,
        amount: i32,
        source: Option<CardId>,
        is_combat: bool,
        agents: Option<&mut [Box<dyn crate::agent::PlayerAgent>]>,
    ) {
        if amount <= 0 {
            return;
        }
        if !self.card(target).can_be_dealt_damage() {
            return;
        }
        let mut event = ReplacementEvent::DamageToCard {
            target,
            amount,
            source,
            is_combat,
        };
        if let Some(agents) = agents {
            apply_replacements_with_agents(self, agents, &mut event);
        } else {
            apply_replacements(self, &mut event);
        }
        if let ReplacementEvent::DamageToCard {
            amount: mut final_amount,
            ..
        } = event
        {
            // Consume PreventDamage shields. Each shield prevents 1 damage and
            // is removed. Mirrors Java's per-shield ReplaceDamage effect cards
            // in the Command zone, but using the legacy `damage_prevention`
            // counter pending the proper Command-zone effect-card port.
            let shields = self.cards[target.index()].damage_prevention;
            if shields > 0 && final_amount > 0 {
                let consumed = shields.min(final_amount);
                self.cards[target.index()].damage_prevention -= consumed;
                final_amount -= consumed;
            }
            if final_amount > 0 {
                let dealt = self.cards[target.index()].add_damage_after_prevention(final_amount);
                // Fire DealtDamage replacement event after damage is applied.
                let mut dealt_event = ReplacementEvent::DealtDamage {
                    target,
                    amount: dealt,
                    source,
                };
                if dealt > 0 {
                    apply_replacements(self, &mut dealt_event);
                }
            }
        }
    }

    /// Deal damage to a player.
    ///
    /// Runs replacement effects (e.g. damage prevention) before applying.
    /// Mirrors Java `GameAction.addDamage()` calling `ReplacementHandler.run()`.
    pub fn deal_damage_to_player(&mut self, target: PlayerId, amount: i32) -> i32 {
        self.deal_damage_to_player_from(target, amount, None, false)
    }

    /// Deal damage to a player with source tracking for replacement effects.
    pub fn deal_damage_to_player_from(
        &mut self,
        target: PlayerId,
        amount: i32,
        source: Option<CardId>,
        is_combat: bool,
    ) -> i32 {
        self.deal_damage_to_player_from_with_agents(target, amount, source, is_combat, None)
    }

    /// Deal damage to a player with source tracking and optional agents for RNG parity.
    /// Used by combat damage and spell damage to pass the source card and
    /// combat flag so replacement effects like Torbran and Furnace of Rath
    /// can check ValidSource$ and IsCombat$.
    pub fn deal_damage_to_player_from_with_agents(
        &mut self,
        target: PlayerId,
        amount: i32,
        source: Option<CardId>,
        is_combat: bool,
        agents: Option<&mut [Box<dyn crate::agent::PlayerAgent>]>,
    ) -> i32 {
        if amount <= 0 {
            return 0;
        }
        if crate::staticability::static_ability_cant_gain_lose_pay_life::cant_lose_life(
            self, target,
        ) {
            return 0;
        }
        let mut event = ReplacementEvent::DamageToPlayer {
            target,
            amount,
            source,
            is_combat,
        };
        if let Some(agents) = agents {
            apply_replacements_with_agents(self, agents, &mut event);
        } else {
            apply_replacements(self, &mut event);
        }
        if let ReplacementEvent::DamageToPlayer {
            amount: final_amount,
            ..
        } = event
        {
            if final_amount > 0 {
                return self.player_deal_damage(target, final_amount);
            }
        }
        0
    }

    /// Check and apply state-based actions. Returns true if any were applied.
    pub fn check_state_based_actions(&mut self) -> bool {
        self.check_state_based_actions_with_triggers(None, None)
    }

    /// Check and apply state-based actions. Returns true if any were applied.
    /// If provided, emits ChangesZone triggers for SBA zone moves.
    /// `legend_keep_fn` — optional callback for legend rule: given (player, duplicates),
    /// returns the CardId to keep.  Mirrors Java's `chooseSingleEntityForEffect`.
    pub fn check_state_based_actions_with_triggers(
        &mut self,
        trigger_handler: Option<&mut TriggerHandler>,
        legend_keep_fn: Option<&mut dyn FnMut(PlayerId, &[CardId]) -> CardId>,
    ) -> bool {
        self.check_state_based_actions_impl(trigger_handler, legend_keep_fn, None)
    }

    pub fn check_state_based_actions_with_trigger_agents(
        &mut self,
        trigger_handler: Option<&mut TriggerHandler>,
        agents: &mut [Box<dyn PlayerAgent>],
    ) -> bool {
        self.check_state_based_actions_impl(trigger_handler, None, Some(agents))
    }

    fn move_battlefield_card_to_graveyard_for_sba(
        &mut self,
        cid: CardId,
        trigger_handler: &mut Option<&mut TriggerHandler>,
        agents: &mut Option<&mut [Box<dyn PlayerAgent>]>,
    ) {
        let owner = self.card(cid).owner;
        let mut moved_event = ReplacementEvent::Moved {
            card: cid,
            origin: ZoneType::Battlefield,
            destination: ZoneType::Graveyard,
            is_discard: false,
        };
        if let Some(agents) = agents.as_deref_mut() {
            apply_replacements_with_agents(self, agents, &mut moved_event);
        } else {
            apply_replacements(self, &mut moved_event);
        }
        let final_dest = if let ReplacementEvent::Moved { destination, .. } = moved_event {
            destination
        } else {
            ZoneType::Graveyard
        };
        let old_zone = self.card(cid).zone;
        // Emit trigger BEFORE move_card so LKI state is still available for
        // trigger matching. Persist/Undying and Modular inspect the dying card.
        if let Some(handler) = trigger_handler.as_deref_mut() {
            let lki_p1p1 = *self
                .card(cid)
                .counters
                .get(&CounterType::P1P1)
                .unwrap_or(&0);
            let lki_power = self.card(cid).power();
            let lki_toughness = self.card(cid).toughness();
            let lki_counters = self.card(cid).counters.clone();
            self.card_mut(cid).lki_counters = Some(lki_counters);
            self.card_mut(cid)
                .set_lki_power_toughness(Some(lki_power), Some(lki_toughness));
            crate::ability::effects::emit_zone_trigger_with_lki_counters(
                handler,
                cid,
                old_zone,
                final_dest,
                lki_p1p1,
                lki_power,
                lki_toughness,
            );
            handler.flush_waiting_triggers(self);
        }
        self.move_card_without_replacement(cid, final_dest, owner);
    }

    fn check_state_based_actions_impl(
        &mut self,
        mut trigger_handler: Option<&mut TriggerHandler>,
        mut legend_keep_fn: Option<&mut dyn FnMut(PlayerId, &[CardId]) -> CardId>,
        mut agents: Option<&mut [Box<dyn PlayerAgent>]>,
    ) -> bool {
        // Capture battlefield state before SBA processing. Used by DisableTriggers
        // (Hushbringer) to check LKI — if a creature with DisableTriggers dies in
        // the same SBA batch as another creature, it still suppresses death triggers.
        // Mirrors Java's LastStateBattlefield passed through RunParams.
        self.pre_sba_battlefield = self
            .cards
            .iter()
            .filter(|c| c.zone == ZoneType::Battlefield)
            .map(|c| c.id)
            .collect();

        let mut any_changes = false;
        let mut newly_lost_players: Vec<PlayerId> = Vec::new();

        // Check players with 0 or less life
        for pid in self.player_order.clone() {
            if self.player(pid).tried_to_draw_from_empty_library && self.player(pid).is_alive() {
                self.player_mut(pid).tried_to_draw_from_empty_library = false;
                let mut event = ReplacementEvent::GameLoss {
                    player: pid,
                    reason: GameLossReason::Milled,
                };
                let result = apply_replacements(self, &mut event);
                if result != ReplacementResult::Replaced && !self.player(pid).has_lost {
                    self.player_mark_lost(pid, GameLossReason::Milled);
                    newly_lost_players.push(pid);
                    any_changes = true;
                }
            }
            if self.player(pid).life <= 0 && self.player(pid).is_alive() {
                let mut event = ReplacementEvent::GameLoss {
                    player: pid,
                    reason: GameLossReason::LifeReachedZero,
                };
                let result = apply_replacements(self, &mut event);
                if result != ReplacementResult::Replaced && !self.player(pid).has_lost {
                    self.player_mark_lost(pid, GameLossReason::LifeReachedZero);
                    newly_lost_players.push(pid);
                    any_changes = true;
                }
            }
            // Check poison counters (10+ = lose)
            if self.player(pid).poison_counters >= 10 && self.player(pid).is_alive() {
                let mut event = ReplacementEvent::GameLoss {
                    player: pid,
                    reason: GameLossReason::Poisoned,
                };
                let result = apply_replacements(self, &mut event);
                if result != ReplacementResult::Replaced {
                    if !self.player(pid).has_lost {
                        self.player_mark_lost(pid, GameLossReason::Poisoned);
                        newly_lost_players.push(pid);
                    }
                    any_changes = true;
                }
            }
            // Check commander damage (21+ from a single commander source = lose)
            if self.player(pid).commander_damage_enabled {
                let commander_dmg_entries: Vec<(u32, i32)> = self
                    .player(pid)
                    .commander_damage_received
                    .iter()
                    .map(|(&k, &v)| (k, v))
                    .collect();
                for (_card_raw_id, dmg) in commander_dmg_entries {
                    if dmg >= 21 && self.player(pid).is_alive() && !self.player(pid).has_lost {
                        self.player_mark_lost(pid, GameLossReason::CommanderDamage);
                        newly_lost_players.push(pid);
                        any_changes = true;
                    }
                }
            }

            // CR 704.5z: If a player controls a permanent with Start your
            // engines! and that player has no speed, their speed becomes 1.
            if self.player(pid).speed == 0
                && self
                    .cards_in_zone(ZoneType::Battlefield, pid)
                    .iter()
                    .any(|&cid| self.card(cid).has_keyword("Start your engines"))
            {
                self.increase_player_speed(pid, None);
                any_changes = true;
            }
        }

        if !newly_lost_players.is_empty() {
            for pid in &newly_lost_players {
                self.stack.remove_instances_controlled_by(*pid);
            }
            if let Some(handler) = trigger_handler.as_deref_mut() {
                for pid in &newly_lost_players {
                    handler.run_trigger(
                        TriggerType::LosesGame,
                        RunParams {
                            player: Some(*pid),
                            ..Default::default()
                        },
                        false,
                    );
                    handler.on_player_lost(*pid);
                }
            }
        }

        // Check creatures with lethal damage or 0 toughness
        let battlefield_cards: Vec<CardId> = self
            .player_order
            .clone()
            .iter()
            .flat_map(|&pid| self.cards_in_zone(ZoneType::Battlefield, pid).to_vec())
            .collect();

        for cid in battlefield_cards {
            let (is_creature, zero_toughness, lethal, should_die) = {
                let card = &self.cards[cid.index()];
                let is_creature = card.is_creature();
                let zero_toughness = card.toughness() <= 0;
                let lethal = card.lethal_damage() || card.has_deathtouch_damage;
                let should_die = zero_toughness || lethal;
                (is_creature, zero_toughness, lethal, should_die)
            };
            if is_creature && should_die {
                // Clear deathtouch flag regardless of outcome (mirrors Java
                // GameAction.java line 1491: c.setHasBeenDealtDeathtouchDamage(false)).
                self.cards[cid.index()].has_deathtouch_damage = false;
                // CR 702.12: Indestructible prevents death from lethal damage and
                // "destroy" effects, but NOT from toughness ≤ 0 (CR 704.5f vs 704.5g).
                // This covers K:Indestructible from Forge card scripts (e.g. Darksteel Myr).
                if lethal
                    && !zero_toughness
                    && self.cards[cid.index()].has_keyword("Indestructible")
                {
                    continue;
                }
                // CR 702.89: Umbra armor (Totem Armor) — if enchanted creature
                // would be destroyed, instead remove all damage and destroy the aura.
                let has_umbra = self.cards[cid.index()].attachments.iter().any(|&aid| {
                    aid.index() < self.cards.len()
                        && self.cards[aid.index()].zone == ZoneType::Battlefield
                        && (self.cards[aid.index()].has_keyword("Umbra armor")
                            || self.cards[aid.index()].has_keyword("Totem armor"))
                });
                if has_umbra && !zero_toughness {
                    // Find the first umbra armor aura and destroy it instead
                    let umbra_id =
                        self.cards[cid.index()]
                            .attachments
                            .iter()
                            .copied()
                            .find(|&aid| {
                                aid.index() < self.cards.len()
                                    && self.cards[aid.index()].zone == ZoneType::Battlefield
                                    && (self.cards[aid.index()].has_keyword("Umbra armor")
                                        || self.cards[aid.index()].has_keyword("Totem armor"))
                            });
                    if let Some(umbra_id) = umbra_id {
                        // Remove all damage from the creature
                        self.cards[cid.index()].damage = 0;
                        self.cards[cid.index()].has_deathtouch_damage = false;
                        // Destroy the aura instead
                        let umbra_owner = self.cards[umbra_id.index()].owner;
                        let old_zone = self.cards[umbra_id.index()].zone;
                        self.move_card(umbra_id, ZoneType::Graveyard, umbra_owner);
                        if let Some(handler) = trigger_handler.as_deref_mut() {
                            crate::ability::effects::emit_zone_trigger(
                                handler,
                                umbra_id,
                                old_zone,
                                ZoneType::Graveyard,
                            );
                        }
                        any_changes = true;
                        continue; // Creature survives
                    }
                }

                if zero_toughness {
                    self.move_battlefield_card_to_graveyard_for_sba(
                        cid,
                        &mut trigger_handler,
                        &mut agents,
                    );
                    any_changes = true;
                    continue;
                }

                // Run Destroy replacement effects (R$-based indestructible, etc.).
                // Mirrors Java GameAction.destroy() → ReplacementHandler.run(Destroy, …).
                let mut destroy_event = ReplacementEvent::Destroy { target: cid };
                let result = apply_replacements(self, &mut destroy_event);
                if result != ReplacementResult::Replaced {
                    self.move_battlefield_card_to_graveyard_for_sba(
                        cid,
                        &mut trigger_handler,
                        &mut agents,
                    );
                    // Same-SBA-batch LTB lookback is derived per-event from
                    // `pre_sba_battlefield` in `TriggerHandler::ltb_trigger_refs_for_event`.
                    // No global registration needed.
                    any_changes = true;
                } else {
                    // Indestructible — destruction was replaced; creature stays.
                    // Damage is still marked but the creature does not die.
                }
            }
        }

        let battlefield_cards: Vec<CardId> = self
            .player_order
            .clone()
            .iter()
            .flat_map(|&pid| self.cards_in_zone(ZoneType::Battlefield, pid).to_vec())
            .collect();

        for cid in battlefield_cards {
            let should_put_in_graveyard = {
                let card = self.card(cid);
                card.type_line.is_planeswalker() && card.counter_count(&CounterType::Loyalty) <= 0
            };
            if !should_put_in_graveyard {
                continue;
            }

            self.move_battlefield_card_to_graveyard_for_sba(cid, &mut trigger_handler, &mut agents);
            any_changes = true;
        }

        // CR 704.5q: +1/+1 and -1/-1 counter cancellation
        for &pid in &self.player_order.clone() {
            let battlefield = self.cards_in_zone(ZoneType::Battlefield, pid).to_vec();
            for cid in battlefield {
                let p1 = self.card(cid).counter_count(&CounterType::P1P1);
                let m1 = self.card(cid).counter_count(&CounterType::M1M1);
                if p1 > 0 && m1 > 0 {
                    let cancel = p1.min(m1);
                    self.card_mut(cid)
                        .remove_counter(&CounterType::P1P1, cancel);
                    self.card_mut(cid)
                        .remove_counter(&CounterType::M1M1, cancel);
                    any_changes = true;
                }
            }
        }

        // CR 903.9a: a commander in graveyard or exile may move to command zone.
        for &pid in &self.player_order.clone() {
            let mut commander_candidates = self.cards_in_zone(ZoneType::Graveyard, pid).to_vec();
            commander_candidates.extend(self.cards_in_zone(ZoneType::Exile, pid).iter().copied());
            for cid in commander_candidates {
                if !self.card(cid).can_move_to_command_zone() {
                    continue;
                }
                self.card_mut(cid).move_to_command_zone = false;
                let accepted = if let Some(agents) = agents.as_deref_mut() {
                    let name = self.card(cid).card_name.clone();
                    let message = format!(
                        "{}: If a commander is in a graveyard or in exile and that card was put into that zone since the last time state-based actions were checked, its owner may put it into the command zone.",
                        name
                    );
                    agents[pid.index()].confirm_action(
                        pid,
                        Some("ChangeZoneToAltDestination"),
                        &message,
                        &[],
                        Some(cid),
                        None,
                    )
                } else {
                    false
                };
                if accepted {
                    self.move_card_without_replacement(cid, ZoneType::Command, pid);
                    any_changes = true;
                }
            }
        }

        // Legend rule: for each player, if they control multiple legendary
        // permanents with the same name, keep one and move the rest to graveyard.
        // IgnoreLegendRule statics exempt matching cards.
        for &pid in &self.player_order.clone() {
            let battlefield = self.cards_in_zone(ZoneType::Battlefield, pid).to_vec();
            let mut by_name: std::collections::BTreeMap<String, Vec<CardId>> =
                std::collections::BTreeMap::new();
            for cid in battlefield {
                let c = self.card(cid);
                if !c.type_line.is_legendary() {
                    continue;
                }
                if crate::staticability::static_ability_ignore_legend_rule::ignore_legend_rule(
                    &self.cards,
                    c,
                ) {
                    continue;
                }
                by_name.entry(c.card_name.clone()).or_default().push(cid);
            }
            for (_name, ids) in by_name {
                if ids.len() <= 1 {
                    continue;
                }
                // Choose which to keep: delegate to callback (mirrors Java's
                // chooseSingleEntityForEffect), or default to first in zone order.
                let keep = if let Some(ref mut chooser) = legend_keep_fn {
                    chooser(pid, &ids)
                } else if let Some(agents) = agents.as_deref_mut() {
                    agents[pid.index()].choose_legend_keep(pid, &ids)
                } else {
                    ids[0]
                };
                for cid in ids {
                    if cid == keep {
                        continue;
                    }
                    let owner = self.card(cid).owner;
                    let old_zone = self.card(cid).zone;
                    if let Some(agents) = agents.as_deref_mut() {
                        self.move_card_with_agents(cid, ZoneType::Graveyard, owner, agents);
                    } else {
                        self.move_card(cid, ZoneType::Graveyard, owner);
                    }
                    if let Some(handler) = trigger_handler.as_deref_mut() {
                        crate::ability::effects::emit_zone_trigger(
                            handler,
                            cid,
                            old_zone,
                            ZoneType::Graveyard,
                        );
                    }
                    any_changes = true;
                }
            }
        }

        // CR 704.5n: Aura SBA — an Aura on the battlefield that is not attached
        // to a legal permanent (or whose host left the battlefield) is put into
        // its owner's graveyard.
        {
            let aura_ids: Vec<CardId> = self
                .cards
                .iter()
                .filter(|c| {
                    c.zone == ZoneType::Battlefield
                        && c.type_line.has_subtype("Aura")
                        && !c.type_line.is_creature() // Bestowed auras that became creatures stay
                })
                .filter(|c| {
                    match (c.attached_to, c.attached_to_player) {
                        (None, None) => true, // Not attached to anything — orphaned
                        (None, Some(player_id)) => {
                            if player_id.index() >= self.players.len() {
                                return true;
                            }
                            let player = &self.players[player_id.index()];
                            let enchant_type = c
                                .keywords
                                .iter_strings()
                                .find_map(|kw| {
                                    crate::keyword::extract_keyword_cost_str(kw, "Enchant")
                                })
                                .unwrap_or_default();
                            player.has_lost || !enchant_type.eq_ignore_ascii_case("Player")
                        }
                        (Some(host_id), _) => {
                            if host_id.index() >= self.cards.len() {
                                return true; // Invalid host ID
                            }
                            let host = &self.cards[host_id.index()];
                            // CR 704.5n: check if the enchant restriction is still met.
                            // E.g. "Enchant creature" requires a battlefield creature, while
                            // Animate Dead's "Enchant creature card in a graveyard" remains legal
                            // while attached to a creature card in a graveyard.
                            let enchant_type = c
                                .keywords
                                .iter_strings()
                                .find_map(|kw| {
                                    crate::keyword::extract_keyword_cost_str(kw, "Enchant")
                                })
                                .unwrap_or_default();
                            !crate::parsing::enchant_type_matches_card(enchant_type, host, Some(c))
                                || !can_attachment_remain_attached(&self.cards, c, host, true)
                        }
                    }
                })
                .map(|c| c.id)
                .collect();

            for aura_id in aura_ids {
                let owner = self.card(aura_id).owner;
                let old_zone = self.card(aura_id).zone;
                self.move_card(aura_id, ZoneType::Graveyard, owner);
                if let Some(handler) = trigger_handler.as_deref_mut() {
                    crate::ability::effects::emit_zone_trigger(
                        handler,
                        aura_id,
                        old_zone,
                        ZoneType::Graveyard,
                    );
                }
                any_changes = true;
            }
        }

        // Check game over
        let alive = self.alive_players();
        if alive.len() <= 1 {
            self.game_over = true;
            if alive.len() == 1 {
                self.winner = Some(alive[0]);
            }
        }

        any_changes
    }

    /// Untap all permanents controlled by a player.
    /// Runs Untap replacement effects for each permanent.
    pub fn untap_all(&mut self, player: PlayerId) {
        let cards: Vec<CardId> = self.cards_in_zone(ZoneType::Battlefield, player).to_vec();
        for cid in cards {
            // Use untap() which runs replacement effects
            self.untap_during_untap_step(cid, player);
        }
    }

    /// Draw a card for a player. Returns the drawn card ID, or None if the draw
    /// was skipped or the library is empty.
    ///
    /// Runs Draw replacement effects before drawing.  If the draw is replaced
    /// (e.g. "skip your draw step"), returns `None`.
    ///
    /// Mirrors Java `GameAction.draw()` calling `ReplacementHandler.run(Draw, …)`.
    pub fn draw_card(&mut self, player: PlayerId) -> Option<CardId> {
        self.player_draw_one(player)
    }

    /// Draw a card with agent access for Optional replacement effects (Dredge).
    pub fn draw_card_with_agents(
        &mut self,
        player: PlayerId,
        agents: &mut [Box<dyn crate::agent::PlayerAgent>],
    ) -> Option<CardId> {
        self.player_draw_one_internal(player, false, Some(agents))
    }

    /// Draw N cards for a player. Returns drawn card IDs.
    pub fn draw_cards(&mut self, player: PlayerId, n: usize) -> Vec<CardId> {
        self.player_draw_cards(player, n)
    }

    /// Shuffle a player's library using the provided RNG.
    pub fn shuffle_library(&mut self, player: PlayerId, rng: &mut impl rand::Rng) {
        self.shuffle_zone_cards_with_rand(ZoneType::Library, player, rng);
    }

    /// Reset per-turn state for all cards and players of a given player.
    pub fn new_turn_for_player(&mut self, player: PlayerId) {
        self.player_new_turn(player);
        // Reset turn-scoped player stats for ALL non-active players too.
        // These counters are "this turn" in the global turn sense, not "that
        // player's own turn". Without this, effects like Resplendent Angel can
        // incorrectly carry life gained from the previous player's turn.
        for pid in &self.player_order.clone() {
            if *pid != player {
                self.player_reset_drawn_this_turn(*pid);
                let p = self.player_mut(*pid);
                p.life_started_this_turn_with = p.life;
                p.life_gained_this_turn = 0;
                p.life_gained_by_team_this_turn = 0;
                p.life_gained_times_this_turn = 0;
                p.life_lost_last_turn = p.life_lost_this_turn;
                p.life_lost_this_turn = 0;
            }
        }

        let all_card_ids: Vec<CardId> = (0..self.cards.len()).map(|i| CardId(i as u32)).collect();
        for cid in all_card_ids {
            if self.cards[cid.index()].zone == ZoneType::Battlefield {
                self.cards[cid.index()].started_turn_tapped = self.cards[cid.index()].tapped;
            }
            if self.cards[cid.index()].controller == player {
                self.cards[cid.index()].new_turn();
            } else {
                self.cards[cid.index()].clear_global_turn_state();
            }
        }
    }

    /// Tap a card. Returns true if it was untapped.
    /// Runs Tap replacement effects before tapping.
    pub fn tap(&mut self, card_id: CardId) -> bool {
        let card = &self.cards[card_id.index()];
        if card.tapped {
            return false;
        }
        // Run Tap replacement effects.
        let mut event = ReplacementEvent::Tap { card: card_id };
        let result = apply_replacements(self, &mut event);
        if result == ReplacementResult::Skipped || result == ReplacementResult::Replaced {
            return false; // Tap was prevented
        }
        self.cards[card_id.index()].tapped = true;
        true
    }

    /// Untap a card. Returns true if it was tapped.
    /// Runs Untap replacement effects before untapping.
    pub fn untap(&mut self, card_id: CardId) -> bool {
        self.untap_internal(card_id, None)
    }

    pub fn untap_during_untap_step(&mut self, card_id: CardId, player: PlayerId) -> bool {
        self.untap_internal(card_id, Some(player))
    }

    fn untap_internal(&mut self, card_id: CardId, player: Option<PlayerId>) -> bool {
        let card = &self.cards[card_id.index()];
        if !card.tapped {
            return false;
        }
        let stun = CounterType::Named("STUN".to_string());
        if card.counter_count(&stun) > 0 && card.can_remove_counters(&stun) {
            // Stun counters replace the untap event: remove one counter and keep the
            // permanent tapped. This mirrors Java's built-in stun untap replacement.
            self.cards[card_id.index()].remove_counter(&stun, 1);
            return false;
        }
        // Run Untap replacement effects.
        let mut event = ReplacementEvent::Untap {
            card: card_id,
            player,
        };
        let result = apply_replacements(self, &mut event);
        if result == ReplacementResult::Skipped || result == ReplacementResult::Replaced {
            return false; // Untap was prevented
        }
        self.cards[card_id.index()].tapped = false;
        // `ControlGain$ LoseControl$ Untap` — revert scheduled steal now.
        crate::ability::effects::control_gain_effect::untap_hook(self, card_id);
        true
    }

    /// Change the controller of a permanent to `new_controller`.
    /// Mirrors Java's `GameAction.controllerChangeZoneCorrection()` — moves the
    /// card between per-player zone lists and updates the controller field.
    pub fn change_controller(&mut self, card_id: CardId, new_controller: PlayerId) {
        let card = &self.cards[card_id.index()];
        if card.controller == new_controller {
            return;
        }
        let old_controller = card.controller;
        let zone = card.zone;

        // Move between zone lists
        if zone != ZoneType::None {
            self.remove_card_from_zone(zone, old_controller, card_id);
            self.add_card_to_zone(zone, new_controller, card_id);
        }
        self.cards[card_id.index()].controller = new_controller;
    }

    /// Attach `aura_id` to `target_id`.
    /// If `aura_id` was already attached elsewhere, detach it first.
    /// Mirrors Java's `Card.enchantEntity()` / `Card.equip()`.
    pub fn attach_to(&mut self, aura_id: CardId, target_id: CardId) {
        // Detach from previous host if any
        self.detach(aura_id);
        self.cards[aura_id.index()].attached_to = Some(target_id);
        self.cards[aura_id.index()].attached_to_player = None;
        self.cards[aura_id.index()].attached_this_turn = true;
        self.cards[target_id.index()].attachments.push(aura_id);
    }

    pub fn attach_to_player(&mut self, aura_id: CardId, player_id: PlayerId) {
        self.detach(aura_id);
        self.cards[aura_id.index()].attached_to = None;
        self.cards[aura_id.index()].attached_to_player = Some(player_id);
        self.cards[aura_id.index()].attached_this_turn = true;
    }

    /// Detach `aura_id` from whatever it is currently attached to.
    /// Mirrors Java's `Card.unattachFromEntity()`.
    pub fn detach(&mut self, aura_id: CardId) {
        if let Some(host_id) = self.cards[aura_id.index()].attached_to.take() {
            self.cards[host_id.index()]
                .attachments
                .retain(|&a| a != aura_id);
            // Bestow: when unattached, revert to a creature
            self.cards[aura_id.index()].is_bestowed = false;
        }
        self.cards[aura_id.index()].attached_to_player = None;
    }

    /// Move a card from its current zone to the bottom of a player's library.
    /// Unlike `move_card`, this places the card at the bottom rather than the top.
    pub fn put_on_bottom_of_library(&mut self, card_id: CardId, owner: PlayerId) {
        let card = &self.cards[card_id.index()];
        let src_zone = card.zone;
        let src_owner = card.controller;

        if src_zone != ZoneType::None {
            self.remove_card_from_zone(src_zone, src_owner, card_id);
        }

        self.cards[card_id.index()].zone = ZoneType::Library;
        self.assign_zone_timestamp(card_id);
        self.add_card_to_zone_bottom(ZoneType::Library, owner, card_id);
    }

    /// Remove a spell from the stack by its entry ID (used by Counter).
    /// Mirrors Java's `Game.getStack().remove(sa)`.
    pub fn remove_from_stack(&mut self, entry_id: u32) -> bool {
        self.stack.remove_by_id(entry_id).is_some()
    }
}

fn can_attachment_remain_attached(
    cards: &[Card],
    attachment: &Card,
    target: &Card,
    check_sba: bool,
) -> bool {
    if target.zone != ZoneType::Battlefield {
        return true;
    }
    if crate::staticability::static_ability_cant_attach::cant_attach(
        cards, attachment, target, check_sba,
    ) {
        return false;
    }
    !crate::staticability::static_ability_colorless_damage_source::target_is_protected_from_source(
        cards, target, attachment,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::Card;
    use crate::player::RegisteredPlayer;
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost};

    fn make_creature(game: &mut GameState, name: &str, owner: PlayerId, p: i32, t: i32) -> CardId {
        let card = Card::new(
            CardId(0),
            name.to_string(),
            owner,
            CardTypeLine::parse("Creature Bear"),
            ManaCost::parse("1 G"),
            ColorSet::GREEN,
            Some(p),
            Some(t),
            vec![],
            vec![],
        );
        game.create_card(card)
    }

    #[test]
    fn move_card_to_battlefield() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let cid = make_creature(&mut game, "Bear", PlayerId(0), 2, 2);
        game.move_card(cid, ZoneType::Hand, PlayerId(0));
        assert_eq!(game.zone(ZoneType::Hand, PlayerId(0)).len(), 1);

        game.move_card(cid, ZoneType::Battlefield, PlayerId(0));
        assert_eq!(game.zone(ZoneType::Hand, PlayerId(0)).len(), 0);
        assert_eq!(game.zone(ZoneType::Battlefield, PlayerId(0)).len(), 1);
        assert_eq!(game.card(cid).zone, ZoneType::Battlefield);
    }

    #[test]
    fn state_based_actions_lethal_damage() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let cid = make_creature(&mut game, "Bear", PlayerId(0), 2, 2);
        game.move_card(cid, ZoneType::Battlefield, PlayerId(0));

        game.deal_damage_to_card(cid, 2);
        assert!(game.check_state_based_actions());
        assert_eq!(game.zone(ZoneType::Graveyard, PlayerId(0)).len(), 1);
    }

    #[test]
    fn state_based_actions_zero_life() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        game.deal_damage_to_player(PlayerId(0), 20);
        game.check_state_based_actions();
        assert!(game.player(PlayerId(0)).has_lost);
        assert!(game.game_over);
        assert_eq!(game.winner, Some(PlayerId(1)));
    }

    #[test]
    fn draw_card() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let cid = make_creature(&mut game, "Bear", PlayerId(0), 2, 2);
        game.move_card(cid, ZoneType::Library, PlayerId(0));

        let drawn = game.draw_card(PlayerId(0));
        assert_eq!(drawn, Some(cid));
        assert_eq!(game.card(cid).zone, ZoneType::Hand);
    }

    #[test]
    fn tap_untap() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let cid = make_creature(&mut game, "Bear", PlayerId(0), 2, 2);
        game.move_card(cid, ZoneType::Battlefield, PlayerId(0));

        assert!(game.tap(cid));
        assert!(game.card(cid).tapped);
        assert!(!game.tap(cid)); // already tapped
        assert!(game.untap(cid));
        assert!(!game.card(cid).tapped);
    }

    #[test]
    fn stun_counter_replaces_untap() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let cid = make_creature(&mut game, "Bear", PlayerId(0), 2, 2);
        game.move_card(cid, ZoneType::Battlefield, PlayerId(0));
        game.tap(cid);
        game.card_mut(cid)
            .add_counter(&CounterType::Named("STUN".to_string()), 1);

        assert!(!game.untap(cid));
        assert!(game.card(cid).tapped);
        assert_eq!(
            game.card(cid)
                .counter_count(&CounterType::Named("STUN".to_string())),
            0
        );
    }
}
