use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use forge_carddb::database::ArchiveBundle;
use forge_carddb::CardDatabase;
use forge_engine_core::agent::{
    BinaryChoiceKind, GameEntity, ManaCostAction, PlayerAgent, PriorityActionSpace,
};
use forge_engine_core::card::CardInstance;
use forge_engine_core::combat::DefenderId;
use forge_engine_core::game::GameState;
use forge_engine_core::game_loop::GameLoop;
use forge_engine_core::game_runtime::GameRuntime;
use forge_engine_core::ids::{CardId, PlayerId};
use forge_engine_core::spellability::{MagicStack, SpellAbility, StackEntry};
use forge_foundation::ZoneType;
use memmap2::Mmap;
use rand::rngs::StdRng;
use rand::SeedableRng;

use crate::callback_fmt::{CallbackArgDisplay, FmtCtx, ParityFormat};
use crate::deterministic_agent::{DeterministicAgent, VerboseMode};
use crate::java_random::JavaRandom;
use crate::parity_card_map::ParityCardMap;
use crate::protocol::{CallbackRecord, DecisionRecord, GameTrace, ParityLogEntry};
use crate::snapshot::snapshot_game;
use crate::utils::decks::{build_deck_from_spec, resolve_deck_spec};

/// Directories searched, in order, when no `--decks-dir` override is given.
/// `parity_decks/` holds decks referenced by the regression suite; `public/preset_decks/`
/// holds the wider UI/import preset library.
pub const DEFAULT_DECKS_DIRS: &[&str] = &["parity_decks", "public/preset_decks"];

/// Single-string default kept for callers (e.g. CLI fallbacks, debugger crates)
/// that have not yet been migrated to the multi-dir API. Prefer
/// [`DEFAULT_DECKS_DIRS`] for new code.
pub const DEFAULT_DECKS_DIR: &str = "public/preset_decks";

/// Build the deck-search-path list from an optional CLI override.
/// `Some(dir)` → single-dir search (preserves explicit `--decks-dir` semantics);
/// `None` → fall back to [`DEFAULT_DECKS_DIRS`].
pub fn deck_search_dirs(override_dir: Option<&str>) -> Vec<&str> {
    match override_dir {
        Some(d) => vec![d],
        None => DEFAULT_DECKS_DIRS.to_vec(),
    }
}
const CARD_COPY_GUARD_THRESHOLD: usize = 100;

type LiveLogWriter = Arc<Mutex<BufWriter<File>>>;

fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn format_live_log_entry(side: &str, entry: &ParityLogEntry) -> String {
    use crate::protocol::ParityLog;

    let mut line = format!(
        "[{side}] T{}::{}::P{} {} -> {}",
        entry.turn(),
        entry.phase(),
        entry.player(),
        entry.kind(),
        entry.choice(),
    );
    for choice in entry.options() {
        line.push('\n');
        line.push_str("        ");
        line.push_str(&choice.name);
        if let Some(choices) = choice.choices {
            line.push_str(&format!("[{choices}]"));
        }
        if !choice.outcome.is_empty() {
            line.push_str(" -> ");
            line.push_str(&choice.outcome);
        }
        if let Some(rng_call_count) = choice.rng_call_count {
            line.push_str(&format!(" {{{rng_call_count}}}"));
        }
    }
    line
}

fn open_live_log(path: &PathBuf) -> Result<LiveLogWriter, String> {
    let file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(path)
        .map_err(|e| format!("Failed to open live log {}: {}", path.display(), e))?;
    Ok(Arc::new(Mutex::new(BufWriter::new(file))))
}

pub(crate) struct ParityObserver {
    shared_log: Arc<Mutex<Vec<ParityLogEntry>>>,
    shared_snapshot_index: Arc<Mutex<usize>>,
    stream_tx: Option<Sender<ParityLogEntry>>,
    live_log: Option<LiveLogWriter>,
}

impl ParityObserver {
    fn new(
        shared_log: Arc<Mutex<Vec<ParityLogEntry>>>,
        shared_snapshot_index: Arc<Mutex<usize>>,
        stream_tx: Option<Sender<ParityLogEntry>>,
        live_log: Option<LiveLogWriter>,
    ) -> Self {
        Self {
            shared_log,
            shared_snapshot_index,
            stream_tx,
            live_log,
        }
    }

    fn push_entry(&self, entry: ParityLogEntry) {
        self.shared_log.lock().unwrap().push(entry.clone());
        self.write_live_line(&format_live_log_entry("rust", &entry));
        if let Some(tx) = &self.stream_tx {
            let _ = tx.send(entry);
        }
    }

    fn write_live_line(&self, line: &str) {
        if let Some(live_log) = &self.live_log {
            let mut writer = live_log.lock().unwrap();
            let _ = writeln!(writer, "{line}");
        }
    }

    pub(crate) fn on_callback(
        &self,
        name: &str,
        outcome: &str,
        player: u32,
        turn: u32,
        phase: &str,
        callback_args: Vec<String>,
    ) {
        let choice_logs = crate::parity_log::drain();

        let snapshot_index = *self.shared_snapshot_index.lock().unwrap();
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        self.push_entry(ParityLogEntry::Callback(CallbackRecord {
            snapshot_index,
            turn,
            phase: phase.to_string(),
            player,
            name: name.to_string(),
            outcome: outcome.to_string(),
            args: choice_logs,
            callback_args,
            timestamp_ms,
        }));
    }

    fn on_event(&self, kind: &str, player: Option<PlayerId>, message: &str) {
        let player = player
            .map(|player| format!("P{}", player.0))
            .unwrap_or_else(|| "P?".to_string());
        self.write_live_line(&format!("[rust-event] {player} {kind} {message}"));
    }

    fn mark_snapshot(&self) {
        *self.shared_snapshot_index.lock().unwrap() += 1;
    }
}

struct CapturingAgent {
    player_id: PlayerId,
    inner: DeterministicAgent,
    shared_covered_cards: Arc<Mutex<BTreeSet<String>>>,
    parity_observer: Arc<ParityObserver>,
    parity_map: Arc<ParityCardMap>,
    capture_snapshots: bool,
    deep: bool,
    callback_snapshots: bool,
    abort_signal: Arc<AtomicBool>,
    current_turn: u32,
    current_phase: String,
    last_game_state: Option<GameState>,
    pending_pay_mana_cost_args: Option<Vec<String>>,
    pending_pay_mana_cost_card: Option<CardId>,
    failed_payment_cards_this_turn: HashSet<CardId>,
    #[allow(dead_code)]
    verbose: VerboseMode,
}

impl CapturingAgent {
    fn shallow_snapshot_card(
        card: &forge_engine_core::card::Card,
    ) -> forge_engine_core::card::Card {
        card.clone_for_parity_snapshot()
    }

    fn shallow_stack_entry(entry: &StackEntry) -> StackEntry {
        let mut spell_ability = SpellAbility::new_simple(
            entry.spell_ability.source,
            entry.spell_ability.activating_player,
            &entry.spell_ability.ability_text,
        );
        spell_ability.id = entry.spell_ability.id;
        StackEntry {
            id: entry.id,
            spell_ability,
            is_pending_cast: entry.is_pending_cast,
            is_creature_spell: entry.is_creature_spell,
            is_permanent_spell: entry.is_permanent_spell,
            cast_from_zone: entry.cast_from_zone,
            optional_trigger_decider: entry.optional_trigger_decider,
            optional_trigger_description: entry.optional_trigger_description.clone(),
            optional_trigger_source_name: entry.optional_trigger_source_name.clone(),
        }
    }

