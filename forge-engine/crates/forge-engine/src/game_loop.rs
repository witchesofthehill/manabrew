use std::collections::{HashMap, VecDeque};
use std::hash::{DefaultHasher, Hasher};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[path = "game_loop/mana_action_undo.rs"]
mod mana_action_undo;
#[path = "game_loop/trigger_replacement_base.rs"]
pub mod trigger_replacement_base;

use forge_foundation::{PhaseType, ZoneType};

// Comment test 2
use crate::ability::effects::{self, EffectContext};
use crate::agent::{CombatCostAction, MainPhaseAction, ManaCostAction, PlayerAgent};
use crate::card::Card;
use crate::combat::{self, CombatState};
use crate::cost::{self, parse_cost, CostPart};
use crate::event::RunParams;
use crate::game::GameState;
use crate::game_log::GameLog;
use crate::game_log_entry_type::GameLogEntryType;
use crate::game_rng::{GameRng, ThreadRngAdapter};
use crate::game_snapshot::GameSnapshot;
use crate::ids::{CardId, PlayerId};
use crate::mana::{self, basic_land_mana_atom, ManaPool};
use crate::parsing::{keys, Params};
use crate::spellability::target_restrictions;
use crate::spellability::{SpellAbility, StackEntry};
use crate::staticability::layer::apply_continuous_effects;
use crate::trigger::handler::TriggerHandler;
use crate::trigger::TriggerType;
use mana_action_undo::ManaUndoRecord;

// ── GameLoop ────────────────────────────────────────────────────────

