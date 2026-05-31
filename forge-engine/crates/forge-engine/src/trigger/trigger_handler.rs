use std::collections::HashSet;

use forge_foundation::ZoneType;

use crate::agent::{notify_all_agents, GameLogEvent, PlayerAgent};
use crate::card::valid_filter;
use crate::event::RunParams;
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::mana::ManaPool;
use crate::parsing::compare::compare_expr;
use crate::spellability::{build_spell_ability, StackEntry};
use crate::trigger::TriggerType;
use crate::trigger::{parse_trigger, Trigger};

/// An active trigger reference — (card_id, trigger_index) pair.
/// In Java this is a direct Trigger object reference. In Rust,
/// we use IDs because of the arena pattern (no references).
#[derive(Debug, Clone)]
struct ActiveTrigger {
    card_id: CardId,
    trigger_index: usize,
}

/// Mirrors Java's TriggerWaiting.
#[derive(Debug, Clone)]
struct TriggerWaiting {
    mode: TriggerType,
    params: RunParams,
    trigger_refs: Option<Vec<(CardId, usize)>>,
}

/// A one-shot delayed trigger.
#[derive(Debug, Clone)]
pub struct DelayedTrigger {
    pub mode: TriggerType,
    pub trigger_mode: Box<dyn crate::trigger::TriggerBehavior>,
    pub params: crate::parsing::Params,
    pub execute_svar: String,
    pub controller: PlayerId,
    pub source_card: CardId,
    /// Turn number when this delayed trigger was registered.
    pub created_turn: u32,
    /// Phase during which this delayed trigger was registered.
    pub created_phase: forge_foundation::PhaseType,
    /// Optional target card for the delayed trigger (e.g. the creature to bounce for Dash
    /// or sacrifice for Blitz at end of turn).
    pub target_card: Option<CardId>,
    /// Sum of integer values remembered by the delayed trigger at creation.
    pub remembered_amount: i32,
    /// Cards remembered by the delayed trigger (e.g. `RememberObjects$ Remembered`
    /// copies the source card's remembered_cards snapshot at registration time).
    /// Exposed to the executed ability via `SpellAbility::trigger_remembered`.
    #[allow(dead_code)]
    pub remembered_cards: Vec<CardId>,
    /// Players remembered by the delayed trigger (e.g.
    /// `RememberObjects$ RememberedController` snapshots the controllers of
    /// the source's remembered cards at registration time, used by Arcane
    /// Denial's "may draw up to two cards" trigger to remember the controller
    /// of the countered spell). Exposed via `SpellAbility::trigger_remembered`
    /// as `AbilityValue::Player(_)` entries.
    pub remembered_players: Vec<PlayerId>,
    /// Snapshot of remembered cards for delayed-trigger `RememberedLKI` lookups.
    pub remembered_lki_cards: Vec<CardId>,
    /// When true, this delayed trigger should sort AFTER same-event active
    /// triggers (resolve FIRST on the LIFO stack). Used to mirror Java's
    /// trigger-ID-based ordering for granted-evoke sacrifice triggers, whose
    /// trigger ID is assigned after the card's intrinsic T: triggers and thus
    /// lands on top of the stack.
    pub sort_after_active: bool,
    /// Java delayed triggers are real Trigger instances and receive a trigger
    /// id when parsed. Assign the equivalent order at registration so
    /// simultaneous delayed triggers do not tie on host timestamp.
    pub trigger_order: Option<u32>,
}

impl DelayedTrigger {
    /// Build a temporary `Trigger` wrapper for calling `TriggerBehavior` trait methods
    /// that require a `&Trigger` reference (Java's `this`).
    pub fn as_trigger(&self, _game: &crate::game::GameState) -> crate::trigger::Trigger {
        let Self {
            params: delayed_params,
            ..
        } = self;
        let mut base =
            crate::game_loop::trigger_replacement_base::TriggerReplacementBase::default();
        base.set_host_card_id(self.source_card);
        crate::trigger::Trigger {
            id: self.trigger_order.unwrap_or(u32::MAX),
            base,
            kind: self.mode,
            mode: dyn_clone::clone_box(&*self.trigger_mode),
            ir: crate::trigger::trigger_ir::TriggerIr::from_params(delayed_params),
            execute: self.execute_svar.clone(),
            optional: false,
            description: String::new(),
            static_trigger: false,
            trigger_remembered: self
                .remembered_cards
                .iter()
                .copied()
                .map(crate::event::AbilityValue::Card)
                .collect(),
            spawning_ability: None,
        }
    }
}

/// A triggered ability ready to be placed on the stack, with optional metadata.
#[derive(Debug, Clone)]
pub struct PendingTrigger {
    pub entry: StackEntry,
    pub ability_triggered: Option<RunParams>,
    /// Whether this trigger is optional (has OptionalDecider$).
    pub optional: bool,
    /// The player who decides whether the trigger fires (usually the controller).
    pub decider: PlayerId,
    /// Description text for the trigger (shown to player for optional triggers).
    pub description: String,
}

#[derive(Debug, Clone)]
pub struct TriggerPushLog {
    pub source_name: String,
    pub player_name: String,
    pub optional: bool,
    pub trigger_api: String,
}

type MatchedTrigger = (PendingTrigger, PlayerId, u64, u8, u32);

/// Mirrors Java's TriggerHandler — central trigger dispatcher.
/// In Java, lives on Game. In Rust, lives on GameLoop because
/// active_triggers and waiting_triggers are transient processing state.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct TriggerHandler {
    active_triggers: Vec<ActiveTrigger>,
    waiting_triggers: Vec<TriggerWaiting>,
    delayed_triggers: Vec<DelayedTrigger>,
    this_turn_delayed_triggers: Vec<DelayedTrigger>,
    player_defined_delayed_triggers: Vec<(PlayerId, DelayedTrigger)>,
    suppressed_modes: HashSet<TriggerType>,
    all_suppressed: bool,
    next_trigger_id: u32,
    /// Triggers that were matched early (before SBA) and are waiting to be
    /// placed on the stack. This ensures triggers from creatures that die to
    /// SBA (e.g. Raptor Hatchling's enrage) are not lost.
    /// Tuple: (PendingTrigger, controller, zone timestamp, trigger bucket, trigger order).
    pre_matched_triggers: Vec<MatchedTrigger>,
}

impl TriggerHandler {
    pub fn new() -> Self {
        TriggerHandler {
            active_triggers: Vec::new(),
            waiting_triggers: Vec::new(),
            delayed_triggers: Vec::new(),
            this_turn_delayed_triggers: Vec::new(),
            player_defined_delayed_triggers: Vec::new(),
            suppressed_modes: HashSet::new(),
            all_suppressed: false,
            next_trigger_id: 0,
            pre_matched_triggers: Vec::new(),
        }
    }