    fn shallow_game_state(game: &GameState) -> GameState {
        let player_names: Vec<String> = game.players.iter().map(|p| p.name.clone()).collect();
        let player_name_refs: Vec<&str> = player_names.iter().map(String::as_str).collect();
        let starting_life = game.players.first().map(|p| p.life).unwrap_or(20);
        let mut sim = GameState::new(&player_name_refs, starting_life);
        sim.players = game.players.clone();
        sim.cards = game.cards.iter().map(Self::shallow_snapshot_card).collect();
        sim.replace_zone_store(game.zone_store_snapshot());
        let mut stack = MagicStack::new();
        for entry in game.stack.iter() {
            stack.push(Self::shallow_stack_entry(entry));
        }
        sim.stack = stack;
        sim.turn = game.turn.clone();
        sim.player_order = game.player_order.clone();
        sim.game_over = game.game_over;
        sim.winner = game.winner;
        sim
    }

    fn new(
        player_id: PlayerId,
        verbose: VerboseMode,
        prefer_actions: bool,
        shared_log: Arc<Mutex<Vec<ParityLogEntry>>>,
        covered: Arc<Mutex<BTreeSet<String>>>,
        snapshot_index: Arc<Mutex<usize>>,
        stream_tx: Option<Sender<ParityLogEntry>>,
        live_log: Option<LiveLogWriter>,
        rng: Rc<RefCell<JavaRandom>>,
        game_rng: Rc<RefCell<JavaRandom>>,
        parity_map: Arc<ParityCardMap>,
        capture_snapshots: bool,
        deep: bool,
        callback_snapshots: bool,
        abort_signal: Arc<AtomicBool>,
    ) -> Self {
        let observer = Arc::new(ParityObserver::new(
            Arc::clone(&shared_log),
            snapshot_index,
            stream_tx,
            live_log,
        ));
        Self {
            player_id,
            inner: DeterministicAgent::new(
                player_id,
                verbose.clone(),
                rng,
                game_rng,
                prefer_actions,
                Arc::clone(&parity_map),
                Some(Arc::clone(&observer)),
            ),
            shared_covered_cards: covered,
            parity_observer: observer,
            parity_map,
            capture_snapshots,
            deep,
            callback_snapshots,
            abort_signal,
            current_turn: 0,
            current_phase: "Unknown".to_string(),
            last_game_state: None,
            pending_pay_mana_cost_args: None,
            pending_pay_mana_cost_card: None,
            failed_payment_cards_this_turn: HashSet::new(),
            verbose,
        }
    }

    #[allow(dead_code)]
    fn is_verbose(&self) -> bool {
        self.verbose.is_active(self.current_turn)
    }

    /// Build a formatting context for the current game state.
    /// Returns `None` if no game state has been captured yet.
    fn fmt_ctx(&self) -> Option<FmtCtx<'_>> {
        self.last_game_state.as_ref().map(|game| FmtCtx {
            game,
            parity_map: &self.parity_map,
        })
    }

    fn save_snapshot(&self, kind: &str) {
        if !self.callback_snapshots {
            return;
        }
        let Some(ref game) = self.last_game_state else {
            return;
        };
        let snapshot = snapshot_game(game);
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        self.parity_observer
            .push_entry(ParityLogEntry::Snapshot(snapshot.clone()));
        self.parity_observer
            .push_entry(ParityLogEntry::Decision(DecisionRecord {
                turn: snapshot.turn,
                phase: snapshot.phase.clone(),
                deciding_player: self.player_id.0,
                kind: kind.to_string(),
                options: vec![],
                choice: "CALLBACK_ENTRY".to_string(),
                timestamp_ms,
            }));
    }

    fn card_copy_guard_trip(game: &GameState) -> Option<(String, usize)> {
        let mut counts: HashMap<&str, usize> = HashMap::new();
        for card_id in game.cards_in_all_zones(ZoneType::Battlefield) {
            let name = game.card(card_id).card_name.as_str();
            let count = counts.entry(name).or_insert(0);
            *count += 1;
            if *count > CARD_COPY_GUARD_THRESHOLD {
                return Some((name.to_string(), *count));
            }
        }
        None
    }

    fn stop_if_card_copy_guard_tripped(&self, game: &GameState) {
        let Some((name, count)) = Self::card_copy_guard_trip(game) else {
            return;
        };
        if self.abort_signal.swap(true, Ordering::Relaxed) {
            return;
        }
        let snapshot = snapshot_game(game);
        self.parity_observer
            .push_entry(ParityLogEntry::Snapshot(snapshot.clone()));
        self.parity_observer
            .push_entry(ParityLogEntry::Decision(DecisionRecord {
                turn: snapshot.turn,
                phase: snapshot.phase.clone(),
                deciding_player: self.player_id.0,
                kind: "$PARITY_GUARD".to_string(),
                options: vec![],
                choice: format!(
                    "ABORTED: {count} copies of {name} on battlefield (limit {CARD_COPY_GUARD_THRESHOLD})"
                ),
                timestamp_ms: current_timestamp_ms(),
            }));
        self.parity_observer.on_event(
            "ParityGuard",
            Some(self.player_id),
            &format!(
                "truncated: {count} copies of {name} on battlefield (limit {CARD_COPY_GUARD_THRESHOLD})"
            ),
        );
    }

    fn filter_failed_payment_actions(
        &self,
        action_space: &PriorityActionSpace,
    ) -> PriorityActionSpace {
        if self.failed_payment_cards_this_turn.is_empty() {
            return action_space.clone();
        }
        let mut filtered = action_space.clone();
        if std::env::var("FORGE_FAIL_TRACE").is_ok() {
            let names: Vec<String> = action_space
                .activatable
                .iter()
                .map(|a| {
                    let name = self
                        .last_game_state
                        .as_ref()
                        .map(|g| {
                            let c = g.card(a.card_id);
                            format!("{} zone={:?}", c.card_name, c.zone)
                        })
                        .unwrap_or_default();
                    format!("({:?},{},{name})", a.card_id, a.ability_index)
                })
                .collect();
            eprintln!(
                "[fail-rust] T{} {} filter set={:?} activatable={:?}",
                self.current_turn, self.current_phase, self.failed_payment_cards_this_turn, names
            );
        }
        filtered
            .playable
            .retain(|play| !self.failed_payment_cards_this_turn.contains(&play.card_id));
        filtered
            .activatable
            .retain(|a| !self.failed_payment_cards_this_turn.contains(&a.card_id));
        filtered
    }
}