/// Drives a complete game from setup through game over.
pub struct GameLoop {
    pub mana_pools: Vec<ManaPool>,
    pub combat: CombatState,
    pub trigger_handler: TriggerHandler,
    pub game_log: GameLog,
    /// Token templates keyed by their script filename stem (e.g. "r_1_1_goblin").
    /// Populated at game start by the Tauri layer; used by the Token effect handler.
    pub token_templates: HashMap<String, Card>,
    /// Token art variant counts: (token_script, edition_code) → count.
    /// Used for game-RNG parity with Java. When Java creates a token, it calls
    /// `Aggregates.random(collection)` on a Set of art variants, which consumes
    /// `nextInt()` once per element. Rust needs to consume the same number of
    /// RNG calls to keep the game RNG in sync.
    pub token_art_variants: HashMap<(String, String), usize>,
    /// Token fallback codes: edition_code → fallback_edition_code.
    pub token_fallback: HashMap<String, String>,
    /// Edition release dates: edition_code → "YYYY-MM-DD".
    pub edition_dates: HashMap<String, String>,
    /// Pluggable RNG for game effects (shuffles, coin flips, dice rolls).
    /// Default: ThreadRngAdapter (non-deterministic). For parity testing,
    /// replace with a JavaRandom-backed implementation.
    pub game_rng: Box<dyn GameRng>,
    /// Enables Java-parity snapshot rollback support (`stash_game_state` / `restore_game_state`).
    pub experimental_restore_snapshot: bool,
    /// Last stashed snapshot used by rollback flows.
    previous_game_state: Option<GameSnapshot>,
    /// Rolling checkpoint history for UI rewind/debug.
    checkpoints: VecDeque<(u64, String, GameSnapshot)>,
    next_checkpoint_id: u64,
    reserved_sacrifice_stack: Vec<Vec<CardId>>,
    reserved_source_reuse_stack: Vec<bool>,
    /// Per-player stack of reversible mana actions. The UI consumes this
    /// through `untappableLandIds`; legality is owned by the engine.
    mana_undo_stacks: Vec<Vec<ManaUndoRecord>>,
    mana_undo_disqualified: bool,
    /// Cooperative shutdown signal. When the host (e.g. Tauri's
    /// `GameManager::end_game`) flips this flag we short-circuit the
    /// outer `run()` loop and bail out. Prevents the engine from
    /// continuing to tick after the user has conceded or returned to
    /// the main menu — the previous behavior kept the game running
    /// silently and drove a visible log/prompt loop on the frontend.
    pub abort_signal: Option<Arc<AtomicBool>>,
    /// Whether the engine precomputes priority action space before calling
    /// `PlayerAgent::choose_action`. UI agents use the default `true`; parity
    /// disables it and requests action space explicitly only when needed.
    pub provide_priority_action_space: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct PreparedSpellAbility {
    pub spell_ability: SpellAbility,
    pub activated_ability_index: Option<usize>,
    pub static_alternative_cost_prepared: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SpellAbilityLogEventKind {
    Stack,
    Action,
}

#[derive(Debug, Clone)]
pub(crate) struct StackPushContext {
    pub source_card: CardId,
    pub entry: StackEntry,
    pub pending_stack_id: Option<u32>,
    pub stack_log_name: String,
    pub stack_message: String,
    pub target_card: Option<CardId>,
    pub event_kind: SpellAbilityLogEventKind,
    pub move_source_to_stack: bool,
    pub register_source_trigger: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct PostStackTriggerContext {
    pub source_card: CardId,
    pub cast_trigger: TriggerType,
    pub emit_ability_activated: bool,
    pub emit_waterbend: bool,
    pub waterbend_cards: Vec<CardId>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PlaySpellAbilityResult {
    CardPlayed { card_id: CardId, card_name: String },
    AbilityActivated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TurnMachineState {
    Untap,
    Upkeep,
    Draw,
    Main1,
    Combat,
    Main2,
    EndOfTurn,
    Cleanup,
    Done,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TurnEvent {
    EnterPhase {
        phase: PhaseType,
        emit_phase_trigger: bool,
    },
    PriorityWindow {
        is_main_phase: bool,
    },
    UntapStep,
    DrawStep,
    CombatStep,
    CleanupStep,
    AdvanceTurn,
}

impl GameLoop {
    pub fn new(num_players: usize) -> Self {
        GameLoop {
            mana_pools: (0..num_players).map(|_| ManaPool::new()).collect(),
            combat: CombatState::new(),
            trigger_handler: TriggerHandler::new(),
            game_log: GameLog::new(),
            token_templates: HashMap::new(),
            token_art_variants: HashMap::new(),
            token_fallback: HashMap::new(),
            edition_dates: HashMap::new(),
            game_rng: Box::new(ThreadRngAdapter),
            experimental_restore_snapshot: false,
            previous_game_state: None,
            checkpoints: VecDeque::new(),
            next_checkpoint_id: 1,
            reserved_sacrifice_stack: Vec::new(),
            reserved_source_reuse_stack: Vec::new(),
            mana_undo_stacks: (0..num_players).map(|_| Vec::new()).collect(),
            mana_undo_disqualified: false,
            abort_signal: None,
            provide_priority_action_space: true,
        }
    }

    pub fn set_provide_priority_action_space(&mut self, provide: bool) {
        self.provide_priority_action_space = provide;
    }

    /// Install a cooperative abort signal. When the host flips the flag
    /// the outer `run()` loop exits before the next turn so the game
    /// thread can wind down cleanly instead of continuing to drive
    /// prompts at a frontend that has already unmounted.
    pub fn set_abort_signal(&mut self, signal: Arc<AtomicBool>) {
        self.abort_signal = Some(signal);
    }

    fn is_aborted(&self) -> bool {
        self.abort_signal
            .as_ref()
            .map(|s| s.load(Ordering::Relaxed))
            .unwrap_or(false)
    }

    /// Register a token template by its script filename stem (e.g. "r_1_1_goblin").
    /// Called at game start by the Tauri layer for every token script in the token DB.
    pub fn register_token(&mut self, script_name: impl Into<String>, template: Card) {
        self.token_templates.insert(script_name.into(), template);
    }

    /// Get the number of art variants for a token in a given edition.
    /// Follows TokenFallbackCode chains. Returns 1 if not found.
    pub fn token_art_variant_count(&self, token_script: &str, edition_code: &str) -> usize {
        let key = (token_script.to_lowercase(), edition_code.to_uppercase());
        if let Some(&count) = self.token_art_variants.get(&key) {
            return count;
        }
        if let Some(fallback) = self.token_fallback.get(&edition_code.to_uppercase()) {
            return self.token_art_variant_count(token_script, fallback);
        }
        1
    }

    pub fn pool(&self, pid: PlayerId) -> &ManaPool {
        &self.mana_pools[pid.index()]
    }

    pub fn pool_mut(&mut self, pid: PlayerId) -> &mut ManaPool {
        &mut self.mana_pools[pid.index()]
    }

    pub(crate) fn move_card_with_runtime(
        &mut self,
        game: &mut GameState,
        card_id: CardId,
        dest_zone: ZoneType,
        dest_owner: PlayerId,
        agents: &mut [Box<dyn PlayerAgent>],
    ) {
        let mut runtime = crate::replacement::replacement_handler::ReplacementRuntime {
            trigger_handler: &mut self.trigger_handler,
            token_templates: &self.token_templates,
            token_art_variants: &self.token_art_variants,
            token_fallback: &self.token_fallback,
            edition_dates: &self.edition_dates,
            mana_pools: &mut self.mana_pools,
            rng: &mut *self.game_rng,
        };
        game.move_card_with_agents_and_replacement_runtime(
            card_id,
            dest_zone,
            dest_owner,
            agents,
            &mut runtime,
        );
    }

    /// Create a game snapshot. Set `include_stack` false for copy-without-stack flows.
    pub fn make_snapshot(&self, game: &GameState, include_stack: bool) -> GameSnapshot {
        GameSnapshot::capture(
            game,
            &self.mana_pools,
            &self.combat,
            &self.trigger_handler,
            include_stack,
        )
    }

    /// Restore a previously captured snapshot.
    pub fn restore_snapshot(&mut self, game: &mut GameState, snapshot: &GameSnapshot) {
        snapshot.restore_game_state(
            game,
            &mut self.mana_pools,
            &mut self.combat,
            &mut self.trigger_handler,
        );
    }

    /// Stash the current state if snapshot rollback is enabled.
    pub fn stash_game_state(&mut self, game: &GameState) {
        if self.experimental_restore_snapshot {
            self.previous_game_state = Some(self.make_snapshot(game, true));
        }
    }

    /// Restore from the previously stashed state if available and enabled.
    pub fn restore_game_state(&mut self, game: &mut GameState) -> bool {
        if !self.experimental_restore_snapshot {
            return false;
        }
        let Some(snapshot) = self.previous_game_state.as_ref() else {
            return false;
        };
        crate::perf::increment(crate::perf::Metric::SnapshotClones, 1);
        let snapshot = snapshot.clone();
        self.restore_snapshot(game, &snapshot);
        true
    }

    pub fn restore_checkpoint(&mut self, game: &mut GameState, checkpoint_id: u64) -> bool {
        let Some((_, _, snapshot)) = self
            .checkpoints
            .iter()
            .find(|(id, _, _)| *id == checkpoint_id)
        else {
            return false;
        };
        crate::perf::increment(crate::perf::Metric::SnapshotClones, 1);
        let snapshot = snapshot.clone();
        self.restore_snapshot(game, &snapshot);
        true
    }

    fn record_checkpoint(&mut self, game: &GameState, include_stack: bool) -> (u64, String) {
        let checkpoint_id = self.next_checkpoint_id;
        self.next_checkpoint_id += 1;
        let label = format!(
            "Turn {} {}",
            game.turn.turn_number,
            game.turn.phase.script_name()
        );
        let snap = self.make_snapshot(game, include_stack);
        self.checkpoints
            .push_back((checkpoint_id, label.clone(), snap));
        while self.checkpoints.len() > 256 {
            self.checkpoints.pop_front();
        }
        (checkpoint_id, label)
    }

    pub(crate) fn apply_pending_snapshot_restore(
        &mut self,
        game: &mut GameState,
        agents: &mut [Box<dyn PlayerAgent>],
    ) -> bool {
        let mut requested = None;
        for agent in agents.iter_mut() {
            if let Some(id) = agent.take_restore_request() {
                requested = Some(id);
            }
        }
        let Some(checkpoint_id) = requested else {
            return false;
        };
        let restored = self.restore_checkpoint(game, checkpoint_id);
        if restored {
            for agent in agents.iter_mut() {
                agent.snapshot_state(game, &self.mana_pools);
                agent.notify(crate::agent::notification::GameNotification::StateChanged);
            }
        }
        restored
    }

    /// Get untapped lands on the battlefield for a player.
    pub fn get_tappable_lands(&self, game: &GameState, player: PlayerId) -> Vec<CardId> {
        game.cards_in_zone(ZoneType::Battlefield, player)
            .to_vec()
            .into_iter()
            .filter(|&cid| {
                let c = game.card(cid);
                c.is_land() && !c.tapped
            })
            .collect()
    }

    /// Get the top reversible mana source for a player, if any.
    pub fn get_untappable_lands(
        &self,
        _game: &GameState,
        player: PlayerId,
        _pool_snapshot: &ManaPool,
    ) -> Vec<CardId> {
        self.undoable_mana_sources(player)
    }

    /// Set up the game: roll for first player, shuffle libraries, draw
    /// opening hands, run mulligans.
    pub fn setup(
        &mut self,
        game: &mut GameState,
        agents: &mut [Box<dyn PlayerAgent>],
        rng: &mut impl rand::Rng,
    ) {
        self.roll_for_first_player(game, agents, rng);

        for &pid in &game.player_order.clone() {
            game.shuffle_library(pid, rng);
            game.draw_cards(pid, 7);
        }

        let first_player = game.active_player();
        crate::mulligan::run_london_mulligans(
            game,
            agents,
            rng,
            first_player,
            &self.mana_pools,
            &self.game_log,
        );
    }

    /// Each player rolls a d20; the highest roller goes first. Ties are
    /// broken by rerolling among the tied players (resolved internally —
    /// only the final round is surfaced to the UI).
    ///
    /// Emits a single `FirstPlayerRoll` notification so the frontend can
    /// animate every player's die side-by-side. Mutates
    /// `game.turn.active_player` and `priority_player` to the winner.
    pub fn roll_for_first_player(
        &mut self,
        game: &mut GameState,
        agents: &mut [Box<dyn PlayerAgent>],
        rng: &mut impl rand::Rng,
    ) {
        const SIDES: i32 = 20;
        let players: Vec<PlayerId> = game.player_order.clone();
        if players.len() < 2 {
            return;
        }

        // Run the tiebreak loop silently; only the final, decisive round
        // is broadcast to the UI.
        let mut contenders: Vec<PlayerId> = players.clone();
        let (final_rolls, winner) = loop {
            let rolls: Vec<(PlayerId, i32)> = contenders
                .iter()
                .map(|&pid| (pid, rng.gen_range(1..=SIDES)))
                .collect();

            for (pid, value) in &rolls {
                let player_name = game.player(*pid).name.clone();
                self.game_log.log(
                    GameLogEntryType::Info,
                    0,
                    format!("{player_name} rolls a {value} (d{SIDES})"),
                );
            }

            let highest = rolls.iter().map(|(_, v)| *v).max().unwrap_or(0);
            let top: Vec<PlayerId> = rolls
                .iter()
                .filter(|(_, v)| *v == highest)
                .map(|(p, _)| *p)
                .collect();
            if top.len() == 1 {
                break (rolls, top[0]);
            }
            self.game_log.log(
                GameLogEntryType::Info,
                0,
                "Tie — rerolling among tied players".to_string(),
            );
            contenders = top;
        };

        let winner_name = game.player(winner).name.clone();
        self.game_log.log(
            GameLogEntryType::Info,
            0,
            format!("{winner_name} goes first"),
        );

        for agent in agents.iter_mut() {
            agent.snapshot_state(game, &self.mana_pools);
        }
        crate::agent::game_log::broadcast_notification(
            agents,
            crate::agent::notification::GameNotification::FirstPlayerRoll {
                sides: SIDES,
                rolls: final_rolls,
                winner,
            },
        );
        // Wait for every human-driven transport to finish its animation
        // (in parallel — the prompt was already dispatched to all of
        // them). AI transports skip this no-op.
        for agent in agents.iter_mut() {
            agent.await_display_ack();
        }

        game.turn.active_player = winner;
        game.turn.priority_player = winner;
    }

    /// Run generic "opening hand" actions before the game begins.
    ///
    /// Mirrors Java's `GameAction.runOpeningHandActions()`: gather every
    /// `MayEffectFromOpeningHand` keyword in hand, ask the controller whether
    /// to use it, and resolve the referenced SVar immediately.
    pub fn run_opening_hand_actions(
        &mut self,
        game: &mut GameState,
        agents: &mut [Box<dyn PlayerAgent>],
    ) {
        let first_player = game.active_player();
        let mut takes_action = first_player;
        let mut new_first = first_player;

        loop {
            let usable = self.collect_opening_hand_actions(game, takes_action, first_player);
            for mut sa in usable {
                let Some(source_id) = sa.source else {
                    continue;
                };
                if game.card(source_id).zone != ZoneType::Hand {
                    continue;
                }

                agents[takes_action.index()].snapshot_state(game, &self.mana_pools);
                let card_name = game.card(source_id).card_name.clone();
                let prompt = sa
                    .ir
                    .spell_description_text
                    .as_deref()
                    .unwrap_or("Use opening hand effect?");
                let accepted = agents[takes_action.index()].confirm_action(
                    takes_action,
                    Some("FromOpeningHand"),
                    prompt,
                    &[],
                    Some(source_id),
                    sa.api,
                );
                if !accepted {
                    continue;
                }

                if sa.uses_targeting() && !sa.setup_targets(game, agents, &self.mana_pools) {
                    continue;
                }

                let becomes_starting_player = sa.ir.become_starting_player;
                let entry = StackEntry {
                    id: 0,
                    spell_ability: sa,
                    is_pending_cast: false,
                    is_creature_spell: false,
                    is_permanent_spell: false,
                    cast_from_zone: Some(ZoneType::Hand),
                    optional_trigger_decider: None,
                    optional_trigger_description: None,
                    optional_trigger_source_name: None,
                };
                self.resolve_spell_effect(game, agents, &entry);
                apply_continuous_effects(game);

                if becomes_starting_player {
                    new_first = takes_action;
                }
            }

            takes_action = game.next_player(takes_action);
            if takes_action == first_player {
                break;
            }
        }

        if new_first != first_player {
            game.turn.active_player = new_first;
            game.turn.priority_player = new_first;
        }
    }

    fn collect_opening_hand_actions(
        &self,
        game: &GameState,
        player: PlayerId,
        first_player: PlayerId,
    ) -> Vec<SpellAbility> {
        let mut usable = Vec::new();

        for &card_id in game.cards_in_zone(ZoneType::Hand, player) {
            let card = game.card(card_id);
            for kw in card.keywords.as_string_list() {
                if !kw.starts_with("MayEffectFromOpeningHand") {
                    continue;
                }
                let split: Vec<&str> = kw.split(':').collect();
                let Some(effect_name) = split.get(1).copied() else {
                    continue;
                };
                if split.get(2).copied() == Some("!PlayFirst") && first_player == player {
                    continue;
                }
                let Some(raw) = card.svars.get(effect_name) else {
                    continue;
                };
                usable.push(crate::spellability::build_spell_ability(
                    game, card_id, raw, player,
                ));
            }
        }

        usable
    }

    /// Run the full game until someone wins or loses.
    /// Returns the winner's PlayerId.
    pub fn run(
        &mut self,
        game: &mut GameState,
        agents: &mut [Box<dyn PlayerAgent>],
        rng: &mut impl rand::Rng,
        max_turns: u32,
    ) -> Option<PlayerId> {
        self.setup(game, agents, rng);
        self.run_opening_hand_actions(game, agents);

        self.trigger_handler.reset_active_triggers(game);
        self.trigger_handler
            .run_trigger(TriggerType::NewGame, RunParams::default(), true);

        while !game.game_over && game.turn.turn_number <= max_turns {
            if self.is_aborted() {
                // Host requested a shutdown (user conceded / returned to
                // menu). Mark the game as over without picking a winner
                // so the agent thread can fall through and drop.
                game.game_over = true;
                break;
            }
            self.run_turn(game, agents, rng);
        }

        game.winner
    }

    /// Run a single turn.
    pub fn run_turn(
        &mut self,
        game: &mut GameState,
        agents: &mut [Box<dyn PlayerAgent>],
        _rng: &mut impl rand::Rng,
    ) {
        let _perf_scope =
            crate::perf::ParamsLookupScopeGuard::enter(crate::perf::ParamsLookupScope::GameLoop);
        let active = game.active_player();
        let active_name = game.player(active).name.clone();

        // SkipTurn (issue #22): if the active player has skip_turns > 0, skip entirely.
        if game.player(active).skip_turns > 0 {
            game.player_decrement_skip_turns(active);
            self.log_turn_skipped(game, active, game.player(active).skip_turns);
            // Still advance turn state so the next player gets their turn
            game.turn.next_player_turn(&game.player_order.clone());
            return;
        }

        game.new_turn_for_player(active);
        self.log_turn_begin(&active_name, game.turn.turn_number);

        // Snapshot + notify all agents of the turn change (display-only, before any actions)
        let turn_number = game.turn.turn_number;
        for agent in agents.iter_mut() {
            agent.snapshot_state(game, &self.mana_pools);
        }
        let (checkpoint_id, label) = self.record_checkpoint(game, true);
        for agent in agents.iter_mut() {
            agent.notify(
                crate::agent::notification::GameNotification::SnapshotCreated {
                    checkpoint_id,
                    label: label.clone(),
                },
            );
        }
        for agent in agents.iter_mut() {
            agent.notify(crate::agent::notification::GameNotification::TurnChanged {
                active_player: active,
                turn_number,
            });
        }

        // Recompute continuous static effects for the new turn.
        apply_continuous_effects(game);
        // Rebuild active triggers after statics so granted triggers are included.
        self.trigger_handler.reset_active_triggers(game);

        self.run_turn_state_machine(game, agents);
    }

    pub(crate) fn log_turn_begin(&self, player_name: &str, turn_number: u32) {
        self.game_log.log(
            GameLogEntryType::TurnBegin,
            0,
            format!("{player_name} turn begins (turn {turn_number})"),
        );
    }

    pub(crate) fn log_turn_skipped(
        &self,
        game: &GameState,
        player: PlayerId,
        remaining_skip_turns: i32,
    ) {
        self.game_log.log(
            GameLogEntryType::TurnSkip,
            0,
            format!(
                "{} turn skipped (remaining skip-turn effects: {})",
                game.player(player).name,
                remaining_skip_turns
            ),
        );
    }

    pub(crate) fn log_phase_begin(&self, phase: PhaseType) {
        self.game_log.log(
            GameLogEntryType::PhaseBegin,
            1,
            format!("Phase {}", phase.script_name()),
        );
    }

    pub(crate) fn log_waiting_for_priority(&self, game: &GameState, player: PlayerId) {
        self.game_log.log(
            GameLogEntryType::PriorityWaiting,
            2,
            format!("Waiting for {} priority response", game.player(player).name),
        );
    }

    pub(crate) fn log_priority_response(&self, game: &GameState, player: PlayerId, action: &str) {
        self.game_log.log(
            GameLogEntryType::PriorityResponse,
            2,
            format!("{} responded with {}", game.player(player).name, action),
        );
    }

    pub(crate) fn log_priority_pass(&self, game: &GameState, player: PlayerId) {
        self.game_log.log(
            GameLogEntryType::PriorityPass,
            2,
            format!("{} passed priority", game.player(player).name),
        );
    }

    pub(crate) fn log_stack_push(&self, item_name: &str, player_name: &str) {
        self.game_log.log(
            GameLogEntryType::StackPush,
            2,
            format!("{item_name} pushed to stack ({player_name})"),
        );
    }

    pub(crate) fn log_stack_resolved_item(&self, item_name: &str) {
        self.game_log.log(
            GameLogEntryType::StackResolve,
            2,
            format!("{item_name} resolved"),
        );
    }
}

/// Helper: run SBA with trigger handler and legend-rule agent callback.
/// Mirrors Java's GameAction.checkStateEffects() + handleLegendRule() which
/// delegates the "keep which legendary?" choice to the player controller.
fn check_sba(
    game: &mut GameState,
    trigger_handler: &mut TriggerHandler,
    agents: &mut [Box<dyn PlayerAgent>],
) -> bool {
    let _perf_scope =
        crate::perf::ParamsLookupScopeGuard::enter(crate::perf::ParamsLookupScope::PrioritySba);
    let result = game.check_state_based_actions_with_trigger_agents(Some(trigger_handler), agents);
    if result {
        // Flush triggers fired during SBA before re-registering. This preserves
        // triggers from Animate effects (pump_trigger_count) that were active
        // when creatures died.
        trigger_handler.flush_waiting_triggers(game);
        // Re-register triggers after SBA may have moved cards between zones.
        // This ensures triggers with non-Battlefield active zones (e.g.
        // TriggerZones$ Graveyard) are registered when cards die.
        trigger_handler.reset_active_triggers(game);
    }
    result
}

mod action_space;
mod cast_spell;
mod combat_phase;
mod cost_payment;
mod game_action;
pub(crate) use game_action::{fire_sacrificed_once_for_batch, perform_sacrifice};
pub(crate) mod mana_payment;
mod phase_handler;
mod playability;
mod priority;
mod stack_resolution;
mod state_observer;
mod trigger_handler;

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    use forge_foundation::{CardTypeLine, ColorSet, ManaCost};
    use rand::SeedableRng;

    use crate::agent::{PlayCardMode, PlayerAgent, TargetChoice};
    use crate::card::Card;
    use crate::player::actions::PlayerAction;

    use super::*;

    struct RecordingPassAgent {
        phases_seen: Arc<Mutex<Vec<PhaseType>>>,
        bad_priority_seen: Arc<AtomicBool>,
        last_phase: Option<PhaseType>,
        last_priority: Option<PlayerId>,
    }

    struct InvalidPlayAgent;
    struct OpeningHandAgent {
        accept: bool,
    }

    impl PlayerAgent for InvalidPlayAgent {
        fn mulligan_decision(
            &mut self,
            _player: PlayerId,
            _hand: &[CardId],
            _mulligan_count: u32,
        ) -> bool {
            true
        }

        fn choose_action(
            &mut self,
            player: PlayerId,
            action_space: Option<&crate::agent::PriorityActionSpace>,
            request_action_space: &mut dyn FnMut() -> crate::agent::PriorityActionSpace,
        ) -> PlayerAction {
            PlayerAction::CastSpell(crate::agent::PlayOption {
                card_id: CardId(u32::MAX),
                mode: PlayCardMode::Normal,
                alt_cost_index: 0,
            })
        }

        fn choose_attackers(
            &mut self,
            _player: PlayerId,
            _available: &[CardId],
            _possible_defenders: &[crate::combat::DefenderId],
        ) -> Vec<(CardId, crate::combat::DefenderId)> {
            Vec::new()
        }

        fn choose_blockers(
            &mut self,
            _player: PlayerId,
            _attackers: &[CardId],
            _available_blockers: &[CardId],
            _max_blockers: Option<usize>,
        ) -> Vec<(CardId, CardId)> {
            Vec::new()
        }

        fn choose_target_player(
            &mut self,
            _player: PlayerId,
            valid: &[PlayerId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> Option<PlayerId> {
            valid.first().copied()
        }

        fn choose_target_card(
            &mut self,
            _player: PlayerId,
            valid: &[CardId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> Option<CardId> {
            valid.first().copied()
        }

        fn choose_target_any(
            &mut self,
            _player: PlayerId,
            valid_players: &[PlayerId],
            valid_cards: &[CardId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> TargetChoice {
            if let Some(&pid) = valid_players.first() {
                TargetChoice::Player(pid)
            } else if let Some(&cid) = valid_cards.first() {
                TargetChoice::Card(cid)
            } else {
                TargetChoice::None
            }
        }

        fn choose_land_or_spell(&mut self, _player: PlayerId) -> Option<bool> {
            None
        }

        fn choose_targets_for(
            &mut self,
            _sa: &mut crate::spellability::SpellAbility,
            _game: &GameState,
            _mana_pools: &[ManaPool],
        ) -> bool {
            false
        }

        fn notify(&mut self, _message: crate::agent::notification::GameNotification) {}
    }

    impl RecordingPassAgent {
        fn new(
            phases_seen: Arc<Mutex<Vec<PhaseType>>>,
            bad_priority_seen: Arc<AtomicBool>,
        ) -> Self {
            Self {
                phases_seen,
                bad_priority_seen,
                last_phase: None,
                last_priority: None,
            }
        }
    }

    impl PlayerAgent for RecordingPassAgent {
        fn snapshot_state(&mut self, game: &GameState, _mana_pools: &[ManaPool]) {
            self.last_phase = Some(game.turn.phase);
            self.last_priority = Some(game.turn.priority_player);
        }

        fn mulligan_decision(
            &mut self,
            _player: PlayerId,
            _hand: &[CardId],
            _mulligan_count: u32,
        ) -> bool {
            true
        }

        fn choose_action(
            &mut self,
            player: PlayerId,
            action_space: Option<&crate::agent::PriorityActionSpace>,
            request_action_space: &mut dyn FnMut() -> crate::agent::PriorityActionSpace,
        ) -> PlayerAction {
            if self.last_priority != Some(player) {
                self.bad_priority_seen.store(true, Ordering::SeqCst);
            }
            if let Some(phase) = self.last_phase {
                self.phases_seen.lock().unwrap().push(phase);
            }
            PlayerAction::PassPriority
        }

        fn choose_attackers(
            &mut self,
            _player: PlayerId,
            _available: &[CardId],
            _possible_defenders: &[crate::combat::DefenderId],
        ) -> Vec<(CardId, crate::combat::DefenderId)> {
            Vec::new()
        }

        fn choose_blockers(
            &mut self,
            _player: PlayerId,
            _attackers: &[CardId],
            _available_blockers: &[CardId],
            _max_blockers: Option<usize>,
        ) -> Vec<(CardId, CardId)> {
            Vec::new()
        }

        fn choose_target_player(
            &mut self,
            _player: PlayerId,
            valid: &[PlayerId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> Option<PlayerId> {
            valid.first().copied()
        }

        fn choose_target_card(
            &mut self,
            _player: PlayerId,
            valid: &[CardId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> Option<CardId> {
            valid.first().copied()
        }

        fn choose_target_any(
            &mut self,
            _player: PlayerId,
            valid_players: &[PlayerId],
            valid_cards: &[CardId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> TargetChoice {
            if let Some(&pid) = valid_players.first() {
                TargetChoice::Player(pid)
            } else if let Some(&cid) = valid_cards.first() {
                TargetChoice::Card(cid)
            } else {
                TargetChoice::None
            }
        }

        fn choose_land_or_spell(&mut self, _player: PlayerId) -> Option<bool> {
            None
        }

        fn choose_targets_for(
            &mut self,
            _sa: &mut crate::spellability::SpellAbility,
            _game: &GameState,
            _mana_pools: &[ManaPool],
        ) -> bool {
            false
        }

        fn notify(&mut self, _message: crate::agent::notification::GameNotification) {}
    }

    impl PlayerAgent for OpeningHandAgent {
        fn mulligan_decision(
            &mut self,
            _player: PlayerId,
            _hand: &[CardId],
            _mulligan_count: u32,
        ) -> bool {
            true
        }

        fn choose_action(
            &mut self,
            player: PlayerId,
            action_space: Option<&crate::agent::PriorityActionSpace>,
            request_action_space: &mut dyn FnMut() -> crate::agent::PriorityActionSpace,
        ) -> PlayerAction {
            PlayerAction::PassPriority
        }

        fn choose_attackers(
            &mut self,
            _player: PlayerId,
            _available: &[CardId],
            _possible_defenders: &[crate::combat::DefenderId],
        ) -> Vec<(CardId, crate::combat::DefenderId)> {
            Vec::new()
        }

        fn choose_blockers(
            &mut self,
            _player: PlayerId,
            _attackers: &[CardId],
            _available_blockers: &[CardId],
            _max_blockers: Option<usize>,
        ) -> Vec<(CardId, CardId)> {
            Vec::new()
        }

        fn choose_target_player(
            &mut self,
            _player: PlayerId,
            valid: &[PlayerId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> Option<PlayerId> {
            valid.first().copied()
        }

        fn choose_target_card(
            &mut self,
            _player: PlayerId,
            valid: &[CardId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> Option<CardId> {
            valid.first().copied()
        }

        fn choose_target_any(
            &mut self,
            _player: PlayerId,
            valid_players: &[PlayerId],
            valid_cards: &[CardId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> TargetChoice {
            if let Some(&pid) = valid_players.first() {
                TargetChoice::Player(pid)
            } else if let Some(&cid) = valid_cards.first() {
                TargetChoice::Card(cid)
            } else {
                TargetChoice::None
            }
        }

        fn choose_land_or_spell(&mut self, _player: PlayerId) -> Option<bool> {
            None
        }

        fn confirm_action(
            &mut self,
            _player: PlayerId,
            _mode: Option<&str>,
            _message: &str,
            _options: &[String],
            _source: Option<crate::ids::CardId>,
            _api: Option<crate::ability::api_type::ApiType>,
        ) -> bool {
            self.accept
        }

        fn choose_targets_for(
            &mut self,
            _sa: &mut crate::spellability::SpellAbility,
            _game: &GameState,
            _mana_pools: &[ManaPool],
        ) -> bool {
            false
        }

        fn notify(&mut self, _message: crate::agent::notification::GameNotification) {}
    }

    fn zero_cost_instant(owner: PlayerId) -> Card {
        Card::new(
            CardId(0),
            "Test Instant".to_string(),
            owner,
            CardTypeLine::parse("Instant"),
            ManaCost::no_cost(),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec![],
        )
    }

    fn mana_land(owner: PlayerId, name: &str, produced: &str) -> Card {
        Card::new(
            CardId(0),
            name.to_string(),
            owner,
            CardTypeLine::parse("Land"),
            ManaCost::no_cost(),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec![format!(
                "AB$ Mana | Cost$ T | Produced$ {} | SpellDescription$ Add mana.",
                produced
            )],
        )
    }

    fn vanilla_spell(owner: PlayerId, name: &str, cost: &str) -> Card {
        Card::new(
            CardId(0),
            name.to_string(),
            owner,
            CardTypeLine::parse("Sorcery"),
            ManaCost::parse(cost),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec![],
        )
    }

    fn evoked_etb_creature(owner: PlayerId) -> Card {
        let mut card = Card::new(
            CardId(0),
            "Mulldrifter Test".to_string(),
            owner,
            CardTypeLine::parse("Creature - Elemental"),
            ManaCost::parse("4 U"),
            ColorSet::BLUE,
            Some(2),
            Some(2),
            vec!["Evoke:2 U".to_string()],
            vec![],
        );

        let mut next_trigger_id = 0;
        let etb_draw = crate::trigger::parse_trigger(
            "Mode$ ChangesZone | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw | TriggerDescription$ When CARDNAME enters the battlefield, draw two cards.",
            &mut next_trigger_id,
        )
        .expect("valid ETB trigger");
        card.add_trigger(etb_draw);
        card.base_trigger_count = card.triggers.len();
        card.svars.insert(
            "TrigDraw".to_string(),
            "DB$ Draw | NumCards$ 2 | Defined$ You".to_string(),
        );
        card
    }

    fn activated_permanent(
        owner: PlayerId,
        name: &str,
        type_line: &str,
        abilities: Vec<&str>,
    ) -> Card {
        Card::new(
            CardId(0),
            name.to_string(),
            owner,
            CardTypeLine::parse(type_line),
            ManaCost::no_cost(),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            abilities.into_iter().map(|s| s.to_string()).collect(),
        )
    }

    fn opening_hand_card(owner: PlayerId, name: &str, keyword: &str, svar_text: &str) -> Card {
        let mut card = Card::new(
            CardId(0),
            name.to_string(),
            owner,
            CardTypeLine::parse("Enchantment"),
            ManaCost::parse("2 W"),
            ColorSet::WHITE,
            None,
            None,
            vec![keyword.to_string()],
            vec![],
        );
        card.svars
            .insert("FromHand".to_string(), svar_text.to_string());
        card
    }

    #[test]
    fn priority_round_ignores_illegal_actions() {
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);
        let mut game = GameState::new(&["A", "B"], 20);

        let c0 = game.create_card(zero_cost_instant(p0));
        let c1 = game.create_card(zero_cost_instant(p1));
        game.move_card(c0, ZoneType::Hand, p0);
        game.move_card(c1, ZoneType::Hand, p1);

        game.turn.active_player = p0;
        game.turn.priority_player = p0;
        game.turn.phase = PhaseType::Upkeep;

        let seen = Arc::new(Mutex::new(Vec::new()));
        let bad = Arc::new(AtomicBool::new(false));
        let mut agents: Vec<Box<dyn PlayerAgent>> = vec![
            Box::new(InvalidPlayAgent),
            Box::new(RecordingPassAgent::new(seen, bad)),
        ];

        let mut game_loop = GameLoop::new(2);
        game_loop.priority_round(&mut game, &mut agents, false);

        assert!(game.stack.is_empty());
        assert!(game.cards_in_zone(ZoneType::Hand, p0).contains(&c0));
        assert!(game.cards_in_zone(ZoneType::Hand, p1).contains(&c1));
        assert_eq!(game.turn.priority_player, game.active_player());
    }

    #[test]
    fn action_space_excludes_nonland_mana_abilities_from_main_actions() {
        let p0 = PlayerId(0);
        let mut game = GameState::new(&["A", "B"], 20);

        let goose = game.create_card(activated_permanent(
            p0,
            "Gilded Goose",
            "Creature - Bird",
            vec![
                "AB$ Token | Cost$ 1 G T | TokenScript$ c_a_food_sac | TokenOwner$ You | SpellDescription$ Create a Food Token.",
                "AB$ Mana | Cost$ T Sac<1/Food> | Produced$ Any | SpellDescription$ Add one mana of any color.",
            ],
        ));
        let food = game.create_card(activated_permanent(
            p0,
            "Food Token",
            "Artifact Food",
            vec!["AB$ GainLife | Cost$ 2 T Sac<1/CARDNAME> | LifeAmount$ 3 | SpellDescription$ You gain 3 life."],
        ));
        let forest = game.create_card(mana_land(p0, "Forest", "G"));
        let island = game.create_card(mana_land(p0, "Island", "U"));

        for cid in [goose, food, forest, island] {
            game.move_card(cid, ZoneType::Battlefield, p0);
            game.card_mut(cid).summoning_sick = false;
        }

        game.turn.turn_number = 20;
        game.turn.active_player = p0;
        game.turn.priority_player = p0;
        game.turn.phase = PhaseType::Main1;

        let gl = GameLoop::new(2);
        let action_space = gl.action_space(&game, p0, true);

        let has = |cid, idx| {
            action_space
                .activatable
                .iter()
                .any(|a| a.card_id == cid && a.ability_index == idx)
        };
        assert!(has(food, 0));
        assert!(has(goose, 0));
        assert!(!has(goose, 1));
    }

    #[test]
    fn evoke_keeps_etb_triggers_when_spell_resolves() {
        let p0 = PlayerId(0);
        let _p1 = PlayerId(1);
        let mut game = GameState::new(&["A", "B"], 20);

        let evoked = game.create_card(evoked_etb_creature(p0));
        game.move_card(evoked, ZoneType::Stack, p0);

        let mut sa = SpellAbility::new_simple(Some(evoked), p0, "SP$ Permanent");
        sa.alt_cost = Some(crate::spellability::AlternativeCost::Evoke);

        game.stack.push(StackEntry {
            id: 1,
            spell_ability: sa,
            is_pending_cast: false,
            is_creature_spell: true,
            is_permanent_spell: true,
            cast_from_zone: Some(ZoneType::Hand),
            optional_trigger_decider: None,
            optional_trigger_description: None,
            optional_trigger_source_name: None,
        });

        let mut gl = GameLoop::new(2);
        let mut agents: Vec<Box<dyn PlayerAgent>> = vec![
            Box::new(RecordingPassAgent::new(
                Arc::new(Mutex::new(Vec::new())),
                Arc::new(AtomicBool::new(false)),
            )),
            Box::new(RecordingPassAgent::new(
                Arc::new(Mutex::new(Vec::new())),
                Arc::new(AtomicBool::new(false)),
            )),
        ];

        gl.resolve_stack(&mut game, &mut agents);
        gl.process_triggers(&mut game, &mut agents);

        assert_eq!(game.card(evoked).zone, ZoneType::Battlefield);
        assert!(
            game.stack
                .iter()
                .any(|entry| entry.spell_ability.api
                    == Some(crate::ability::api_type::ApiType::Draw)),
            "ETB draw trigger should be on stack for an evoked creature"
        );
        assert!(
            game.stack.iter().any(|entry| entry.spell_ability.api
                == Some(crate::ability::api_type::ApiType::Sacrifice)),
            "Evoke sacrifice trigger should be on stack"
        );
    }

    #[test]
    fn opening_hand_action_resolves_generic_keyword_effect() {
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);
        let mut game = GameState::new(&["A", "B"], 20);
        game.turn.active_player = p0;
        game.turn.priority_player = p0;

        let card_id = game.create_card(opening_hand_card(
            p0,
            "Opening Hand Test",
            "MayEffectFromOpeningHand:FromHand",
            "DB$ ChangeZone | Defined$ Self | Origin$ Hand | Destination$ Battlefield | SpellDescription$ Test opening hand action.",
        ));
        game.move_card(card_id, ZoneType::Hand, p0);

        let mut agents: Vec<Box<dyn PlayerAgent>> = vec![
            Box::new(OpeningHandAgent { accept: true }),
            Box::new(OpeningHandAgent { accept: true }),
        ];

        let mut game_loop = GameLoop::new(2);
        game_loop.run_opening_hand_actions(&mut game, &mut agents);

        assert_eq!(game.card(card_id).zone, ZoneType::Battlefield);
        assert!(game
            .cards_in_zone(ZoneType::Battlefield, p0)
            .contains(&card_id));
        assert!(!game.cards_in_zone(ZoneType::Hand, p0).contains(&card_id));
        let _ = p1;
    }

    #[test]
    fn opening_hand_action_respects_not_play_first_restriction() {
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);
        let mut game = GameState::new(&["A", "B"], 20);
        game.turn.active_player = p0;
        game.turn.priority_player = p0;

        let card_id = game.create_card(opening_hand_card(
            p0,
            "Opening Hand Skip Test",
            "MayEffectFromOpeningHand:FromHand:!PlayFirst",
            "DB$ ChangeZone | Defined$ Self | Origin$ Hand | Destination$ Battlefield | SpellDescription$ Test opening hand action.",
        ));
        game.move_card(card_id, ZoneType::Hand, p0);

        let mut agents: Vec<Box<dyn PlayerAgent>> = vec![
            Box::new(OpeningHandAgent { accept: true }),
            Box::new(OpeningHandAgent { accept: true }),
        ];

        let mut game_loop = GameLoop::new(2);
        game_loop.run_opening_hand_actions(&mut game, &mut agents);

        assert_eq!(game.card(card_id).zone, ZoneType::Hand);
        assert!(game.cards_in_zone(ZoneType::Hand, p0).contains(&card_id));
        let _ = p1;
    }
}