    /// Mirrors Java's runTrigger() — main entry point.
    /// Called from game actions when events occur.
    /// If `hold` is true, event is queued; otherwise it's also queued
    /// (all triggers go through the waiting queue for APNAP ordering).
    pub fn run_trigger(&mut self, mode: TriggerType, params: RunParams, hold: bool) {
        if self.is_trigger_suppressed(mode) {
            return;
        }

        // Java parity: mana triggers are not held/frozen. We don't run them inline
        // here because matching still flows through waiting processing, but we do
        // force front-of-queue delivery when hold is false.
        let urgent = !hold
            && matches!(
                mode,
                TriggerType::Always | TriggerType::TapsForMana | TriggerType::ManaAdded
            );
        if urgent {
            self.waiting_triggers
                .insert(0, self.build_waiting_trigger(mode, params.clone()));
        } else {
            self.waiting_triggers
                .push(self.build_waiting_trigger(mode, params.clone()));
        }

        if mode == TriggerType::SpellCast {
            self.waiting_triggers
                .push(self.build_waiting_trigger(TriggerType::SpellAbilityCast, params.clone()));
            self.waiting_triggers
                .push(self.build_waiting_trigger(TriggerType::SpellCastOrCopy, params.clone()));
        }
        if mode == TriggerType::AbilityCast {
            self.waiting_triggers
                .push(self.build_waiting_trigger(TriggerType::SpellAbilityCast, params.clone()));
        }
        if mode == TriggerType::SpellCopied {
            self.waiting_triggers
                .push(self.build_waiting_trigger(TriggerType::SpellCopy, params.clone()));
            self.waiting_triggers
                .push(self.build_waiting_trigger(TriggerType::SpellAbilityCopy, params.clone()));
            self.waiting_triggers
                .push(self.build_waiting_trigger(TriggerType::SpellCastOrCopy, params.clone()));
        }
    }

    /// Java-parity entrypoint that can resolve triggers immediately when the
    /// event should not be held/frozen.
    pub fn run_trigger_with_game(
        &mut self,
        game: &GameState,
        mode: TriggerType,
        params: RunParams,
        hold: bool,
    ) -> Vec<PendingTrigger> {
        self.run_trigger(mode, params, hold);
        let resolve_now = mode == TriggerType::Always
            || (!hold
                && !game.stack.is_frozen()
                && !matches!(mode, TriggerType::TapsForMana | TriggerType::ManaAdded));
        if resolve_now {
            self.run_waiting_triggers(game)
        } else {
            Vec::new()
        }
    }

    /// Java parity wrapper for TriggerHandler.parseTrigger(String).
    pub fn parse_trigger(&mut self, raw: &str) -> Option<Trigger> {
        parse_trigger(raw, &mut self.next_trigger_id)
    }

    /// Java parity wrapper for TriggerHandler.collectTriggerForWaiting(...).
    pub fn collect_trigger_for_waiting(&mut self, mode: TriggerType, params: RunParams) {
        self.waiting_triggers
            .push(self.build_waiting_trigger(mode, params));
    }

    /// Number of triggers in the waiting queue (for debug/diagnostics).
    pub fn waiting_trigger_count(&self) -> usize {
        self.waiting_triggers.len()
    }

    pub fn pre_matched_trigger_count(&self) -> usize {
        self.pre_matched_triggers.len()
    }

    /// Match waiting triggers NOW, while source cards are still in their
    /// current zones.  Stores results in `pre_matched_triggers` so that a
    /// subsequent `run_waiting_triggers` call returns them even if SBA has
    /// since moved the source card (e.g. Raptor Hatchling dying to combat
    /// damage before triggers go on the stack).
    ///
    /// Call this immediately after firing triggers and before SBA.
    /// Returns true if any active trigger is a Drawn trigger with Number$ set.
    /// Used to gate flush_waiting_triggers during draws to avoid disrupting
    /// other trigger matching when no Number$-gated Drawn triggers exist.
    pub fn has_number_drawn_triggers(&self, game: &GameState) -> bool {
        self.active_triggers.iter().any(|at| {
            let card = game.card(at.card_id);
            if at.trigger_index >= card.triggers.len() {
                return false;
            }
            {
                let t = &card.triggers[at.trigger_index];
                t.kind == TriggerType::Drawn && t.mode.drawn_number().is_some()
            }
        })
    }

    pub fn flush_waiting_triggers(&mut self, game: &GameState) {
        if self.waiting_triggers.is_empty() && self.delayed_triggers.is_empty() {
            return;
        }
        let matched = self.match_waiting_triggers(game);
        self.pre_matched_triggers.extend(matched);
    }

    /// Mirrors Java's runWaitingTriggers().
    /// Drains waiting queue, matches triggers, returns PendingTriggers.
    /// The caller (game_loop) handles OptionalDecider$ prompting.
    pub fn run_waiting_triggers(&mut self, game: &GameState) -> Vec<PendingTrigger> {
        // Start with any triggers that were pre-matched (flushed before SBA).
        let mut entries: Vec<MatchedTrigger> = std::mem::take(&mut self.pre_matched_triggers);

        if self.waiting_triggers.is_empty() && self.delayed_triggers.is_empty() {
            if entries.is_empty() {
                return Vec::new();
            }
            // Only have pre-matched — apply APNAP + zone timestamp ordering.
            let active_player = game.active_player();
            entries.sort_by_key(|(_, controller, ts, trigger_bucket, trigger_order)| {
                (
                    if *controller == active_player { 0u8 } else { 1 },
                    if *trigger_bucket == 2 { 1u8 } else { 0 },
                    *ts,
                    *trigger_bucket,
                    *trigger_order,
                )
            });
            return entries
                .into_iter()
                .map(|(pending, _, _, _, _)| pending)
                .collect();
        }

        // Match any remaining waiting triggers (those fired after the flush).
        entries.extend(self.match_waiting_triggers(game));

        // Fire Immediate delayed triggers — these fire "as soon as possible"
        // without waiting for a matching event (mirrors Java registerDelayedTrigger
        // with TriggerType.Immediate).
        entries.extend(self.fire_immediate_delayed_triggers(game));

        // APNAP ordering: active player's triggers first.
        // Within the same player, order by zone_timestamp (older cards first),
        // matching Java's forEachCardInGame() which iterates by Zone.cardList
        // insertion order.
        let active_player = game.active_player();
        entries.sort_by_key(|(_, controller, ts, trigger_bucket, trigger_order)| {
            (
                if *controller == active_player { 0u8 } else { 1 },
                if *trigger_bucket == 2 { 1u8 } else { 0 },
                *ts,
                *trigger_bucket,
                *trigger_order,
            )
        });

        entries
            .into_iter()
            .map(|(pending, _, _, _, _)| pending)
            .collect()
    }

    pub fn process_waiting_triggers(
        &mut self,
        mana_pools: &[ManaPool],
        game: &mut GameState,
        agents: &mut [Box<dyn PlayerAgent>],
    ) -> Vec<TriggerPushLog> {
        let pending = self.run_waiting_triggers(game);
        self.process_pending_triggers(mana_pools, game, agents, pending)
    }