macro_rules! parity_agent_callback {
    ($(fn $name:ident (&mut self $(, $arg:ident : $ty:ty )* ) -> $ret:ty => $kind:expr, format_with $format:expr;)+) => {
        $(
            fn $name(&mut self $(, $arg: $ty)*) -> $ret {
                self.save_snapshot($kind);
                let fmt = self.fmt_ctx();
                let cb_args: Vec<String> = vec![$($arg.callback_arg_display(fmt.as_ref())),*];
                let result = self.inner.$name($($arg),*);
                let outcome = $format(&result, self.fmt_ctx());
                self.parity_observer.on_callback(
                    $kind,
                    &outcome,
                    self.player_id.0,
                    self.current_turn,
                    &self.current_phase,
                    cb_args,
                );
                result
            }
        )+
    };
    ($(fn $name:ident (&mut self $(, $arg:ident : $ty:ty )* ) -> $ret:ty => $kind:expr, defer_if $pat:pat => $pending:ident;)+) => {
        $(
            fn $name(&mut self $(, $arg: $ty)*) -> $ret {
                self.save_snapshot($kind);
                let fmt = self.fmt_ctx();
                let cb_args: Vec<String> = vec![$($arg.callback_arg_display(fmt.as_ref())),*];
                let result = self.inner.$name($($arg),*);
                if matches!(result, $pat) {
                    self.$pending = Some(cb_args);
                    return result;
                }
                let outcome = match self.fmt_ctx() {
                    Some(ctx) => result.parity_fmt(&ctx),
                    None => format!("{:?}", result),
                };
                self.parity_observer.on_callback(
                    $kind,
                    &outcome,
                    self.player_id.0,
                    self.current_turn,
                    &self.current_phase,
                    cb_args,
                );
                result
            }
        )+
    };
    ($(fn $name:ident (&mut self $(, $arg:ident : $ty:ty )* ) -> $ret:ty => $kind:expr;)+) => {
        $(
            fn $name(&mut self $(, $arg: $ty)*) -> $ret {
                self.save_snapshot($kind);
                let fmt = self.fmt_ctx();
                let cb_args: Vec<String> = vec![$($arg.callback_arg_display(fmt.as_ref())),*];
                let result = self.inner.$name($($arg),*);
                let outcome = match self.fmt_ctx() {
                    Some(ctx) => result.parity_fmt(&ctx),
                    None => format!("{:?}", result),
                };
                self.parity_observer.on_callback(
                    $kind,
                    &outcome,
                    self.player_id.0,
                    self.current_turn,
                    &self.current_phase,
                    cb_args,
                );
                result
            }
        )+
    };
}

impl PlayerAgent for CapturingAgent {
    fn notify(&mut self, event: forge_engine_core::agent::notification::GameNotification) {
        use forge_engine_core::agent::notification::GameNotification;
        match &event {
            GameNotification::Event(log_event) => {
                if self.player_id.0 == 0 {
                    self.parity_observer.on_event(
                        &format!("{:?}", log_event.kind),
                        log_event.player,
                        &log_event.message,
                    );
                }
                let message = &log_event.message;
                if let Some(card_name) = extract_coverage_card(message) {
                    self.shared_covered_cards
                        .lock()
                        .unwrap()
                        .insert(card_name.to_string());
                }
            }
            GameNotification::TurnChanged { turn_number, .. } => {
                self.current_turn = *turn_number;
                self.failed_payment_cards_this_turn.clear();
                self.pending_pay_mana_cost_args = None;
                self.pending_pay_mana_cost_card = None;
                if self.capture_snapshots {
                    if let Some(ref game) = self.last_game_state {
                        let mut snap = snapshot_game(game);
                        snap.phase = "Untap".to_string();
                        let active = snap.active_player as usize;
                        for (i, p) in snap.players.iter_mut().enumerate() {
                            if i != active {
                                p.lands_played = 0;
                            }
                        }
                        self.parity_observer
                            .push_entry(ParityLogEntry::Snapshot(snap));
                        self.parity_observer.mark_snapshot();
                    }
                }
            }
            GameNotification::PhaseChanged { phase } => {
                self.current_phase = format!("{:?}", phase);
                if let Some(ref mut game) = self.last_game_state {
                    game.turn.phase = *phase;
                }
                if self.deep && self.player_id.0 == 0 {
                    if let Some(ref game) = self.last_game_state {
                        self.parity_observer
                            .push_entry(ParityLogEntry::Snapshot(snapshot_game(game)));
                        self.parity_observer.mark_snapshot();
                    }
                }
            }
            GameNotification::PriorityChanged { player } => {
                if let Some(ref mut game) = self.last_game_state {
                    game.turn.priority_player = *player;
                }
                if self.deep && self.player_id.0 == 0 {
                    if let Some(ref game) = self.last_game_state {
                        self.parity_observer
                            .push_entry(ParityLogEntry::Snapshot(snapshot_game(game)));
                        self.parity_observer.mark_snapshot();
                    }
                }
            }
            GameNotification::ManaPaymentResolved { player, actions } => {
                if *player == self.player_id {
                    let pending_card = self.pending_pay_mana_cost_card.take();
                    if let Some(cb_args) = self.pending_pay_mana_cost_args.take() {
                        let outcome = match self.fmt_ctx() {
                            Some(ctx) => actions.parity_fmt(&ctx),
                            None => format!("{actions:?}"),
                        };
                        self.parity_observer.on_callback(
                            "pay_mana_cost",
                            &outcome,
                            self.player_id.0,
                            self.current_turn,
                            &self.current_phase,
                            cb_args,
                        );
                    }
                    if actions
                        .iter()
                        .any(|action| matches!(action, ManaCostAction::AttemptedAndFailed))
                    {
                        if let Some(card_id) = pending_card {
                            self.failed_payment_cards_this_turn.insert(card_id);
                        }
                    }
                }
            }
            GameNotification::ActivatedAbilityPaymentFailed {
                player, card_id, ..
            } => {
                if *player == self.player_id {
                    if std::env::var("FORGE_FAIL_TRACE").is_ok() {
                        eprintln!(
                            "[fail-rust] T{} {} insert failed card_id={:?}",
                            self.current_turn, self.current_phase, card_id
                        );
                    }
                    self.failed_payment_cards_this_turn.insert(*card_id);
                }
            }
            _ => {}
        }
        self.inner.notify(event.clone());
    }

    fn snapshot_state(
        &mut self,
        game: &GameState,
        mana_pools: &[forge_engine_core::mana::ManaPool],
    ) {
        self.inner.snapshot_state(game, mana_pools);
        self.last_game_state = Some(Self::shallow_game_state(game));
        self.stop_if_card_copy_guard_tripped(game);
    }

    fn choose_action(
        &mut self,
        player: PlayerId,
        action_space: Option<&PriorityActionSpace>,
        request_action_space: &mut dyn FnMut() -> PriorityActionSpace,
    ) -> forge_engine_core::player::actions::PlayerAction {
        let action_space_was_provided = action_space.is_some();
        if !action_space_was_provided && self.inner.should_skip_priority_action_space() {
            self.parity_observer.on_callback(
                "$ACTION_SPACE",
                "SKIPPED stack_depth>=20",
                self.player_id.0,
                self.current_turn,
                &self.current_phase,
                Vec::new(),
            );
            return self
                .inner
                .choose_action(player, action_space, request_action_space);
        }
        let requested_action_space;
        let action_space = match action_space {
            Some(action_space) => Some(action_space),
            None => {
                requested_action_space = request_action_space();
                Some(&requested_action_space)
            }
        };
        let filtered_action_space =
            action_space.map(|action_space| self.filter_failed_payment_actions(action_space));
        let action_space = filtered_action_space.as_ref();
        self.save_snapshot("choose_action");
        if std::env::var("FORGE_BF_TRACE").is_ok() && self.current_turn == 20 {
            if let Some(ref g) = self.last_game_state {
                let bf: Vec<String> = g
                    .cards
                    .iter()
                    .filter(|c| c.zone == forge_foundation::ZoneType::Battlefield)
                    .map(|c| format!("{}({:?})", c.card_name, c.controller))
                    .collect();
                eprintln!(
                    "[bf-rust] T{} {} {:?}",
                    self.current_turn, self.current_phase, bf
                );
            }
        }
        if let Some(action_space) = action_space {
            if let Some(action_space_log) = self.inner.format_action_space_for_log(action_space) {
                self.parity_observer.on_callback(
                    "$ACTION_SPACE",
                    &action_space_log,
                    self.player_id.0,
                    self.current_turn,
                    &self.current_phase,
                    Vec::new(),
                );
            }
        }
        let result = self
            .inner
            .choose_action(player, action_space, request_action_space);
        let cb_args = if action_space_was_provided {
            let action_space = action_space.expect("provided action space");
            let fmt = self.fmt_ctx();
            let activatable_ids: Vec<(CardId, usize)> = action_space
                .activatable
                .iter()
                .map(|a| (a.card_id, a.ability_index))
                .collect();
            vec![
                player.callback_arg_display(fmt.as_ref()),
                action_space
                    .playable
                    .as_slice()
                    .callback_arg_display(fmt.as_ref()),
                action_space
                    .tappable_lands
                    .as_slice()
                    .callback_arg_display(fmt.as_ref()),
                action_space
                    .untappable_lands
                    .as_slice()
                    .callback_arg_display(fmt.as_ref()),
                activatable_ids
                    .as_slice()
                    .callback_arg_display(fmt.as_ref()),
            ]
        } else {
            vec![player.callback_arg_display(self.fmt_ctx().as_ref())]
        };
        let outcome = match self.fmt_ctx() {
            Some(ctx) => result.parity_fmt(&ctx),
            None => format!("{result:?}"),
        };
        self.parity_observer.on_callback(
            "choose_action",
            &outcome,
            self.player_id.0,
            self.current_turn,
            &self.current_phase,
            cb_args,
        );
        result
    }