    pub fn process_pending_triggers(
        &mut self,
        mana_pools: &[ManaPool],
        game: &mut GameState,
        agents: &mut [Box<dyn PlayerAgent>],
        pending: Vec<PendingTrigger>,
    ) -> Vec<TriggerPushLog> {
        let mut push_logs = Vec::new();
        for mut pt in pending {
            let source_name = pt
                .entry
                .spell_ability
                .source
                .and_then(|id| game.cards.get(id.index()).map(|c| c.card_name.clone()))
                .unwrap_or_else(|| "Triggered ability".to_string());
            let player_name = game
                .player(pt.entry.spell_ability.activating_player)
                .name
                .clone();

            if pt.entry.spell_ability.api == Some(crate::ability::api_type::ApiType::Charm)
                && !crate::ability::effects::charm_effect::make_choices_precast(
                    game,
                    agents,
                    &mut pt.entry.spell_ability,
                )
            {
                continue;
            }

            let setup_result = pt
                .entry
                .spell_ability
                .setup_targets(game, agents, mana_pools);
            if !setup_result {
                continue;
            }
            if let Some(source_id) = pt.entry.spell_ability.source {
                crate::ability::effects::emit_targeting_triggers_for_sa(
                    self,
                    game,
                    source_id,
                    &pt.entry.spell_ability,
                );
            }

            if pt.optional {
                pt.entry.optional_trigger_decider = Some(pt.decider);
                pt.entry.optional_trigger_description = Some(pt.description.clone());
                pt.entry.optional_trigger_source_name = Some(source_name.clone());
            }

            if let Some(source_id) = pt.entry.spell_ability.trigger_source {
                if let Some(trig_idx) = pt.entry.spell_ability.trigger_index {
                    if let Some(trigger) = game
                        .cards
                        .get(source_id.index())
                        .and_then(|c| c.triggers.get(trig_idx))
                        .cloned()
                    {
                        trigger.trigger_run(game, source_id);
                    }
                }
            }

            let trigger_mode = pt
                .entry
                .spell_ability
                .trigger_source
                .and_then(|source_id| {
                    pt.entry.spell_ability.trigger_index.and_then(|idx| {
                        game.cards
                            .get(source_id.index())
                            .and_then(|c| c.triggers.get(idx))
                            .map(|t| t.kind.name().to_string())
                    })
                })
                .unwrap_or_else(|| "DelayedOrUnknown".to_string());
            let trigger_api = pt
                .entry
                .spell_ability
                .api
                .map(|a| a.name().to_string())
                .unwrap_or_else(|| "Unknown".to_string());

            let trigger_msg = if pt.description.is_empty() {
                format!(
                    "Trigger fired: mode={} | api={} | source={}",
                    trigger_mode, trigger_api, source_name
                )
            } else {
                format!(
                    "Trigger fired: mode={} | api={} | source={} | {}",
                    trigger_mode, trigger_api, source_name, pt.description
                )
            };
            let mut event = GameLogEvent::stack(trigger_msg)
                .with_player(pt.entry.spell_ability.activating_player);
            if let Some(source_id) = pt.entry.spell_ability.source {
                event = event.with_source_card(source_id);
            }
            if let Some(target_id) = pt.entry.spell_ability.target_chosen.target_card {
                event = event.with_target_card(target_id);
            }
            notify_all_agents(agents, event);

            let is_optional = pt.optional;
            let pushed_entry = pt.entry.clone();
            game.stack.push(pt.entry);
            if pushed_entry.spell_ability.is_trigger {
                let source_card = pushed_entry.spell_ability.source;
                self.run_trigger(
                    TriggerType::SpellAbilityCast,
                    RunParams {
                        card: source_card,
                        spell_card: source_card,
                        player: Some(pushed_entry.spell_ability.activating_player),
                        activator: Some(pushed_entry.spell_ability.activating_player),
                        spell_controller: Some(pushed_entry.spell_ability.activating_player),
                        spell_ability: Some(pushed_entry.spell_ability.clone()),
                        source_sa: Some(pushed_entry.spell_ability.clone()),
                        cause: Some(pushed_entry.spell_ability.clone()),
                        cause_card: source_card,
                        ..Default::default()
                    },
                    true,
                );
                if let Some(mut ability_triggered) = pt.ability_triggered.clone() {
                    ability_triggered.spell_ability = Some(pushed_entry.spell_ability.clone());
                    ability_triggered.source_sa = Some(pushed_entry.spell_ability.clone());
                    if ability_triggered.cause_card.is_none() {
                        ability_triggered.cause_card = source_card;
                    }
                    self.run_trigger(TriggerType::AbilityTriggered, ability_triggered, false);
                }
            }
            push_logs.push(TriggerPushLog {
                source_name,
                player_name,
                optional: is_optional,
                trigger_api,
            });
        }
        push_logs
    }