    parity_agent_callback! {
        fn choose_single_card_for_zone_change(&mut self, game: &GameState, player: PlayerId, valid: &[CardId], select_prompt: &str, is_optional: bool) -> Option<CardId> => "choose_single_card_for_zone_change", format_with |result: &Option<CardId>, fmt: Option<FmtCtx<'_>>| {
            match (result, fmt) {
                (Some(cid), Some(ctx)) => ctx.card(*cid),
                (Some(cid), None) => format!("{cid:?}"),
                (None, _) => "null".to_string(),
            }
        };
        fn choose_counter_type(&mut self, player: PlayerId, options: &[forge_engine_core::card::CounterType], prompt: &str) -> Option<forge_engine_core::card::CounterType> => "choose_counter_type", format_with |result: &Option<forge_engine_core::card::CounterType>, _fmt: Option<FmtCtx<'_>>| {
            match result {
                Some(forge_engine_core::card::CounterType::Named(name)) => name.clone(),
                Some(other) => format!("{other:?}").to_uppercase(),
                None => "null".to_string(),
            }
        };
    }

    parity_agent_callback! {
        fn reveal_cards(&mut self, game: &GameState, player: PlayerId, cards: &[CardId], zone: ZoneType, owner: PlayerId, message_prefix: Option<&str>) -> () => "reveal_cards";
    }

    fn pay_mana_cost(
        &mut self,
        player: PlayerId,
        card_id: CardId,
        card_name: &str,
        mana_cost: &str,
        mana_cost_display: &str,
        mana_cost_checkpoint: &str,
        can_confirm_from_pool: bool,
        allow_reserved_source_reuse: bool,
        reserved_sacrifices: &[CardId],
        mana_ability_options: &[forge_engine_core::agent::ManaAbilityOption],
        tappable_lands: &[CardId],
        untappable_lands: &[CardId],
        mana_pool: &forge_engine_core::mana::ManaPool,
    ) -> ManaCostAction {
        self.save_snapshot("pay_mana_cost");
        let fmt = self.fmt_ctx();
        let cb_args: Vec<String> = vec![
            player.callback_arg_display(fmt.as_ref()),
            card_id.callback_arg_display(fmt.as_ref()),
            card_name.callback_arg_display(fmt.as_ref()),
            mana_cost.callback_arg_display(fmt.as_ref()),
            mana_cost_display.callback_arg_display(fmt.as_ref()),
            mana_cost_checkpoint.callback_arg_display(fmt.as_ref()),
            can_confirm_from_pool.callback_arg_display(fmt.as_ref()),
            allow_reserved_source_reuse.callback_arg_display(fmt.as_ref()),
            reserved_sacrifices.callback_arg_display(fmt.as_ref()),
            mana_ability_options.callback_arg_display(fmt.as_ref()),
            tappable_lands.callback_arg_display(fmt.as_ref()),
            untappable_lands.callback_arg_display(fmt.as_ref()),
            mana_pool.callback_arg_display(fmt.as_ref()),
        ];
        let result = self.inner.pay_mana_cost(
            player,
            card_id,
            card_name,
            mana_cost,
            mana_cost_display,
            mana_cost_checkpoint,
            can_confirm_from_pool,
            allow_reserved_source_reuse,
            reserved_sacrifices,
            mana_ability_options,
            tappable_lands,
            untappable_lands,
            mana_pool,
        );
        if matches!(result, ManaCostAction::Pay { auto: true }) {
            self.pending_pay_mana_cost_args = Some(cb_args);
            self.pending_pay_mana_cost_card = Some(card_id);
            return result;
        }
        self.pending_pay_mana_cost_card = None;
        let outcome = match self.fmt_ctx() {
            Some(ctx) => result.parity_fmt(&ctx),
            None => format!("{result:?}"),
        };
        self.parity_observer.on_callback(
            "pay_mana_cost",
            &outcome,
            self.player_id.0,
            self.current_turn,
            &self.current_phase,
            cb_args,
        );
        result
    }

    parity_agent_callback! {
        fn choose_targets_for(&mut self, sa: &mut forge_engine_core::spellability::SpellAbility, game: &GameState, mana_pools: &[forge_engine_core::mana::ManaPool]) -> bool => "choose_targets_for";
        fn mulligan_decision(&mut self, player: PlayerId, hand: &[CardId], mulligan_count: u32) -> bool => "mulligan_decision";
        fn choose_cards_to_bottom(&mut self, player: PlayerId, hand: &[CardId], count: usize) -> Vec<CardId> => "choose_cards_to_bottom";
        fn choose_attackers(&mut self, player: PlayerId, available: &[CardId], possible_defenders: &[DefenderId]) -> Vec<(CardId, DefenderId)> => "choose_attackers";
        fn exert_attackers(&mut self, player: PlayerId, attackers: &[CardId]) -> Vec<CardId> => "exert_attackers";
        fn enlist_attackers(&mut self, player: PlayerId, attackers: &[CardId]) -> Vec<CardId> => "enlist_attackers";
        fn choose_blockers(&mut self, player: PlayerId, attackers: &[CardId], available_blockers: &[CardId], max_blockers: Option<usize>) -> Vec<(CardId, CardId)> => "choose_blockers";
        fn choose_blocker_for(&mut self, player: PlayerId, attackers: &[CardId], blocker: CardId) -> Option<CardId> => "choose_blocker_for";
        fn choose_damage_assignment_order(&mut self, player: PlayerId, attacker: CardId, blockers: &[CardId]) -> Vec<CardId> => "choose_damage_assignment_order";
        fn assign_combat_damage(&mut self, game: &GameState, player: PlayerId, attacker: CardId, blockers_in_order: &[CardId], defender: Option<forge_engine_core::combat::DefenderId>, damage_to_assign: i32) -> Vec<(Option<CardId>, i32)> => "assign_combat_damage";
        fn choose_target_player(&mut self, player: PlayerId, valid: &[PlayerId], sa: Option<&forge_engine_core::spellability::SpellAbility>) -> Option<PlayerId> => "choose_target_player";
        fn choose_target_card(&mut self, player: PlayerId, valid: &[CardId], sa: Option<&forge_engine_core::spellability::SpellAbility>) -> Option<CardId> => "choose_target_card";
        fn choose_target_card_from_zone(&mut self, player: PlayerId, zone: ZoneType, valid: &[CardId], sa: Option<&forge_engine_core::spellability::SpellAbility>) -> Option<CardId> => "choose_target_card_from_zone";
        fn choose_target_any(&mut self, player: PlayerId, valid_players: &[PlayerId], valid_cards: &[CardId], sa: Option<&forge_engine_core::spellability::SpellAbility>) -> forge_engine_core::agent::TargetChoice => "choose_target_any";
        fn choose_legend_keep(&mut self, player: PlayerId, duplicates: &[CardId]) -> CardId => "choose_legend_keep";
        fn choose_sacrifice(&mut self, player: PlayerId, valid: &[CardId], source: Option<CardId>) -> Option<CardId> => "choose_sacrifice";
        fn choose_type(&mut self, player: PlayerId, type_category: &str, valid_types: &[String]) -> Option<String> => "choose_type";
        fn choose_scry(&mut self, game: &GameState, player: PlayerId, cards: &[CardId]) -> Vec<CardId> => "choose_scry";
        fn choose_surveil(&mut self, game: &GameState, player: PlayerId, cards: &[CardId]) -> Vec<CardId> => "choose_surveil";
        fn choose_dig(&mut self, game: &GameState, player: PlayerId, valid: &[CardId], max: usize, optional: bool) -> Vec<CardId> => "choose_dig";
        fn choose_reorder_library(&mut self, game: &GameState, player: PlayerId, cards: &[CardId]) -> Vec<CardId> => "choose_reorder_library";
        fn choose_discard(&mut self, player: PlayerId, hand: &[CardId], num: usize) -> Vec<CardId> => "choose_discard";
        fn choose_discard_any_number(&mut self, player: PlayerId, hand: &[CardId], min: usize, max: usize) -> Vec<CardId> => "choose_discard";
        fn choose_random_discard(&mut self, player: PlayerId, hand: &[CardId], num: usize) -> Vec<CardId> => "choose_random_discard";
        fn choose_cards_for_effect(&mut self, player: PlayerId, valid: &[CardId], min: usize, max: usize) -> Vec<CardId> => "choose_cards_for_effect";
        fn choose_tap_type_for_cost(&mut self, player: PlayerId, valid: &[CardId], min_total_power: i32, card_powers: &[(CardId, i32)], card_sort_powers: &[(CardId, i32)], sa: Option<&forge_engine_core::spellability::SpellAbility>) -> Vec<CardId> => "choose_tap_type_for_cost";
        fn choose_cards_for_zone_change(&mut self, game: &GameState, player: PlayerId, valid: &[CardId], min: usize, max: usize, select_prompt: &str) -> Vec<CardId> => "choose_cards_for_zone_change";
        fn choose_target_spell(&mut self, player: PlayerId, valid: &[u32], source: Option<CardId>) -> Option<u32> => "choose_target_spell";
        fn choose_mode(&mut self, player: PlayerId, descriptions: &[String], min: usize, max: usize, source_card_id: Option<CardId>) -> Vec<usize> => "choose_mode";
        fn choose_spell_abilities_for_effect(&mut self, player: PlayerId, abilities: &[forge_engine_core::spellability::SpellAbility], num: usize) -> Vec<usize> => "choose_spell_abilities_for_effect";
        fn choose_single_entity_for_effect(&mut self, player: PlayerId, valid: &[GameEntity], is_optional: bool) -> Option<GameEntity> => "choose_single_entity_for_effect";
        fn get_ability_to_play(&mut self, player: PlayerId, abilities: &[forge_engine_core::spellability::SpellAbility]) -> Option<usize> => "get_ability_to_play";
        fn choose_x_value(&mut self, player: PlayerId, max_x: u32, source: Option<CardId>) -> u32 => "choose_x_value";
        fn announce_requirements(&mut self, player: PlayerId, announce: &str, min: i32, max: i32, source: Option<CardId>) -> Option<i32> => "announce_requirements";
        fn choose_optional_trigger(&mut self, player: PlayerId, description: &str, source: Option<CardId>, api: Option<forge_engine_core::ability::api_type::ApiType>) -> bool => "choose_optional_trigger";
        fn choose_land_or_spell(&mut self, player: PlayerId) -> Option<bool> => "choose_land_or_spell";
        fn confirm_action(&mut self, player: PlayerId, mode: Option<&str>, message: &str, options: &[String], source: Option<CardId>, api: Option<forge_engine_core::ability::api_type::ApiType>) -> bool => "confirm_action";
        fn confirm_payment(&mut self, player: PlayerId, cost_kind: &str, message: &str, source: Option<CardId>, api: Option<forge_engine_core::ability::api_type::ApiType>) -> bool => "confirm_payment";
        fn pay_cost_to_prevent_effect(&mut self, player: PlayerId, cost_kind: &str, message: &str, source: Option<CardId>, api: Option<forge_engine_core::ability::api_type::ApiType>, can_pay: bool) -> bool => "pay_cost_to_prevent_effect";
        fn confirm_replacement_effect(&mut self, player: PlayerId, question: &str, effect_description: &str, source: Option<CardId>) -> bool => "confirm_replacement_effect";
        fn choose_binary(&mut self, player: PlayerId, question: &str, kind: BinaryChoiceKind, default_choice: Option<bool>, source: Option<CardId>, api: Option<forge_engine_core::ability::api_type::ApiType>) -> bool => "choose_binary";
        fn choose_color(&mut self, player: PlayerId, valid_colors: &[String]) -> Option<String> => "choose_color";
        fn choose_colors(&mut self, player: PlayerId, valid_colors: &[String], min: usize, max: usize) -> Vec<String> => "choose_colors";
        fn choose_card_name(&mut self, player: PlayerId, valid_names: &[String]) -> Option<String> => "choose_card_name";
        fn choose_number(&mut self, player: PlayerId, min: i32, max: i32) -> Option<i32> => "choose_number";
        fn choose_number_for_keyword_cost(&mut self, player: PlayerId, max: i32, prompt: &str, source: Option<CardId>) -> i32 => "choose_number_for_keyword_cost";
        fn choose_number_from_list(&mut self, player: PlayerId, choices: &[i32], message: &str, source_card_id: Option<CardId>) -> Option<i32> => "choose_number_from_list";
        fn choose_roll_to_ignore(&mut self, player: PlayerId, rolls: &[i32], source: Option<CardId>) -> Option<i32> => "choose_roll_to_ignore";
        fn choose_roll_to_swap(&mut self, player: PlayerId, rolls: &[i32], source: Option<CardId>) -> Option<i32> => "choose_roll_to_swap";
        fn choose_dice_to_reroll(&mut self, player: PlayerId, rolls: &[i32], source: Option<CardId>) -> Vec<i32> => "choose_dice_to_reroll";
        fn choose_roll_to_modify(&mut self, player: PlayerId, rolls: &[i32], source: Option<CardId>) -> Option<i32> => "choose_roll_to_modify";
        fn choose_roll_swap_value(&mut self, player: PlayerId, current_result: i32, power: i32, toughness: i32, source: Option<CardId>) -> Option<forge_engine_core::agent::RollSwapChoice> => "choose_roll_swap_value";
        fn flip_coin_call(&mut self, player: PlayerId) -> bool => "flip_coin_call";
        fn choose_phyrexian_pay_life(&mut self, player: PlayerId, color: &str, source: Option<CardId>) -> bool => "choose_phyrexian_pay_life";
        fn pay_combat_cost(&mut self, player: PlayerId, attacker: CardId, cost: i32, description: &str, tappable_lands: &[CardId], untappable_lands: &[CardId], mana_pool_total: i32) -> forge_engine_core::agent::CombatCostAction => "pay_combat_cost";
        fn choose_delve(&mut self, player: PlayerId, valid: &[CardId], max: usize, source: Option<CardId>) -> Vec<CardId> => "choose_delve";
        fn choose_improvise(&mut self, player: PlayerId, untapped_artifacts: &[CardId], remaining_cost: &forge_foundation::ManaCost, source: Option<CardId>) -> Vec<CardId> => "choose_improvise";
        fn choose_convoke(&mut self, player: PlayerId, untapped_creatures: &[CardId], remaining_cost: &forge_foundation::ManaCost, source: Option<CardId>) -> Vec<CardId> => "choose_convoke";
        fn specify_mana_combo(&mut self, player: PlayerId, available_colors: &[String], amount: usize, source: Option<CardId>, express_choice: Option<u16>) -> Vec<String> => "specify_mana_combo";
        fn choose_explore_put_in_graveyard(&mut self, game: &GameState, player: PlayerId, revealed_card_name: &str, revealed_cmc: i32, mana_producing_lands: usize, predicted_mana: usize, lands_in_hand: usize) -> bool => "choose_explore_put_in_graveyard";
        fn choose_kicker(&mut self, player: PlayerId, kicker_cost: &str, source: Option<CardId>) -> bool => "choose_kicker";
        fn help_pay_assist(&mut self, player: PlayerId, card_name: &str, max_generic: u32) -> u32 => "help_pay_assist";
        fn choose_buyback(&mut self, player: PlayerId, buyback_cost: &str, source: Option<CardId>) -> bool => "choose_buyback";
        fn choose_multikicker(&mut self, player: PlayerId, cost: &str, max_kicks: u32, source: Option<CardId>) -> u32 => "choose_multikicker";
        fn choose_replicate(&mut self, player: PlayerId, cost: &str, max_replicates: u32, source: Option<CardId>) -> u32 => "choose_replicate";
        fn choose_alternative_cost(&mut self, player: PlayerId, options: &[String], source: Option<CardId>) -> usize => "choose_alternative_cost";
        fn choose_single_replacement_effect(&mut self, player: PlayerId, descriptions: &[String]) -> usize => "choose_single_replacement_effect";
        fn choose_entities_for_effect(&mut self, player: PlayerId, candidates: &[GameEntity], min: usize, ax: usize) -> Vec<GameEntity> => "choose_entities_for_effect";
    }
}

#[derive(Clone)]
pub struct RunConfig {
    pub deck1: String,
    pub deck2: String,
    pub seed: u64,
    pub max_turns: u32,
    pub cards_dir: Option<String>,
    pub decks_dir: Option<String>,
    pub verbose: VerboseMode,
    pub prefer_actions: bool,
    pub deep: bool,
    pub loose_parity: bool,
    pub log_snapshots: bool,
    pub java_heap: String,
    /// Game variant: "Constructed", "Commander", "Oathbreaker", "TinyLeaders", "Brawl".
    pub variant: String,
    /// Commander card names for Commander variants.
    pub commanders: Vec<String>,
    /// Store full callback logs (for --full-log display).
    pub full_log: bool,
    /// Write Rust-side parity entries as they are recorded.
    pub live_log: Option<PathBuf>,
}

pub struct LoadedData {
    pub db: CardDatabase,
    pub token_templates: Vec<(String, CardInstance)>,
}

// Parity runners share loaded card data across worker threads. Game execution
// clones card definitions into per-game state before mutation; the shared
// database/templates are treated as immutable runtime inputs.
unsafe impl Sync for LoadedData {}

fn cardset_archive_path() -> std::path::PathBuf {
    if let Ok(path) = std::env::var("CARDSET_ARCHIVE") {
        std::path::PathBuf::from(path)
    } else {
        std::path::PathBuf::from("src-tauri/resources/cardset.rkyv")
    }
}

fn load_archive_bundle(archive_path: &std::path::Path) -> Result<ArchiveBundle, String> {
    let file = std::fs::File::open(archive_path).map_err(|e| format!("open: {e}"))?;
    let mmap = unsafe { Mmap::map(&file).map_err(|e| format!("mmap: {e}"))? };
    CardDatabase::load_from_archive(&mmap)
}