    /// Drain `waiting_triggers`, match them against active and delayed triggers,
    /// and return the matched entries.  This is the core matching logic shared by
    /// both `flush_waiting_triggers` and `run_waiting_triggers`.
    fn match_waiting_triggers(&mut self, game: &GameState) -> Vec<MatchedTrigger> {
        let waiting = std::mem::take(&mut self.waiting_triggers);
        let mut entries: Vec<MatchedTrigger> = Vec::new();

        for event in &waiting {
            let mut trigger_refs: Vec<(CardId, usize, usize)> =
                if let Some(stored_refs) = &event.trigger_refs {
                    stored_refs
                        .iter()
                        .enumerate()
                        .map(|(idx, (card_id, trigger_index))| (*card_id, *trigger_index, idx))
                        .collect()
                } else {
                    self.active_triggers
                        .iter()
                        .enumerate()
                        .map(|(idx, active)| (active.card_id, active.trigger_index, idx))
                        .collect()
                };
            if event.trigger_refs.is_none() {
                for (card_id, trigger_index) in self.ltb_trigger_refs_for_event(game, event) {
                    if !trigger_refs.iter().any(|(existing_card, existing_idx, _)| {
                        *existing_card == card_id && *existing_idx == trigger_index
                    }) {
                        trigger_refs.push((card_id, trigger_index, usize::MAX));
                    }
                }
            }
            trigger_refs.sort_by_key(|&(card_id, trigger_index, idx)| {
                let card = game.card(card_id);
                let is_static = card
                    .triggers
                    .get(trigger_index)
                    .map(|trigger| !trigger.is_static())
                    .unwrap_or(true);
                (is_static, idx)
            });

            let event_entries_start = entries.len();

            // Check each active trigger plus any Java-style LTB look-back triggers.
            for (card_id, trigger_index, _) in trigger_refs {
                let card = game.card(card_id);
                if trigger_index >= card.triggers.len() {
                    continue;
                }
                let trigger = &card.triggers[trigger_index];
                let host_controller = card.controller;
                if crate::staticability::static_ability_disable_triggers::is_disabled(
                    game,
                    card_id,
                    trigger,
                    &event.params,
                ) {
                    continue;
                }

                let can_run = self.can_run_trigger(
                    game,
                    card_id,
                    trigger_index,
                    host_controller,
                    &event.mode,
                    &event.params,
                );
                if can_run {
                    let sa = trigger.build_triggered_spell_ability(
                        game,
                        card_id,
                        host_controller,
                        trigger_index,
                        &event.params,
                    );

                    let entry = StackEntry {
                        id: 0,
                        spell_ability: sa,
                        is_pending_cast: false,
                        is_creature_spell: false,
                        is_permanent_spell: false,
                        cast_from_zone: None,
                        optional_trigger_decider: None,
                        optional_trigger_description: None,
                        optional_trigger_source_name: None,
                    };
                    // A trigger is optional if it has OptionalDecider$ OR if its
                    // execute SVar has a non-mandatory, non-zero cost.  Mirrors Java's
                    // Trigger.isOptional() which checks both the trigger flag and cost.
                    // E.g. Smuggler's Copter loot "Cost$ Draw<1/You>" → optional.
                    let trigger_cost_optional = entry
                        .spell_ability
                        .pay_costs
                        .as_ref()
                        .map(|c| !c.mandatory && !c.is_zero_cost())
                        .unwrap_or(false);
                    let effect_optional_decider =
                        entry.spell_ability.ir.optional_decider_text.is_some();
                    let description_lower = trigger.description.to_ascii_lowercase();
                    let description_implies_optional = description_lower.starts_with("you may")
                        && !entry.spell_ability.ir.optional
                        && !effect_optional_decider;
                    let pending = PendingTrigger {
                        ability_triggered: Some(
                            crate::trigger::trigger_ability_triggered::build_run_params(
                                trigger,
                                &entry.spell_ability,
                                &event.params,
                                game,
                            ),
                        ),
                        entry,
                        optional: (trigger.optional && !effect_optional_decider)
                            || trigger_cost_optional
                            || description_implies_optional,
                        decider: host_controller,
                        description: trigger.description.clone(),
                    };
                    // `Card.gameTimestamp` skips Stack moves; clamp Stack
                    // sources to 0 so sort matches `GameAction.changeZone`.
                    let source_ts = if card.zone == ZoneType::Stack {
                        0
                    } else {
                        card.zone_timestamp
                    };
                    entries.push((pending, host_controller, source_ts, 1, trigger.id));
                    let extra = crate::staticability::static_ability_panharmonicon::extra_triggers(
                        game,
                        card_id,
                        trigger,
                        &event.params,
                    );
                    for _ in 0..extra {
                        let sa2 = trigger.build_triggered_spell_ability(
                            game,
                            card_id,
                            host_controller,
                            trigger_index,
                            &event.params,
                        );
                        let extra_entry = StackEntry {
                            id: 0,
                            spell_ability: sa2,
                            is_pending_cast: false,
                            is_creature_spell: false,
                            is_permanent_spell: false,
                            cast_from_zone: None,
                            optional_trigger_decider: None,
                            optional_trigger_description: None,
                            optional_trigger_source_name: None,
                        };
                        let trigger_cost_optional = extra_entry
                            .spell_ability
                            .pay_costs
                            .as_ref()
                            .map(|c| !c.mandatory && !c.is_zero_cost())
                            .unwrap_or(false);
                        let effect_optional_decider =
                            extra_entry.spell_ability.ir.optional_decider_text.is_some();
                        entries.push((
                            PendingTrigger {
                                ability_triggered: Some(
                                    crate::trigger::trigger_ability_triggered::build_run_params(
                                        trigger,
                                        &extra_entry.spell_ability,
                                        &event.params,
                                        game,
                                    ),
                                ),
                                entry: extra_entry,
                                optional: (trigger.optional && !effect_optional_decider)
                                    || trigger_cost_optional,
                                decider: host_controller,
                                description: trigger.description.clone(),
                            },
                            host_controller,
                            source_ts,
                            1,
                            trigger.id,
                        ));
                    }
                }
            }

            // Check delayed triggers (one-shot, removed after firing).
            //
            // Java places same-event delayed triggers such as Evoke's sacrifice
            // below normal ETB triggers by default, so the normal ETB resolves
            // first. Since the stack is LIFO and pending triggers are pushed in
            // list order, insert delayed matches before active matches for this
            // event. Delayed triggers marked `sort_after_active` (granted-evoke
            // sac) instead push AFTER active triggers and resolve first, mirroring
            // Java's trigger-ID ascending sort when the granted keyword's trigger
            // ID is higher than the card's intrinsic T: triggers.
            let delayed_insert_at = event_entries_start;
            let mut delayed_insert_offset = 0usize;
            let mut fired_indices = Vec::new();
            for (idx, delayed) in self.delayed_triggers.iter().enumerate() {
                let TriggerWaiting {
                    params: event_payload,
                    ..
                } = &event;
                if delayed.mode != event.mode {
                    continue;
                }
                if delayed.mode == TriggerType::Phase
                    && delayed.created_turn == game.turn.turn_number
                    && event_payload.phase == Some(delayed.created_phase)
                {
                    continue;
                }
                let tmp_trigger = delayed.as_trigger(game);
                if !delayed
                    .trigger_mode
                    .perform_test(&tmp_trigger, event_payload, game)
                {
                    continue;
                }
                let mut sa = build_spell_ability(
                    game,
                    delayed.source_card,
                    &delayed.execute_svar,
                    delayed.controller,
                );
                sa.is_trigger = true;
                sa.trigger_source = Some(delayed.source_card);
                sa.trigger_source_zone_timestamp =
                    Some(game.card(delayed.source_card).zone_timestamp);
                sa.trigger_remembered_amount = delayed.remembered_amount;
                // Propagate remembered cards (e.g. `RememberObjects$ Remembered`
                // captured at registration) so the executed ability can target
                // exactly the cards the parent trigger remembered.
                sa.trigger_remembered.extend(
                    delayed
                        .remembered_cards
                        .iter()
                        .copied()
                        .map(crate::event::AbilityValue::Card),
                );
                // Players from `RememberObjects$ RememberedController` (e.g.
                // Arcane Denial's "may draw up to two cards" trigger snapshots
                // the controller of the countered spell at registration).
                sa.trigger_remembered.extend(
                    delayed
                        .remembered_players
                        .iter()
                        .copied()
                        .map(crate::event::AbilityValue::Player),
                );
                if !delayed.remembered_lki_cards.is_empty() {
                    sa.trigger_remembered.extend(
                        delayed
                            .remembered_lki_cards
                            .iter()
                            .copied()
                            .map(crate::event::AbilityValue::Card),
                    );
                    sa.trigger_objects.insert(
                        crate::ability::AbilityKey::RememberedLKI,
                        delayed
                            .remembered_lki_cards
                            .iter()
                            .map(|card_id| card_id.0.to_string())
                            .collect::<Vec<_>>()
                            .join(",")
                            .into(),
                    );
                }

                let entry = StackEntry {
                    id: 0,
                    spell_ability: sa,
                    is_pending_cast: false,
                    is_creature_spell: false,
                    is_permanent_spell: false,
                    cast_from_zone: None,
                    optional_trigger_decider: None,
                    optional_trigger_description: None,
                    optional_trigger_source_name: None,
                };
                let pending = PendingTrigger {
                    ability_triggered: Some(
                        crate::trigger::trigger_ability_triggered::build_run_params(
                            &tmp_trigger,
                            &entry.spell_ability,
                            event_payload,
                            game,
                        ),
                    ),
                    entry,
                    optional: false,
                    decider: delayed.controller,
                    description: String::new(),
                };
                let delayed_ts = if delayed.mode == TriggerType::Phase {
                    0
                } else {
                    game.card(delayed.source_card).zone_timestamp
                };
                let delayed_bucket = if delayed.sort_after_active { 2 } else { 0 };
                let delayed_order = delayed.trigger_order.unwrap_or(0);
                // Java parity: Panharmonicon-class statics (e.g. Yarok, Roaming Throne)
                // double triggered abilities of permanents the owner controls. Rust
                // implements Evoke-style sacrifice and other keyword-induced triggers
                // as DelayedTrigger instances; the non-delayed path at ~L580 already
                // consults `extra_triggers`, but delayed matches bypassed it until now.
                // Replicate the same check so that when Yarok's own Panharmonicon
                // fires during its Evoke-on-ETB sacrifice, it doubles the trigger
                // (matching Java's `amt=2` on `valid=Card.Self+evoked`).
                let extra_delayed =
                    crate::staticability::static_ability_panharmonicon::extra_triggers(
                        game,
                        delayed.source_card,
                        &tmp_trigger,
                        event_payload,
                    );
                if delayed.sort_after_active {
                    // Push to end of entries (above active triggers → resolves first).
                    entries.push((
                        pending.clone(),
                        delayed.controller,
                        delayed_ts,
                        delayed_bucket,
                        delayed_order,
                    ));
                    for _ in 0..extra_delayed {
                        entries.push((
                            pending.clone(),
                            delayed.controller,
                            delayed_ts,
                            delayed_bucket,
                            delayed_order,
                        ));
                    }
                } else {
                    entries.insert(
                        delayed_insert_at + delayed_insert_offset,
                        (
                            pending.clone(),
                            delayed.controller,
                            delayed_ts,
                            delayed_bucket,
                            delayed_order,
                        ),
                    );
                    delayed_insert_offset += 1;
                    for _ in 0..extra_delayed {
                        entries.insert(
                            delayed_insert_at + delayed_insert_offset,
                            (
                                pending.clone(),
                                delayed.controller,
                                delayed_ts,
                                delayed_bucket,
                                delayed_order,
                            ),
                        );
                        delayed_insert_offset += 1;
                    }
                }
                fired_indices.push(idx);
            }

            // Remove fired delayed triggers (reverse order to preserve indices).
            for idx in fired_indices.into_iter().rev() {
                self.delayed_triggers.remove(idx);
            }
        }

        entries
    }

    fn build_waiting_trigger(&self, mode: TriggerType, params: RunParams) -> TriggerWaiting {
        // Snapshot active triggers for events whose matching must reflect the
        // state AT event time, not at flush time. Java evaluates SpellCast
        // triggers immediately against triggers active on the battlefield —
        // a spell's own `TriggerZones$ Battlefield` trigger cannot fire for
        // its own cast because the card is still on the stack when the event
        // dispatches. Rust flushes later, so without a snapshot the newly
        // battlefield-registered self-trigger would incorrectly match.
        let snapshot_active = matches!(
            mode,
            TriggerType::ChangesZone
                | TriggerType::ChangesZoneAll
                | TriggerType::Drawn
                | TriggerType::SpellCast
                | TriggerType::SpellAbilityCast
                | TriggerType::SpellCastAll
                | TriggerType::SpellCastOnce
                | TriggerType::SpellCastOfType
                | TriggerType::SpellCopied
                | TriggerType::SpellCopy
                | TriggerType::SpellAbilityCopy
                | TriggerType::SpellCastOrCopy
                | TriggerType::AbilityCast
        );
        let trigger_refs = if snapshot_active {
            let snap: Vec<(CardId, usize)> = self
                .active_triggers
                .iter()
                .map(|active| (active.card_id, active.trigger_index))
                .collect();
            Some(snap)
        } else {
            None
        };

        TriggerWaiting {
            mode,
            params,
            trigger_refs,
        }
    }

    /// Fire Immediate delayed triggers — these fire on the next trigger
    /// processing cycle without needing a matching event. Mirrors Java's
    /// `TriggerImmediate` which has `performTest()` returning true always.
    fn fire_immediate_delayed_triggers(&mut self, game: &GameState) -> Vec<MatchedTrigger> {
        let mut entries = Vec::new();
        let mut fired_indices = Vec::new();
        for (idx, delayed) in self.delayed_triggers.iter().enumerate() {
            if delayed.mode != TriggerType::Immediate {
                continue;
            }
            // Look up the Execute SVar on the source card
            let svar_text = game
                .card(delayed.source_card)
                .svars
                .get(&delayed.execute_svar)
                .cloned();
            if let Some(text) = svar_text {
                let mut sa =
                    build_spell_ability(game, delayed.source_card, &text, delayed.controller);
                sa.is_trigger = true;
                sa.trigger_source = Some(delayed.source_card);
                sa.trigger_source_zone_timestamp =
                    Some(game.card(delayed.source_card).zone_timestamp);
                if !delayed.remembered_lki_cards.is_empty() {
                    sa.trigger_remembered.extend(
                        delayed
                            .remembered_lki_cards
                            .iter()
                            .copied()
                            .map(crate::event::AbilityValue::Card),
                    );
                    sa.trigger_objects.insert(
                        crate::ability::AbilityKey::RememberedLKI,
                        delayed
                            .remembered_lki_cards
                            .iter()
                            .map(|card_id| card_id.0.to_string())
                            .collect::<Vec<_>>()
                            .join(",")
                            .into(),
                    );
                }

                let entry = StackEntry {
                    id: 0,
                    spell_ability: sa,
                    is_pending_cast: false,
                    is_creature_spell: false,
                    is_permanent_spell: false,
                    cast_from_zone: None,
                    optional_trigger_decider: None,
                    optional_trigger_description: None,
                    optional_trigger_source_name: None,
                };
                let pending = PendingTrigger {
                    ability_triggered: Some(
                        crate::trigger::trigger_ability_triggered::build_run_params(
                            &delayed.as_trigger(game),
                            &entry.spell_ability,
                            &RunParams::default(),
                            game,
                        ),
                    ),
                    entry,
                    optional: false,
                    decider: delayed.controller,
                    description: String::new(),
                };
                let ts = if delayed.mode == TriggerType::Phase {
                    0
                } else {
                    game.card(delayed.source_card).zone_timestamp
                };
                let trigger_bucket = if delayed.sort_after_active { 2 } else { 0 };
                entries.push((
                    pending,
                    delayed.controller,
                    ts,
                    trigger_bucket,
                    delayed.trigger_order.unwrap_or(0),
                ));
                fired_indices.push(idx);
            }
        }
        for idx in fired_indices.into_iter().rev() {
            self.delayed_triggers.remove(idx);
        }
        entries
    }

    /// Register a delayed trigger (one-shot, fires once then is removed).
    /// Mirrors Java's `TriggerHandler.registerDelayedTrigger()`.
    pub fn register_delayed_trigger(&mut self, mut delayed: DelayedTrigger) {
        self.assign_delayed_trigger_order(&mut delayed);
        self.delayed_triggers.push(delayed);
    }

    pub fn clear_delayed_trigger(&mut self) {
        self.delayed_triggers.clear();
        self.this_turn_delayed_triggers.clear();
    }

    pub fn register_this_turn_delayed_trigger(&mut self, mut delayed: DelayedTrigger) {
        self.assign_delayed_trigger_order(&mut delayed);
        self.this_turn_delayed_triggers.push(delayed.clone());
        self.delayed_triggers.push(delayed);
    }

    pub fn clear_this_turn_delayed_trigger(&mut self) {
        if self.this_turn_delayed_triggers.is_empty() {
            return;
        }
        self.delayed_triggers.retain(|d| {
            !self.this_turn_delayed_triggers.iter().any(|x| {
                x.source_card == d.source_card
                    && x.controller == d.controller
                    && x.mode == d.mode
                    && x.execute_svar == d.execute_svar
            })
        });
        self.this_turn_delayed_triggers.clear();
    }