pub fn load_data(cards_dir: Option<&str>, verbose: bool) -> Result<LoadedData, String> {
    let _t_total = Instant::now();
    let cards_dir = cards_dir.unwrap_or("forge/forge-gui/res/cardsfolder");
    let cards_path = std::path::Path::new(cards_dir);

    let archive_path = cardset_archive_path();
    if !archive_path.exists() {
        return Err(format!(
            "Cardset archive not found at {}. Run `cargo build -p forge-web` (or `yarn build:wasm`) to build it.",
            archive_path.display()
        ));
    }
    let bundle = load_archive_bundle(&archive_path)?;
    if verbose {
        eprintln!(
            "[parity] Loaded {} cards ({} failed), {} tokens ({} failed) from archive {}",
            bundle.cards_result.loaded,
            bundle.cards_result.failed,
            bundle.tokens_result.loaded,
            bundle.tokens_result.failed,
            archive_path.display()
        );
    }
    let ArchiveBundle {
        cards: db,
        tokens: token_db,
        cards_result: _,
        tokens_result: _,
    } = bundle;
    if verbose {
        let script_stats = crate::card_pool::scan_raw_script_diagnostics(cards_path);
        eprintln!("[parity] {}", script_stats);
        for example in script_stats.example_lines() {
            eprintln!("[parity] script diagnostic example: {}", example);
        }
        for example in script_stats.semantic_raw_example_lines() {
            eprintln!("[parity] script semantic raw example: {}", example);
        }
        for example in script_stats.svar_raw_dollar_example_lines() {
            eprintln!("[parity] script raw SVar dollar example: {}", example);
        }
        for example in script_stats.raw_dsl_domain_example_lines() {
            eprintln!("[parity] script raw DSL domain example: {}", example);
        }
        if !script_stats.svar_raw_dollar_shapes.is_empty() {
            eprintln!("[parity] script raw SVar dollar shapes:");
            let mut shapes = script_stats
                .svar_raw_dollar_shapes
                .iter()
                .collect::<Vec<_>>();
            shapes.sort_by(|a, b| b.1.cmp(a.1).then_with(|| a.0.cmp(b.0)));
            for (shape, count) in shapes.iter().take(32) {
                eprintln!("[parity]   {count:6} {shape}");
            }
        }
        if !script_stats.raw_dsl_domain_shapes.is_empty() {
            eprintln!("[parity] script raw DSL domains:");
            let mut shapes = script_stats
                .raw_dsl_domain_shapes
                .iter()
                .collect::<Vec<_>>();
            shapes.sort_by(|a, b| b.1.cmp(a.1).then_with(|| a.0.cmp(b.0)));
            for (shape, count) in shapes.iter().take(48) {
                eprintln!("[parity]   {count:6} {shape}");
            }
        }
    }

    // Tokens come from the same rkyv archive bundle as cards.
    let mut token_templates = Vec::new();
    for (script_name, rules) in token_db.iter() {
        let template = CardInstance::from_rules(rules, PlayerId(0));
        token_templates.push((script_name, template));
    }

    // Load creature types from TypeLists.txt into the engine's global registry.
    // Mirrors Java's FModel.loadDynamicGamedata() → CardType.Constant.CREATURE_TYPES.
    {
        let type_list_path = cards_path
            .parent()
            .map(|p| p.join("lists").join("TypeLists.txt"))
            .unwrap_or_default();
        if !type_list_path.exists() {
            return Err(format!(
                "TypeLists.txt not found at {:?}. This file is required for creature type data.",
                type_list_path
            ));
        }
        if verbose {
            eprintln!("[parity] Loading type lists from {:?} ...", type_list_path);
        }
        let _t_types_read = Instant::now();
        let content = std::fs::read_to_string(&type_list_path).map_err(|e| {
            format!(
                "Failed to read TypeLists.txt at {:?}: {}",
                type_list_path, e
            )
        })?;
        let _t_types_parse = Instant::now();
        forge_engine_core::game::TypeRegistry::load(&content);
        if verbose {
            eprintln!(
                "[parity] Loaded {} creature types",
                forge_engine_core::game::TypeRegistry::creature_types().len()
            );
        }
    }

    Ok(LoadedData {
        db,
        token_templates,
    })
}

pub fn run_with_data(config: &RunConfig, data: &LoadedData) -> Result<GameTrace, String> {
    run_with_data_streaming(config, data, None)
}