    pub fn register_player_defined_delayed_trigger(
        &mut self,
        player: PlayerId,
        mut delayed: DelayedTrigger,
    ) {
        self.assign_delayed_trigger_order(&mut delayed);
        self.player_defined_delayed_triggers.push((player, delayed));
    }

    pub fn clear_player_defined_delayed_trigger(&mut self) {
        self.player_defined_delayed_triggers.clear();
    }

    pub fn handle_player_defined_del_triggers(&mut self, player: PlayerId) {
        let mut to_activate = Vec::new();
        self.player_defined_delayed_triggers.retain(|(p, delayed)| {
            if *p == player {
                to_activate.push(delayed.clone());
                false
            } else {
                true
            }
        });
        for delayed in to_activate {
            self.delayed_triggers.push(delayed);
        }
    }

    fn assign_delayed_trigger_order(&mut self, delayed: &mut DelayedTrigger) {
        if delayed.trigger_order.is_none() {
            delayed.trigger_order = Some(self.next_trigger_id);
            self.next_trigger_id += 1;
        }
    }

    /// Mirrors Java's resetActiveTriggers().
    /// Scans all cards in game, collects active triggers.
    pub fn reset_active_triggers(&mut self, game: &GameState) {
        self.active_triggers.clear();
        for (i, card) in game.cards.iter().enumerate() {
            let card_id = CardId(i as u32);
            for (trig_idx, _) in card.triggers.iter().enumerate() {
                self.register_one_trigger(game, card_id, trig_idx);
            }
        }
    }

    /// Mirrors Java's registerActiveTrigger(card).
    /// Registers a single card's triggers.
    pub fn register_active_trigger(&mut self, game: &GameState, card_id: CardId) {
        let card = game.card(card_id);
        for (trig_idx, _) in card.triggers.iter().enumerate() {
            self.register_one_trigger(game, card_id, trig_idx);
        }
    }

    /// Java parity wrapper for TriggerHandler.clearActiveTriggers().
    pub fn clear_active_triggers(&mut self) {
        self.active_triggers.clear();
    }

    /// Java parity wrapper for TriggerHandler.registerActiveLTBTrigger(card).
    /// Registers all of a card's triggers as active, using current trigger indices.
    pub fn register_active_ltb_trigger(&mut self, game: &GameState, card_id: CardId) {
        let card = game.card(card_id);
        for (trig_idx, trigger) in card.triggers.iter().enumerate() {
            if self.looks_back_in_time(trigger) {
                self.register_one_trigger(game, card_id, trig_idx);
            }
        }
    }

    /// Java parity wrapper for TriggerHandler.registerOneTrigger(...).
    pub fn register_one_trigger(
        &mut self,
        game: &GameState,
        card_id: CardId,
        trigger_index: usize,
    ) {
        let card = game.card(card_id);
        if trigger_index >= card.triggers.len() {
            return;
        }
        let trigger = &card.triggers[trigger_index];
        if !trigger.get_active_zone().contains(&card.zone) {
            return;
        }
        // NOTE: Do NOT call phases_check here.  Phase-gated triggers (e.g.
        // "At the beginning of your upkeep") must be registered as active
        // regardless of the current phase; the phase filter is evaluated at
        // match time inside can_run_trigger.
        if trigger.kind == TriggerType::Always && game.stack.has_state_trigger_id(trigger.id) {
            return;
        }
        let already_registered = self
            .active_triggers
            .iter()
            .any(|at| at.card_id == card_id && at.trigger_index == trigger_index);
        if !already_registered {
            if std::env::var("FORGE_TRIGGER_TRACE").is_ok() {
                if let Some(trigger) = game.card(card_id).triggers.get(trigger_index) {
                    if trigger.kind == TriggerType::BecomesTarget {
                        eprintln!(
                            "[trigger-trace] REGISTER active BecomesTarget trigger host={}#{:?} idx={} desc={} zones={:?}",
                            game.card(card_id).card_name,
                            card_id,
                            trigger_index,
                            trigger.description,
                            trigger.get_active_zone()
                        );
                    }
                }
            }
            self.active_triggers.push(ActiveTrigger {
                card_id,
                trigger_index,
            });
        }
    }

    /// Remove triggers for a card that left a trigger zone.
    pub fn unregister_active_triggers(&mut self, card_id: CardId) {
        self.active_triggers.retain(|at| at.card_id != card_id);
    }

    fn looks_back_in_time(&self, trigger: &Trigger) -> bool {
        if matches!(
            trigger.kind,
            TriggerType::Exploited
                | TriggerType::Destroyed
                | TriggerType::Sacrificed
                | TriggerType::SacrificedOnce
        ) {
            return true;
        }
        if matches!(
            trigger.kind,
            TriggerType::ChangesZone | TriggerType::ChangesZoneAll
        ) {
            return trigger
                .ir
                .origin_zones
                .contains(&forge_foundation::ZoneType::Battlefield)
                || trigger.ir.destination_zones.iter().any(|zone| {
                    matches!(
                        zone,
                        forge_foundation::ZoneType::Library | forge_foundation::ZoneType::Hand
                    )
                });
        }
        false
    }

    fn ltb_trigger_refs_for_event(
        &self,
        game: &GameState,
        event: &TriggerWaiting,
    ) -> Vec<(CardId, usize)> {
        let TriggerWaiting {
            params: event_payload,
            ..
        } = event;
        match event.mode {
            TriggerType::ChangesZone => {
                let destination = event_payload.destination;
                if event_payload.origin != Some(forge_foundation::ZoneType::Battlefield)
                    && !matches!(
                        destination,
                        Some(
                            forge_foundation::ZoneType::Library | forge_foundation::ZoneType::Hand
                        )
                    )
                {
                    return Vec::new();
                }
                let Some(card_id) = event_payload.card_lki.or(event_payload.card) else {
                    return Vec::new();
                };
                let mut refs: Vec<(CardId, usize)> = game
                    .card(card_id)
                    .triggers
                    .iter()
                    .enumerate()
                    .filter_map(|(trigger_index, trigger)| {
                        self.looks_back_in_time(trigger)
                            .then_some((card_id, trigger_index))
                    })
                    .collect();

                // Same-SBA-batch LTB lookback: cards that were on the battlefield
                // when this SBA batch started but are no longer there can still
                // observe deaths happening in the same batch (e.g. Blood Artist
                // seeing Savannah Lions die simultaneously). Mirrors Java's
                // triggerChangesZoneAll which re-registers LTB triggers from
                // lastStateBattlefield. Scoping via pre_sba_battlefield prevents
                // stale hosts from earlier batches firing for later deaths.
                if event_payload.origin == Some(forge_foundation::ZoneType::Battlefield) {
                    for &ltb_id in &game.pre_sba_battlefield {
                        if ltb_id == card_id {
                            continue;
                        }
                        let ltb_card = game.card(ltb_id);
                        if ltb_card.zone == forge_foundation::ZoneType::Battlefield {
                            // Still alive; active_triggers already covers it.
                            continue;
                        }
                        for (trigger_index, trigger) in ltb_card.triggers.iter().enumerate() {
                            if self.looks_back_in_time(trigger) {
                                refs.push((ltb_id, trigger_index));
                            }
                        }
                    }
                }

                refs
            }
            TriggerType::ChangesZoneAll => event
                .params
                .change_zone_table
                .as_ref()
                .map(|table| {
                    table
                        .last_state_battlefield()
                        .iter()
                        .flat_map(|&card_id| {
                            game.card(card_id).triggers.iter().enumerate().filter_map(
                                move |(trigger_index, trigger)| {
                                    self.looks_back_in_time(trigger)
                                        .then_some((card_id, trigger_index))
                                },
                            )
                        })
                        .collect()
                })
                .unwrap_or_default(),
            _ => Vec::new(),
        }
    }

    pub fn clear_waiting_triggers(&mut self) {
        self.waiting_triggers.clear();
        self.pre_matched_triggers.clear();
    }

    pub fn on_player_lost(&mut self, player: PlayerId) {
        self.delayed_triggers.retain(|d| d.controller != player);
        self.this_turn_delayed_triggers
            .retain(|d| d.controller != player);
        self.player_defined_delayed_triggers
            .retain(|(p, _)| *p != player);
    }

    /// Mirrors Java's StaticAbilityDisableTriggers.disabled().
    /// Checks if a ChangesZone trigger is suppressed by a DisableTriggers
    /// static ability (e.g. Hushbringer).
    fn is_trigger_disabled_by_static(
        game: &GameState,
        host_card: CardId,
        trigger_index: usize,
        params: &RunParams,
    ) -> bool {
        let trigger = &game.card(host_card).triggers[trigger_index];

        // Only applies to ChangesZone triggers
        if trigger.kind != TriggerType::ChangesZone {
            return false;
        }

        // The card changing zones (the "cause")
        let cause_card_id = match params.card {
            Some(cid) => cid,
            None => return false,
        };

        // Check cards for DisableTriggers static abilities.
        // For LTB triggers (Origin=Battlefield), also check cards that were on the
        // battlefield at the start of the current SBA check (pre_sba_battlefield).
        // This handles the case where a DisableTriggers source (e.g. Hushbringer)
        // dies in the same SBA batch as the trigger source — Hushbringer was on the
        // battlefield when the batch started, so its DisableTriggers still applies.
        // Mirrors Java's StaticAbilityDisableTriggers.disabled() which uses
        // lastStateBattlefield for LTB triggers (lines 20-27).
        let is_ltb = params.origin == Some(ZoneType::Battlefield);
        for card in game.cards.iter() {
            let on_battlefield = card.zone == ZoneType::Battlefield;
            let was_on_battlefield = is_ltb && game.pre_sba_battlefield.contains(&card.id);
            if !on_battlefield && !was_on_battlefield {
                continue;
            }
            for sa in &card.static_abilities {
                if !sa.check_mode(&crate::staticability::StaticMode::DisableTriggers) {
                    continue;
                }

                // ValidCause$ — must match the card changing zones
                if let Some(valid_cause) = sa.ir.valid_cause.as_ref() {
                    let context = valid_filter::MatchContext::from_source(card)
                        .with_game(game)
                        .with_triggering(cause_card_id.into(), params.player);
                    if !valid_filter::matches_valid_card_selector_with_context(
                        valid_cause,
                        game.card(cause_card_id),
                        context,
                    ) {
                        continue;
                    }
                }

                // ValidMode$ — must match the trigger's mode
                if let Some(valid_mode) = sa.ir.valid_mode.as_deref() {
                    let modes: Vec<&str> = valid_mode.split(',').collect();
                    if !modes.contains(&"ChangesZone") {
                        continue;
                    }
                }

                // Origin$ — the event's origin zone must match
                if !sa.ir.origin_zones.is_empty()
                    && !params
                        .origin
                        .is_some_and(|zone| sa.ir.origin_zones.contains(&zone))
                {
                    continue;
                }

                // Destination$ — the event's destination zone must match
                if !sa.ir.destination_zones.is_empty()
                    && !params
                        .destination
                        .is_some_and(|zone| sa.ir.destination_zones.contains(&zone))
                {
                    continue;
                }

                // All conditions matched — trigger is disabled.
                return true;
            }
        }
        false
    }