pub fn run_with_data_streaming(
    config: &RunConfig,
    data: &LoadedData,
    stream_tx: Option<Sender<ParityLogEntry>>,
) -> Result<GameTrace, String> {
    let _t_total = Instant::now();
    // Resolve deck lists — supports preset names, inline: specs, and file: specs
    let decks_dirs = deck_search_dirs(config.decks_dir.as_deref());
    let _t_resolve = Instant::now();
    let deck1_spec = resolve_deck_spec(&config.deck1, &decks_dirs)?;
    let deck2_spec = resolve_deck_spec(&config.deck2, &decks_dirs)?;

    // Determine starting life based on variant
    let starting_life = match config.variant.as_str() {
        "Commander" => 40,
        "Oathbreaker" => 20,
        "TinyLeaders" => 25,
        "Brawl" => 30,
        _ => 20, // Constructed and other variants
    };

    // Set up game
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);
    let mut game = GameState::new(&["Player1", "Player2"], starting_life);

    let _t_build = Instant::now();
    build_deck_from_spec(
        &mut game,
        &data.db,
        p0,
        &deck1_spec,
        config.verbose.is_any(),
    );
    build_deck_from_spec(
        &mut game,
        &data.db,
        p1,
        &deck2_spec,
        config.verbose.is_any(),
    );

    // Set up commanders if in a commander variant
    let is_commander_variant = matches!(
        config.variant.as_str(),
        "Commander" | "Oathbreaker" | "TinyLeaders" | "Brawl"
    );
    if is_commander_variant && !config.commanders.is_empty() {
        let mut unique_commanders: Vec<&str> = Vec::new();
        let mut seen = HashSet::new();
        for commander_name in &config.commanders {
            let key = commander_name.to_ascii_lowercase();
            if seen.insert(key) {
                unique_commanders.push(commander_name.as_str());
            }
        }

        // For each player, find commander cards already present in library and move to command zone.
        // Contract: --commander names must already be in the main deck list.
        for &pid in &[p0, p1] {
            for commander_name in &unique_commanders {
                let card_id = game
                    .cards_in_zone(ZoneType::Library, pid)
                    .iter()
                    .copied()
                    .find(|&cid| {
                        game.card(cid)
                            .card_name
                            .eq_ignore_ascii_case(commander_name)
                    })
                    .ok_or_else(|| {
                        format!(
                            "Commander \"{}\" not found in player {} main deck/library",
                            commander_name,
                            pid.0 + 1
                        )
                    })?;

                // Move to command zone and register as commander.
                game.move_card(card_id, ZoneType::Command, pid);
                game.player_register_commander(pid, card_id);
            }
            // Create the commander effect card (provides the "if a commander
            // would be put into its owner's hand or library, its owner may put
            // it into the command zone instead" replacement). Without this,
            // bouncing or milling a commander moves it to hand/library and
            // breaks parity with Java's `CommanderEffect`.
            game.player_create_commander_effect(pid, None);
        }
        // Set commander_damage_enabled based on variant
        let commander_damage_enabled = config.variant == "Commander";
        for &pid in &[p0, p1] {
            game.player_mut(pid).commander_damage_enabled = commander_damage_enabled;
        }
    }

    let mut game_loop = GameLoop::new(2);
    game_loop.set_provide_priority_action_space(false);
    let abort_signal = Arc::new(AtomicBool::new(false));
    game_loop.set_abort_signal(Arc::clone(&abort_signal));

    // Register token templates
    for (script_name, template) in &data.token_templates {
        game_loop.register_token(script_name.clone(), template.clone());
    }

    // Copy token art variant data from the card DB for game-RNG parity.
    // Java's Aggregates.random() on a Set consumes nextInt() per element,
    // so Rust must know how many art variants each token has per edition.
    game_loop.token_art_variants = data.db.token_art_variants().clone();
    game_loop.token_fallback = data.db.token_fallback().clone();
    game_loop.edition_dates = data.db.edition_dates().clone();

    // Shared storage for parity log entries captured by CapturingAgent
    let shared_log: Arc<Mutex<Vec<ParityLogEntry>>> = Arc::new(Mutex::new(Vec::new()));
    let shared_covered_cards: Arc<Mutex<BTreeSet<String>>> = Arc::new(Mutex::new(BTreeSet::new()));
    let live_log = config.live_log.as_ref().map(open_live_log).transpose()?;
    if let Some(live_log) = &live_log {
        let mut writer = live_log.lock().unwrap();
        let _ = writeln!(
            writer,
            "# rust live parity log deck1={} deck2={} seed={} max_turns={}",
            config.deck1, config.deck2, config.seed, config.max_turns
        );
        let _ = writer.flush();
    }

    // Run game with fixed seed (for any engine-internal randomness)
    let mut rng = StdRng::seed_from_u64(config.seed);

    // Setup: shuffle libraries with Java-compatible RNG so opening hands match
    // the Java Forge engine, then draw 7 cards per player.
    //
    // Java's flow in match.startGame():
    //   1. prepareAllZones() — builds libraries (no RNG)
    //   2. player.shuffle(null) for each player — Collections.shuffle(list, rng)
    //   3. drawStartingHand() — moves top 7 cards to hand (no RNG)
    //
    // The game_rng mirrors Java's MyRandom — same seed, same consumption order.
    // It's used for both shuffling and game-level random effects (e.g.
    // Aggregates.random() in DiscardEffect Mode$ Random). After shuffling,
    // its state matches Java's MyRandom post-shuffle, so subsequent random
    // effects produce identical results.
    let game_rng = Rc::new(RefCell::new({
        let mut r = JavaRandom::new(config.seed as i64);
        r.label = "game";
        r
    }));
    {
        let _t_shuffle = Instant::now();
        let mut shuffle_rng = game_rng.borrow_mut();
        for &pid in &game.player_order.clone() {
            // Sort library by card name for deterministic pre-shuffle ordering,
            // matching Java's Match.preparePlayerZone which sorts after building
            // from ConcurrentHashMap-backed CardPool.
            let mut lib_cards: Vec<CardId> = game.cards_in_zone(ZoneType::Library, pid).to_vec();
            lib_cards.sort_by(|a, b| {
                game.cards[a.index()]
                    .card_name
                    .cmp(&game.cards[b.index()].card_name)
            });
            // Shuffle using the Java-compatible PRNG
            shuffle_rng.shuffle(&mut lib_cards);
            // Reverse so Java's index-0 "top" becomes Rust's last-element "top"
            // (Rust draws via pop(), Java draws via get(0))
            lib_cards.reverse();
            // Write back the shuffled order
            game.replace_zone_cards(ZoneType::Library, pid, lib_cards);
        }
    }

    // Match Java's determineFirstTurnPlayer() "coin flip".
    // Java calls Aggregates.random(game.getPlayers()) where game.getPlayers()
    // returns a PlayerCollection (extends FCollection<Player> implements List<Player>).
    // Since it implements List, Aggregates.random takes the List fast-path:
    //   src.get(MyRandom.getRandom().nextInt(len))
    // That's a single nextInt(numPlayers) call.
    // The result is overridden by DeterministicController.chooseStartingPlayer()
    // which always returns player 0 — we just need to consume the same RNG call.
    {
        let num_players = game.player_order.len() as i32;
        let _coin_flip = game_rng.borrow_mut().next_int(num_players);
    }
    for &pid in &game.player_order.clone() {
        game.draw_cards(pid, 7);
    }
    // Create a SEPARATE agent RNG seeded identically to Java's `new Random(seed)`.
    // This is distinct from the game RNG — both sides create a fresh Random(seed)
    // for agent decisions, ensuring the RNG state matches even though the game
    // RNG is consumed differently by each engine's internals.
    // IMPORTANT: Must be created BEFORE opening-hand actions since Java's
    // chooseSaToActivateFromOpeningHand consumes this RNG.
    let agent_rng = Rc::new(RefCell::new({
        let mut r = JavaRandom::new(config.seed as i64);
        r.label = "agent";
        r
    }));

    let parity_log_sink: Arc<Mutex<Vec<crate::protocol::ChoiceLogEntry>>> =
        Arc::new(Mutex::new(Vec::new()));
    crate::parity_log::set_sink(Arc::clone(&parity_log_sink));

    let parity_map = Arc::new(ParityCardMap::from_opening_state(&game));
    let shared_snapshot_index: Arc<Mutex<usize>> = Arc::new(Mutex::new(0));

    // Create deterministic agents — player 0 uses CapturingAgent to collect
    // turn-start snapshots (matching Java's GameEventTurnBegan timing).
    // Both agents share the same agent RNG so consumption order matches Java.
    // Both agents share the same game RNG so random effects match Java's MyRandom.
    // Both agents share the same snapshot_index so callbacks from either player
    // reference the correct snapshot position (matching Java's approach).
    let agents: Vec<Box<dyn PlayerAgent>> = vec![
        Box::new(CapturingAgent::new(
            p0,
            config.verbose.clone(),
            config.prefer_actions,
            Arc::clone(&shared_log),
            Arc::clone(&shared_covered_cards),
            Arc::clone(&shared_snapshot_index),
            stream_tx.clone(),
            live_log.clone(),
            Rc::clone(&agent_rng),
            Rc::clone(&game_rng),
            Arc::clone(&parity_map),
            !config.deep,
            config.deep,
            false,
            Arc::clone(&abort_signal),
        )),
        Box::new(CapturingAgent::new(
            p1,
            config.verbose.clone(),
            config.prefer_actions,
            Arc::clone(&shared_log),
            Arc::clone(&shared_covered_cards),
            Arc::clone(&shared_snapshot_index),
            stream_tx,
            live_log.clone(),
            Rc::clone(&agent_rng),
            Rc::clone(&game_rng),
            Arc::clone(&parity_map),
            false,
            config.deep,
            false,
            Arc::clone(&abort_signal),
        )),
    ];

    // Wire the Java-compatible RNG into the game loop so that effect-level
    // shuffles, coin flips, and dice rolls consume the same PRNG instance
    // as the agents, matching Java's single MyRandom consumption order.
    game_loop.game_rng = Box::new(crate::java_random::JavaGameRng(Rc::clone(&game_rng)));
    let mut runtime = GameRuntime::from_parts(game, game_loop, agents);
    runtime.run_opening_hand_actions();

    forge_engine_core::perf::reset_counters();

    // Run turns — CapturingAgent captures turn-start snapshots automatically
    while !runtime.game().game_over && runtime.game().turn.turn_number <= config.max_turns {
        let _t_turn = Instant::now();
        runtime.run_turn(&mut rng);
        forge_engine_core::perf::record_turn_wall(_t_turn.elapsed());
    }

    crate::parity_log::clear_sink();

    let log: Vec<ParityLogEntry> = shared_log.lock().unwrap().clone();
    let covered_cards: Vec<String> = shared_covered_cards
        .lock()
        .unwrap()
        .iter()
        .cloned()
        .collect();

    Ok(GameTrace {
        seed: config.seed,
        deck1: config.deck1.clone(),
        deck2: config.deck2.clone(),
        max_turns: config.max_turns,
        variant: config.variant.clone(),
        commanders: config.commanders.clone(),
        log,
        covered_cards,
    })
}

pub fn run_rust_only(config: &RunConfig) -> Result<GameTrace, String> {
    let data = load_data(config.cards_dir.as_deref(), config.verbose.is_any())?;
    run_with_data(config, &data)
}

fn extract_coverage_card(message: &str) -> Option<&str> {
    message
        .strip_prefix("Played land: ")
        .or_else(|| message.strip_prefix("Cast: "))
        .map(str::trim)
        .filter(|s| !s.is_empty())
}