    /// Mirrors Java's canRunTrigger().
    /// Validation chain: mode → suppression → active zones → performTest.
    fn can_run_trigger(
        &self,
        game: &GameState,
        host_card: CardId,
        trigger_index: usize,
        host_controller: PlayerId,
        mode: &TriggerType,
        params: &RunParams,
    ) -> bool {
        let _perf_scope =
            crate::perf::ParamsLookupScopeGuard::enter(crate::perf::ParamsLookupScope::Trigger);
        let card = game.card(host_card);
        if trigger_index >= card.triggers.len() {
            return false;
        }
        let trigger = &card.triggers[trigger_index];

        // Check mode matches trigger type
        let trigger_type = trigger.mode.trigger_type();

        let normalize = |t: TriggerType| -> TriggerType {
            match t {
                TriggerType::DungeonCompleted => TriggerType::CompletedDungeon,
                TriggerType::RoomEntered => TriggerType::EnteredRoom,
                TriggerType::Airbend
                | TriggerType::Earthbend
                | TriggerType::Firebend
                | TriggerType::Waterbend
                | TriggerType::ElementalBend => TriggerType::Elementalbend,
                TriggerType::TakesInitiative => TriggerType::TakeInitiative,
                TriggerType::PhaseIn => TriggerType::PhasedIn,
                TriggerType::PhaseOut => TriggerType::PhasedOut,
                TriggerType::PlaneswalkedFrom | TriggerType::PlaneswalkedTo => {
                    TriggerType::Planeswalk
                }
                TriggerType::CrankContraption => TriggerType::CrankAdvanced,
                TriggerType::Explores => TriggerType::Explored,
                TriggerType::Unattach => TriggerType::Unattached,
                TriggerType::Saddled | TriggerType::Stationed => TriggerType::Crewed,
                other => other,
            }
        };
        let mode_matches = normalize(trigger_type) == normalize(*mode);
        if !mode_matches {
            return false;
        }

        // Check suppression
        if self.is_trigger_suppressed(*mode) {
            return false;
        }

        // Common trigger phase/requirement/limit checks (Java Trigger base behavior).
        if !trigger.phases_check(game, host_card, params.phase) {
            return false;
        }
        if !trigger.requirements_check(game, host_card) {
            return false;
        }
        if !trigger.check_activation_limit(game, host_card) {
            return false;
        }

        // DisableTriggers static ability check (e.g. Hushbringer).
        // Mirrors Java's StaticAbilityDisableTriggers.disabled().
        if matches!(
            *mode,
            TriggerType::ChangesZone | TriggerType::ChangesZoneAll
        ) && Self::is_trigger_disabled_by_static(game, host_card, trigger_index, params)
        {
            return false;
        }

        // Check active zones.
        // For self zone-change events, use origin as LKI zone so "dies" triggers
        // (active on Battlefield) still fire after the card has moved.
        let zone_for_active_check = if *mode == TriggerType::ChangesZone
            && params.card == Some(host_card)
            && params.origin == Some(ZoneType::Battlefield)
            && params.destination != Some(ZoneType::Battlefield)
        {
            // LKI active-zone check for "leaves battlefield" self triggers (e.g. dies).
            ZoneType::Battlefield
        } else if *mode == TriggerType::ChangesZone
            && params.card == Some(host_card)
            && params.destination == Some(ZoneType::Battlefield)
            && trigger.get_active_zone().contains(&ZoneType::Battlefield)
            && card.zone != ZoneType::Battlefield
        {
            // LKI active-zone check for ETB triggers whose host left before
            // waiting triggers were put on the stack.
            ZoneType::Battlefield
        } else if *mode == TriggerType::ChangesZone
            && params.origin == Some(ZoneType::Battlefield)
            && trigger.get_active_zone().contains(&ZoneType::Battlefield)
            && card.zone != ZoneType::Battlefield
            && self.looks_back_in_time(trigger)
            && game.pre_sba_battlefield.contains(&host_card)
        {
            // LKI active-zone check for LTB triggers seeing OTHER creatures die
            // in the same SBA batch (e.g. Blood Artist seeing Savannah Lions die).
            // Scoped via pre_sba_battlefield so that hosts that left earlier
            // batches do not fire for later deaths. Mirrors Java's
            // lastStateBattlefield boundary.
            ZoneType::Battlefield
        } else if (*mode == TriggerType::DamageDone || *mode == TriggerType::DamageDoneOnce)
            && params.damage_target_card == Some(host_card)
            && trigger.get_active_zone().contains(&ZoneType::Battlefield)
            && card.zone != ZoneType::Battlefield
        {
            // LKI for DamageDone/DamageDoneOnce triggers targeting self (e.g.
            // Raptor Hatchling enrage). When damage kills the creature, SBAs
            // move it to graveyard before triggers are processed. The trigger
            // was queued while the card was on the battlefield, so we use LKI.
            ZoneType::Battlefield
        } else if *mode == TriggerType::Exploited
            && params.card == Some(host_card)
            && trigger.get_active_zone().contains(&ZoneType::Battlefield)
            && card.zone != ZoneType::Battlefield
        {
            // LKI for Exploited triggers: the exploiting creature sacrificed
            // itself. It was on the battlefield when Exploit fired, so use LKI.
            ZoneType::Battlefield
        } else if *mode == TriggerType::Sacrificed
            && params.card == Some(host_card)
            && trigger.get_active_zone().contains(&ZoneType::Battlefield)
            && card.zone != ZoneType::Battlefield
        {
            // LKI for Sacrificed triggers: the creature was on the battlefield
            // when it was sacrificed, use LKI.
            ZoneType::Battlefield
        } else {
            card.zone
        };
        if !trigger.get_active_zone().contains(&zone_for_active_check) {
            return false;
        }

        // Phased-out hosts do not see events (CR 702.26.5). Mirrors Java
        // `TriggerReplacementBase.zonesCheck` which gates on `!isPhasedOut()`.
        if card.phased_out {
            return false;
        }

        // performTest
        if !trigger.mode.perform_test(trigger, params, game) {
            return false;
        }
        if !trigger.meets_requirements_on_triggered_objects(game, params, host_card) {
            return false;
        }

        // ── ActivatorThisTurnCast$ condition ──────────────────────────
        // Mirrors Java's TriggerSpellAbilityCast.checkActivatorThisTurnCast():
        // "EQ2" means the activating player must have cast exactly 2 spells
        // this turn (including the one triggering).
        if let Some(cond) = trigger.ir.activator_this_turn_cast.as_deref() {
            let caster = params.spell_controller.unwrap_or(host_controller);
            let count = game.player(caster).spells_cast_this_turn;
            if !compare_expr(count, cond.trim()) {
                return false;
            }
        }

        true
    }

    pub fn suppress_mode(&mut self, mode: TriggerType) {
        self.suppressed_modes.insert(mode);
    }

    pub fn set_suppress_all_triggers(&mut self, suppress: bool) {
        self.all_suppressed = suppress;
    }

    /// Mirrors Java's TriggerHandler.getActiveTrigger(TriggerType, Map<AbilityKey, Object>).
    /// Returns all active triggers that can run for the given mode and params.
    pub fn get_active_trigger(
        &self,
        game: &GameState,
        mode: TriggerType,
        params: &RunParams,
    ) -> Vec<Trigger> {
        let mut result = Vec::new();
        for at in &self.active_triggers {
            let card = game.card(at.card_id);
            if at.trigger_index >= card.triggers.len() {
                continue;
            }
            let host_controller = card.controller;
            if self.can_run_trigger(
                game,
                at.card_id,
                at.trigger_index,
                host_controller,
                &mode,
                params,
            ) {
                result.push(card.triggers[at.trigger_index].clone());
            }
        }
        result
    }

    pub fn is_trigger_suppressed(&self, mode: TriggerType) -> bool {
        self.all_suppressed || self.suppressed_modes.contains(&mode)
    }

    pub fn clear_suppression(&mut self, mode: TriggerType) {
        self.suppressed_modes.remove(&mode);
    }
}

impl Default for TriggerHandler {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::Card;
    use crate::event::RunParams;
    use crate::ids::PlayerId;
    use crate::trigger::TriggerType;
    use forge_carddb::parse_card_script;
    use forge_foundation::PhaseType;

    #[test]
    fn maralen_style_draw_phase_trigger_is_active() {
        let rules = parse_card_script(
            "Name:Maralen of the Mornsong\nManaCost:1 B B\nTypes:Legendary Creature Elf Wizard\nPT:2/3\nT:Mode$ Phase | Phase$ Draw | ValidPlayer$ Player | TriggerZones$ Battlefield | Execute$ TrigDrain | TriggerDescription$ At the beginning of each player's draw step, that player loses 3 life, searches their library for a card, puts it into their hand, then shuffles.\nSVar:TrigDrain:DB$ LoseLife | Defined$ TriggeredPlayer | LifeAmount$ 3",
        )
        .expect("card script should parse");

        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let mut maralen = Card::from_rules(&rules, PlayerId(0));
        maralen.id = crate::ids::CardId(0);
        maralen.zone = forge_foundation::ZoneType::Battlefield;
        game.cards.push(maralen);
        game.add_card_to_zone(
            forge_foundation::ZoneType::Battlefield,
            PlayerId(0),
            crate::ids::CardId(0),
        );

        let mut handler = TriggerHandler::new();
        handler.register_active_trigger(&game, crate::ids::CardId(0));

        let active = handler.get_active_trigger(
            &game,
            TriggerType::Phase,
            &RunParams {
                phase: Some(PhaseType::Draw),
                player: Some(PlayerId(0)),
                ..Default::default()
            },
        );

        assert_eq!(game.card(crate::ids::CardId(0)).triggers.len(), 1);
        assert_eq!(active.len(), 1);

        let pending = handler.run_trigger_with_game(
            &game,
            TriggerType::Phase,
            RunParams {
                phase: Some(PhaseType::Draw),
                player: Some(PlayerId(0)),
                ..Default::default()
            },
            false,
        );
        assert_eq!(pending.len(), 1);
        assert_eq!(
            pending[0]
                .entry
                .spell_ability
                .get_triggering_player(crate::ability::AbilityKey::TriggeredPlayer),
            Some(PlayerId(0))
        );
    }
}
