use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::env;
use std::path::{Path, PathBuf};
use std::sync::mpsc::TryRecvError;
use std::sync::Arc;
use std::time::{Duration, Instant};

use eframe::egui;
use forge_card_script::ParsedCardScript;
use forge_parity::deterministic_agent::VerboseMode;
use forge_parity::java_bridge::JavaMatchupData;
use forge_parity::parity_compare::extract_investigation_window;
use forge_parity::protocol::{
    CallbackRecord, Divergence, GameTrace, MatchupResult, ParityLog, ParityLogEntry, StateSnapshot,
};
use forge_parity::runner::RunConfig;
use serde::Deserialize;

mod archive;
mod card_widgets;
mod script_view;
mod theme;
mod ts_view;
mod worker;

use crate::archive::ArchiveState;
use crate::card_widgets::{
    render_battlefield_strip, render_hand_strip, render_selectable_card_row,
};
use crate::script_view::{render_ast, render_summary};
use crate::ts_view::highlight_source_job;
use crate::worker::{TraceRunRequest, TraceWorkerCommand, TraceWorkerEvent, TraceWorkerHandle};

pub(crate) fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.."))
}

pub(crate) fn repo_relative_path(path: &str) -> PathBuf {
    repo_root().join(path)
}

pub(crate) fn shell_quote(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }
    if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | '/' | ':'))
    {
        value.to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\"'\"'"))
    }
}

fn resolved_existing_path(path: &Path) -> Option<PathBuf> {
    let resolved = if path.is_absolute() {
        path.to_path_buf()
    } else {
        repo_root().join(path)
    };
    resolved.exists().then_some(resolved)
}

pub(crate) fn discover_java_jar(preferred: Option<&Path>) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = env::var_os("MANA_BREW_FORGE_HARNESS_JAR") {
        candidates.push(PathBuf::from(path));
    }
    if let Some(path) = preferred {
        candidates.push(path.to_path_buf());
    }
    candidates.push(repo_relative_path(DEFAULT_JAVA_JAR_PATH));
    candidates
        .into_iter()
        .find_map(|candidate| resolved_existing_path(&candidate))
}

const DEFAULT_ARCHIVE_PATH: &str = "src-tauri/resources/cardset.rkyv";
const REGRESSION_JSON_PATH: &str = "forge-engine/crates/forge-parity/regression.json";
const SEARCH_RESULT_LIMIT: usize = 30;
const TRACE_SNAPSHOT_HEIGHT: f32 = 320.0;
const TRACE_EVENTS_HEIGHT: f32 = 180.0;
const TRACE_TIMELINE_HEIGHT: f32 = TRACE_SNAPSHOT_HEIGHT + TRACE_EVENTS_HEIGHT + 28.0;
const TRACE_DECK_1: &str = "inline:Mountain*6|Lightning Bolt*2|Shock*2|Raging Goblin*2";
const TRACE_DECK_2: &str = "inline:Forest*6|Llanowar Elves*2|Grizzly Bears*2|Runeclaw Bear*2";
pub(crate) const DEFAULT_JAVA_JAR_PATH: &str =
    "forge-harness/target/forge-harness-jar-with-dependencies.jar";

const SAMPLE: &str = "Name:Lightning Bolt\nManaCost:R\nTypes:Instant\nA:SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3 | SpellDescription$ CARDNAME deals 3 damage to any target.\nOracle:Lightning Bolt deals 3 damage to any target.\n";

fn main() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1200.0, 800.0])
            .with_title("Forge Engine Debugger"),
        ..Default::default()
    };
    eframe::run_native(
        "forge-engine-debugger",
        options,
        Box::new(|cc| {
            theme::install(&cc.egui_ctx);
            Ok(Box::new(App::default()))
        }),
    )
}

struct App {
    source: String,
    current_path: Option<PathBuf>,
    load_error: Option<String>,
    archive: Option<ArchiveState>,
    archive_path: PathBuf,
    archive_error: Option<String>,
    search_query: String,
    trace: Option<TraceSession>,
    trace_error: Option<String>,
    trace_worker: Option<TraceWorkerHandle>,
    trace_running: bool,
    trace_collecting_context: bool,
    trace_halted_on_divergence: bool,
    trace_status: Option<String>,
    trace_debug_log: VecDeque<String>,
    trace_reveal_ms: u64,
    selected_card: Option<InspectedCard>,
    trace_follow_live: bool,
    trace_panel_height: f32,
    summary_panel_height: f32,
    right_snapshot_panel_height: f32,
    right_events_panel_height: f32,
    ast_view_mode: AstViewMode,
    trace_mode: TraceMode,
    active_trace_pane: TracePaneKind,
    java_jar_path: PathBuf,
    java_harness_building: bool,
    trace_presets: Vec<TracePreset>,
    selected_trace_preset: usize,
    trace_deck1_input: String,
    trace_deck2_input: String,
    trace_seed_input: u64,
    trace_max_turns_input: u32,
    trace_games_input: u32,
    trace_game_index_input: u32,
    trace_prefer_actions: bool,
    trace_deep: bool,
    trace_loose_parity: bool,
    trace_variant: String,
    trace_commanders: Vec<String>,
    deck_modal_open: bool,
    deck_modal_query: String,
    toolbar_popover: Option<ToolbarPopover>,
    toolbar_popover_just_opened: bool,
    compare_debug_state: Option<String>,
}

struct TraceSession {
    mode: TraceMode,
    deck1: String,
    deck2: String,
    seed: u64,
    max_turns: u32,
    loose_parity: bool,
    rust: Option<TracePaneState>,
    java: Option<TracePaneState>,
    comparison: Option<TraceComparison>,
    pending_comparison: Option<TraceComparison>,
    compare_selected_row: usize,
    compare_selected_anchor: Option<CompareSelectionAnchor>,
    compare_visible_row_count: usize,
    compare_display_rows: Vec<ComparePhaseRow>,
    compare_live_rows: RefCell<Vec<ComparePhaseRow>>,
    compare_live_counts: Cell<(usize, usize)>,
    compare_rows_cache: RefCell<Vec<ComparePhaseRow>>,
    compare_rows_cache_versions: Cell<(u64, u64)>,
}

struct TracePaneState {
    deck1: String,
    deck2: String,
    seed: u64,
    max_turns: u32,
    log_entries: Vec<ParityLogEntry>,
    snapshots: Vec<StateSnapshot>,
    selected_snapshot: usize,
    final_game: Option<GameTrace>,
    pending_entries: VecDeque<ParityLogEntry>,
    last_reveal_at: Instant,
    pending_timeline_scroll: bool,
    snapshot_version: u64,
    stream_complete: bool,
}

#[derive(Clone)]
struct TraceComparison {
    snapshots_compared: usize,
    first_divergence: Option<Divergence>,
    per_snapshot: Vec<Divergence>,
    divergence_key: Option<PhaseKey>,
    rust_snapshot: Option<StateSnapshot>,
    java_snapshot: Option<StateSnapshot>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum AstViewMode {
    Graph,
    Text,
}

#[derive(Clone, PartialEq, Eq, Hash)]
struct CallbackKey {
    turn: u32,
    phase: String,
    player: u32,
    name: String,
}

#[derive(Clone, PartialEq, Eq)]
struct PhaseKey {
    turn: u32,
    phase: String,
    priority_player: u32,
}

#[derive(Clone)]
struct ComparePhaseRow {
    key: PhaseKey,
    rust_index: Option<usize>,
    java_index: Option<usize>,
}

#[derive(Clone)]
struct CompareSelectionAnchor {
    key: PhaseKey,
    rust_index: Option<usize>,
    java_index: Option<usize>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum TraceMode {
    Rust,
    Java,
    Compare,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum TracePaneKind {
    Rust,
    Java,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ToolbarPopover {
    RunConfig,
    Java,
}

impl TraceMode {
    fn label(self) -> &'static str {
        match self {
            TraceMode::Rust => "Rust",
            TraceMode::Java => "Java",
            TraceMode::Compare => "Side by side",
        }
    }
}

impl TracePaneKind {
    fn label(self) -> &'static str {
        match self {
            TracePaneKind::Rust => "rust",
            TracePaneKind::Java => "java",
        }
    }
}

#[derive(Clone)]
pub(crate) struct InspectedCard {
    pub(crate) name: String,
    pub(crate) raw: String,
}

#[derive(Clone)]
struct TracePreset {
    name: String,
    deck1: String,
    deck2: String,
    seed: u64,
    max_turns: u32,
    games: u32,
    variant: String,
    commanders: Vec<String>,
}

#[derive(Deserialize)]
struct RegressionEntry {
    name: String,
    args: String,
}

impl Default for App {
    fn default() -> Self {
        let archive_path = PathBuf::from(DEFAULT_ARCHIVE_PATH);
        let (archive, archive_error) = match ArchiveState::open(&archive_path) {
            Ok(state) => (Some(state), None),
            Err(err) => (None, Some(err)),
        };
        let trace_presets = load_trace_presets();
        let selected_trace_preset = 0;
        let initial_preset = trace_presets
            .get(selected_trace_preset)
            .cloned()
            .unwrap_or_else(sample_trace_preset);
        let mut app = Self {
            source: SAMPLE.to_string(),
            current_path: None,
            load_error: None,
            archive,
            archive_path,
            archive_error,
            search_query: String::new(),
            trace: None,
            trace_error: None,
            trace_worker: None,
            trace_running: false,
            trace_collecting_context: false,
            trace_halted_on_divergence: false,
            trace_status: None,
            trace_debug_log: VecDeque::new(),
            trace_reveal_ms: 40,
            selected_card: None,
            trace_follow_live: true,
            trace_panel_height: 470.0,
            summary_panel_height: 180.0,
            right_snapshot_panel_height: 360.0,
            right_events_panel_height: 280.0,
            ast_view_mode: AstViewMode::Graph,
            trace_mode: TraceMode::Rust,
            active_trace_pane: TracePaneKind::Rust,
            java_jar_path: discover_java_jar(None)
                .unwrap_or_else(|| repo_relative_path(DEFAULT_JAVA_JAR_PATH)),
            java_harness_building: false,
            trace_presets,
            selected_trace_preset,
            trace_deck1_input: initial_preset.deck1,
            trace_deck2_input: initial_preset.deck2,
            trace_seed_input: initial_preset.seed,
            trace_max_turns_input: initial_preset.max_turns,
            trace_games_input: initial_preset.games,
            trace_game_index_input: 1,
            trace_prefer_actions: false,
            trace_deep: true,
            trace_loose_parity: true,
            trace_variant: initial_preset.variant,
            trace_commanders: initial_preset.commanders,
            deck_modal_open: false,
            deck_modal_query: String::new(),
            toolbar_popover: Some(ToolbarPopover::RunConfig),
            toolbar_popover_just_opened: true,
            compare_debug_state: None,
        };
        app.ensure_trace_worker();
        if let Some(worker) = &app.trace_worker {
            let _ = worker.command_tx.send(TraceWorkerCommand::Preload);
            app.trace_status = Some("Preloading card database…".to_string());
        }
        app.prewarm_java_server();
        app
    }
}

impl App {
    fn push_trace_debug(&mut self, message: impl Into<String>) {
        let message = message.into();
        if self.trace_debug_log.len() >= 64 {
            self.trace_debug_log.pop_front();
        }
        self.trace_debug_log.push_back(message);
    }

    fn prewarm_java_server(&mut self) {
        let Some(path) = discover_java_jar(Some(&self.java_jar_path)) else {
            return;
        };
        self.java_jar_path = path.clone();
        self.ensure_trace_worker();
        if let Some(worker) = &self.trace_worker {
            let _ = worker
                .command_tx
                .send(TraceWorkerCommand::PrewarmJava(path));
        }
    }

    fn snapshot_counts(&self) -> (usize, usize) {
        let rust = self
            .trace
            .as_ref()
            .and_then(|trace| trace.rust.as_ref())
            .map_or(0, |pane| pane.snapshots.len());
        let java = self
            .trace
            .as_ref()
            .and_then(|trace| trace.java.as_ref())
            .map_or(0, |pane| pane.snapshots.len());
        (rust, java)
    }

    fn trace_frame_counter_text(&self) -> String {
        let Some(trace) = self.trace.as_ref() else {
            return "frame #0 / 0".to_string();
        };
        let pane = match self.trace_mode {
            TraceMode::Java => trace.java.as_ref(),
            _ => trace
                .pane(self.active_trace_pane)
                .or_else(|| trace.rust.as_ref())
                .or_else(|| trace.java.as_ref()),
        };
        let Some(pane) = pane else {
            return "frame #0 / 0".to_string();
        };
        let total = pane.snapshots.len();
        let current = if total == 0 {
            0
        } else {
            pane.selected_snapshot.saturating_add(1)
        };
        format!("frame #{current} / {total}")
    }

    fn selected_snapshot_summary(&self) -> Option<String> {
        let trace = self.trace.as_ref()?;
        let pane = match self.trace_mode {
            TraceMode::Java => trace.java.as_ref()?,
            _ => trace
                .pane(self.active_trace_pane)
                .or_else(|| trace.rust.as_ref())
                .or_else(|| trace.java.as_ref())?,
        };
        let snapshot = pane.snapshots.get(pane.selected_snapshot)?;
        Some(format!(
            "Turn {} · {} · active P{} · priority P{}",
            snapshot.turn, snapshot.phase, snapshot.active_player, snapshot.priority_player
        ))
    }

    fn active_trace_pane_ref(&self) -> Option<&TracePaneState> {
        let trace = self.trace.as_ref()?;
        match self.trace_mode {
            TraceMode::Java => trace.java.as_ref(),
            TraceMode::Compare => trace.rust.as_ref().or(trace.java.as_ref()),
            TraceMode::Rust => trace.rust.as_ref(),
        }
    }

    fn active_trace_pane_mut(&mut self) -> Option<&mut TracePaneState> {
        let trace = self.trace.as_mut()?;
        match self.trace_mode {
            TraceMode::Java => trace.java.as_mut(),
            TraceMode::Compare => trace.rust.as_mut().or(trace.java.as_mut()),
            TraceMode::Rust => trace.rust.as_mut(),
        }
    }

    fn apply_trace_preset(&mut self, preset_index: usize) {
        let Some(preset) = self.trace_presets.get(preset_index).cloned() else {
            return;
        };
        self.selected_trace_preset = preset_index;
        self.trace_deck1_input = preset.deck1;
        self.trace_deck2_input = preset.deck2;
        self.trace_seed_input = preset.seed;
        self.trace_max_turns_input = preset.max_turns;
        self.trace_games_input = preset.games.max(1);
        self.trace_game_index_input = 1;
        self.trace_variant = preset.variant;
        self.trace_commanders = preset.commanders;
    }

    fn current_run_config(&self) -> RunConfig {
        let game_offset = self.trace_game_offset();
        RunConfig {
            deck1: self.trace_deck1_input.trim().to_string(),
            deck2: self.trace_deck2_input.trim().to_string(),
            seed: self.trace_seed_input.saturating_add(game_offset),
            max_turns: self.trace_max_turns_input,
            cards_dir: None,
            decks_dir: None,
            verbose: VerboseMode::Off,
            prefer_actions: self.trace_prefer_actions,
            deep: self.trace_deep,
            loose_parity: self.trace_loose_parity,
            log_snapshots: false,
            java_heap: "2g".to_string(),
            variant: self.trace_variant.clone(),
            commanders: self.trace_commanders.clone(),
            full_log: false,
            live_log: None,
        }
    }

    fn current_cli_command(&self) -> String {
        let config = self.current_run_config();
        let mut args = vec![
            "cargo run -p forge-parity --bin forge-parity --".to_string(),
            format!("--deck1 {}", shell_quote(&config.deck1)),
            format!("--deck2 {}", shell_quote(&config.deck2)),
            format!("--seed {}", config.seed),
            format!("--max-turns {}", config.max_turns),
            "--games 1".to_string(),
        ];
        if config.prefer_actions {
            args.push("--prefer-actions".to_string());
        }
        if config.deep {
            args.push("--deep".to_string());
        }
        if config.loose_parity {
            args.push("--loose-parity".to_string());
        }
        if config.variant != "Constructed" {
            args.push(format!("--variant {}", shell_quote(&config.variant)));
        }
        for commander in &config.commanders {
            args.push(format!("--commander {}", shell_quote(commander)));
        }
        if matches!(self.trace_mode, TraceMode::Java | TraceMode::Compare) {
            args.push(format!(
                "--java-jar {}",
                shell_quote(&self.java_jar_path.display().to_string())
            ));
        }
        args.join(" ")
    }

    fn trace_game_offset(&self) -> u64 {
        self.trace_game_index_input
            .saturating_sub(1)
            .min(self.trace_games_input.saturating_sub(1)) as u64
    }

    fn ensure_trace_worker(&mut self) {
        if self.trace_worker.is_some() {
            return;
        }
        match worker::spawn() {
            Ok(handle) => self.trace_worker = Some(handle),
            Err(err) => {
                self.trace_error = Some(format!("failed to spawn trace worker: {err}"));
            }
        }
    }

    fn load_archive(&mut self, path: PathBuf) {
        match ArchiveState::open(&path) {
            Ok(state) => {
                self.archive = Some(state);
                self.archive_path = path;
                self.archive_error = None;
            }
            Err(err) => {
                self.archive = None;
                self.archive_path = path;
                self.archive_error = Some(err);
            }
        }
    }

    fn run_sample_trace(&mut self) {
        if self.trace_running || self.trace_collecting_context || self.java_harness_building {
            return;
        }
        self.toolbar_popover = None;
        self.toolbar_popover_just_opened = false;
        self.ensure_trace_worker();
        let java_jar_path = if matches!(self.trace_mode, TraceMode::Java | TraceMode::Compare) {
            match discover_java_jar(Some(&self.java_jar_path)) {
                Some(path) => {
                    self.java_jar_path = path.clone();
                    path
                }
                None => {
                    self.trace_error = Some(
                        "Java harness not found. Use Build Java harness or Open Java JAR…"
                            .to_string(),
                    );
                    self.trace_status = None;
                    return;
                }
            }
        } else {
            self.java_jar_path.clone()
        };

        self.trace_running = true;
        self.trace_collecting_context = false;
        self.trace_halted_on_divergence = false;
        self.trace_error = None;
        self.trace_status = Some("Queueing trace…".to_string());
        self.trace_debug_log.clear();
        self.push_trace_debug(format!("run start: mode={}", self.trace_mode.label()));
        self.trace_follow_live = true;
        self.active_trace_pane = match self.trace_mode {
            TraceMode::Java => TracePaneKind::Java,
            _ => TracePaneKind::Rust,
        };
        let config = self.current_run_config();
        if config.deck1.is_empty() || config.deck2.is_empty() {
            self.trace_running = false;
            self.trace_error = Some("Deck 1 and Deck 2 must both be set.".to_string());
            self.trace_status = None;
            return;
        }
        self.trace = Some(TraceSession::new(self.trace_mode, &config));
        let request = TraceRunRequest {
            mode: self.trace_mode,
            config,
            java_jar_path,
        };
        let Some(worker) = &self.trace_worker else {
            return;
        };
        if let Err(err) = worker
            .command_tx
            .send(TraceWorkerCommand::RunTrace(request))
        {
            self.trace_running = false;
            self.trace_error = Some(format!("failed to start trace worker: {err}"));
            self.trace_status = None;
        }
    }

    fn restart_trace(&mut self) {
        if !self.trace_running && !self.trace_collecting_context {
            self.run_sample_trace();
        }
    }

    fn continue_trace(&mut self) {
        if !self.trace_running && !self.trace_collecting_context {
            self.run_sample_trace();
            return;
        }
        self.trace_follow_live = true;
        if let Some(trace) = self.trace.as_mut() {
            if matches!(self.trace_mode, TraceMode::Compare) {
                let rows =
                    compare_rows_for_display(trace, &trace.compare_rows(), self.trace_follow_live);
                if let Some(row_index) = latest_follow_compare_row_index(&rows) {
                    set_compare_row_selection(trace, &rows, row_index);
                }
            } else {
                if let Some(rust) = trace.rust.as_mut() {
                    if !rust.snapshots.is_empty() {
                        rust.selected_snapshot = rust.snapshots.len().saturating_sub(1);
                        rust.pending_timeline_scroll = true;
                    }
                }
                if let Some(java) = trace.java.as_mut() {
                    if !java.snapshots.is_empty() {
                        java.selected_snapshot = java.snapshots.len().saturating_sub(1);
                        java.pending_timeline_scroll = true;
                    }
                }
            }
        }
    }

    fn abort_trace(&mut self) {
        if !self.trace_running && !self.trace_collecting_context {
            return;
        }
        if let Some(worker) = &self.trace_worker {
            let _ = worker.command_tx.send(TraceWorkerCommand::Abort);
        }
        self.trace_running = false;
        self.trace_collecting_context = false;
        self.trace_halted_on_divergence = false;
        self.trace_follow_live = false;
        self.trace_error = None;
        self.trace_status = Some("Trace aborted".to_string());
        self.trace_worker = None;
        self.ensure_trace_worker();
        if let Some(worker) = &self.trace_worker {
            let _ = worker.command_tx.send(TraceWorkerCommand::Preload);
            if let Some(path) = discover_java_jar(Some(&self.java_jar_path)) {
                self.java_jar_path = path.clone();
                let _ = worker
                    .command_tx
                    .send(TraceWorkerCommand::PrewarmJava(path));
            }
        }
    }

    fn step_trace(&mut self, delta: isize) {
        let Some(trace) = self.trace.as_mut() else {
            return;
        };
        if matches!(self.trace_mode, TraceMode::Compare) {
            let rows =
                compare_rows_for_display(trace, &trace.compare_rows(), self.trace_follow_live);
            if rows.is_empty() {
                return;
            }
            let current = selected_compare_row_index(trace, &rows);
            let target = current
                .saturating_add_signed(delta)
                .clamp(0, rows.len().saturating_sub(1));
            jump_to_compare_row(trace, &rows, target, &mut self.trace_follow_live);
            return;
        }
        let pane_kind = match self.trace_mode {
            TraceMode::Java => TracePaneKind::Java,
            _ => self.active_trace_pane,
        };
        let Some(pane) = trace.pane(pane_kind) else {
            return;
        };
        if pane.snapshots.is_empty() {
            return;
        }
        let rows = unique_phase_rows(&pane.snapshots);
        if rows.is_empty() {
            return;
        }
        let current = rows
            .iter()
            .position(|(key, _)| {
                pane.snapshots
                    .get(pane.selected_snapshot)
                    .map(snapshot_phase_key)
                    .as_ref()
                    == Some(key)
            })
            .unwrap_or_else(|| rows.len().saturating_sub(1));
        let target_row = current
            .saturating_add_signed(delta)
            .clamp(0, rows.len().saturating_sub(1));
        let target = rows[target_row].1;
        jump_to_snapshot(
            trace,
            self.trace_mode,
            pane_kind,
            target,
            &mut self.trace_follow_live,
        );
    }

    fn promote_pending_compare_if_ready(&mut self) {
        if !matches!(self.trace_mode, TraceMode::Compare) {
            return;
        }
        let Some(trace) = self.trace.as_mut() else {
            return;
        };
        if !pending_divergence_ready(trace) {
            return;
        }
        let Some(comparison) = trace.pending_comparison.take() else {
            return;
        };
        let rows = compare_rows_for_display(trace, &trace.compare_rows(), false);
        self.compare_debug_state = Some(format!(
            "promote pending: selected={} divergence={}",
            selected_compare_row_index(trace, &rows),
            divergence_row_index(trace, &rows, &comparison).unwrap_or(usize::MAX)
        ));
        let divergence_status = comparison.first_divergence.as_ref().map(|divergence| {
            format!(
                "Divergence at T{} {} {} — capturing context…",
                divergence.turn, divergence.phase, divergence.field
            )
        });
        self.trace_collecting_context = true;
        self.trace_follow_live = false;
        trace.comparison = Some(comparison);
        if let Some(comparison) = trace.comparison.as_ref() {
            if let Some(row_index) = divergence_row_index(trace, &rows, comparison) {
                set_compare_row_selection(trace, &rows, row_index);
            }
        }
        if let Some(status) = divergence_status {
            self.trace_status = Some(status);
        }
    }

    fn poll_trace_task(&mut self) {
        if self.trace_worker.is_none() {
            return;
        }
        let mut should_prewarm_java = false;
        loop {
            let event = {
                let worker = self.trace_worker.as_ref().expect("checked above");
                worker.event_rx.try_recv()
            };
            let mut debug_messages = Vec::new();
            match event {
                Ok(TraceWorkerEvent::Status(status)) => {
                    self.trace_status = Some(status);
                }
                Ok(TraceWorkerEvent::Debug(message)) => {
                    debug_messages.push(message);
                }
                Ok(TraceWorkerEvent::Entry { pane, entry }) => {
                    if self.trace_halted_on_divergence {
                        continue;
                    }
                    if let Some(trace) = self.trace.as_mut() {
                        trace.pane_mut(pane).push_entry(entry);
                    }
                }
                Ok(TraceWorkerEvent::CompareUpdate(result)) => {
                    debug_messages.push(format!(
                        "compare update: status={:?} snapshots={} divergence={}",
                        result.status,
                        result.snapshots_compared,
                        result
                            .first_divergence
                            .as_ref()
                            .map(|d| format!("T{} {} {}", d.turn, d.phase, d.field))
                            .unwrap_or_else(|| "none".to_string())
                    ));
                    if let Some(trace) = self.trace.as_mut() {
                        let pending_fail = matches!(self.trace_mode, TraceMode::Compare)
                            && self.trace_follow_live
                            && result.first_divergence.is_some();
                        if pending_fail {
                            debug_messages.push(
                                "compare update: queued until visible timeline catches up"
                                    .to_string(),
                            );
                            trace.set_pending_comparison_result(Some(result));
                        } else {
                            trace.set_comparison_result(Some(result));
                            trace.pending_comparison = None;
                        }
                    }
                }
                Ok(TraceWorkerEvent::Finished(Ok(finished))) => {
                    if self.trace_halted_on_divergence {
                        self.trace_running = false;
                        self.trace_collecting_context = false;
                        continue;
                    }
                    if let Some(trace) = self.trace.as_mut() {
                        let preserve_visible_compare =
                            matches!(self.trace_mode, TraceMode::Compare)
                                && (trace.pending_comparison.is_some()
                                    || self.trace_collecting_context);
                        if let Some(game) = finished.rust {
                            if let Some(pane) = trace.rust.as_mut() {
                                pane.finalize(game, !preserve_visible_compare);
                            }
                        }
                        if let Some(java) = finished.java {
                            if let Some(pane) = trace.java.as_mut() {
                                pane.finalize_java(java, !preserve_visible_compare);
                            }
                        }
                        if matches!(self.trace_mode, TraceMode::Compare)
                            && self.trace_follow_live
                            && finished
                                .compare_result
                                .as_ref()
                                .is_some_and(|result| result.first_divergence.is_some())
                        {
                            trace.set_pending_comparison_result(finished.compare_result);
                        } else {
                            trace.set_comparison_result(finished.compare_result);
                            trace.pending_comparison = None;
                        }
                        debug_messages.push("finished event received".to_string());
                        if matches!(self.trace_mode, TraceMode::Compare) && self.trace_follow_live {
                            if let Some(comparison) = trace.comparison.as_ref() {
                                if !comparison.passed() {
                                    debug_messages
                                        .push("finished event: stopping live follow".to_string());
                                    let rows = compare_rows_for_display(
                                        trace,
                                        &trace.compare_rows(),
                                        false,
                                    );
                                    if let Some(row_index) =
                                        divergence_row_index(trace, &rows, comparison)
                                    {
                                        self.trace_follow_live = false;
                                        set_compare_row_selection(trace, &rows, row_index);
                                    }
                                }
                            }
                        }
                    }
                    self.trace_error = None;
                    self.trace_running = false;
                    self.trace_collecting_context = false;
                    if self
                        .trace
                        .as_ref()
                        .and_then(|trace| trace.comparison.as_ref())
                        .is_some_and(|comparison| !comparison.passed())
                    {
                        self.trace_status = Some("Divergence context captured".to_string());
                    } else {
                        self.trace_status = Some("Trace complete".to_string());
                    }
                }
                Ok(TraceWorkerEvent::Finished(Err(err))) => {
                    self.trace_halted_on_divergence = false;
                    self.trace = None;
                    self.trace_error = Some(err);
                    self.trace_running = false;
                    self.trace_collecting_context = false;
                    self.trace_status = None;
                }
                Ok(TraceWorkerEvent::Preloaded(Ok(()))) => {
                    if !self.trace_running {
                        self.trace_status = Some("Card database ready".to_string());
                    }
                }
                Ok(TraceWorkerEvent::Preloaded(Err(err))) => {
                    if !self.trace_running {
                        self.trace_error = Some(err);
                        self.trace_status = None;
                    }
                }
                Ok(TraceWorkerEvent::JavaPrewarmed(Ok(()))) => {
                    if !self.trace_running && !self.java_harness_building {
                        self.trace_status = Some("Java server ready".to_string());
                    }
                }
                Ok(TraceWorkerEvent::JavaPrewarmed(Err(err))) => {
                    if !self.trace_running && !self.java_harness_building {
                        self.trace_error = Some(err);
                        self.trace_status = None;
                    }
                }
                Ok(TraceWorkerEvent::JavaHarnessBuilt(Ok(path))) => {
                    self.java_jar_path = path;
                    self.java_harness_building = false;
                    self.trace_error = None;
                    self.trace_status = Some("Java harness ready".to_string());
                    should_prewarm_java = true;
                }
                Ok(TraceWorkerEvent::JavaHarnessBuilt(Err(err))) => {
                    self.java_harness_building = false;
                    self.trace_error = Some(err);
                    self.trace_status = None;
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    self.trace_halted_on_divergence = false;
                    self.trace = None;
                    self.trace_error = Some("trace worker disconnected".to_string());
                    self.trace_running = false;
                    self.trace_collecting_context = false;
                    self.java_harness_building = false;
                    self.trace_status = None;
                    break;
                }
            }
            for message in debug_messages {
                self.push_trace_debug(message);
            }
        }
        if should_prewarm_java {
            self.prewarm_java_server();
        }
    }

    fn build_java_harness(&mut self) {
        if self.trace_running || self.java_harness_building {
            return;
        }
        self.ensure_trace_worker();
        let Some(worker) = &self.trace_worker else {
            return;
        };
        self.java_harness_building = true;
        self.trace_error = None;
        self.trace_status = Some("Building Java harness…".to_string());
        if let Err(err) = worker.command_tx.send(TraceWorkerCommand::BuildJavaHarness) {
            self.java_harness_building = false;
            self.trace_error = Some(format!("failed to start harness build: {err}"));
            self.trace_status = None;
        }
    }

    fn inspected_title(&self) -> String {
        if let Some(card) = self.selected_card.as_ref() {
            format!("Source: {}", card.name)
        } else {
            "Source".to_string()
        }
    }

    fn select_card(&mut self, card: InspectedCard) {
        self.source = card.raw.clone();
        self.current_path = None;
        self.load_error = None;
        self.selected_card = Some(card);
        self.trace_follow_live = false;
    }

    fn handle_keyboard_navigation(&mut self, ctx: &egui::Context) {
        if ctx.wants_keyboard_input() {
            return;
        }

        let mut clear_inspect = false;
        let mut abort_trace = false;
        let mut timeline_delta: isize = 0;
        let mut select_first = false;
        let mut select_last = false;
        let mut run_trace = false;

        ctx.input(|input| {
            if input.key_pressed(egui::Key::Escape) {
                if self.trace_running || self.trace_collecting_context {
                    abort_trace = true;
                } else {
                    clear_inspect = true;
                }
            }
            if input.key_pressed(egui::Key::ArrowUp) || input.key_pressed(egui::Key::K) {
                timeline_delta -= 1;
            }
            if input.key_pressed(egui::Key::ArrowDown) || input.key_pressed(egui::Key::J) {
                timeline_delta += 1;
            }
            if input.key_pressed(egui::Key::Home) {
                select_first = true;
            }
            if input.key_pressed(egui::Key::End) {
                select_last = true;
            }
            if input.key_pressed(egui::Key::R)
                && !self.trace_running
                && !self.trace_collecting_context
            {
                run_trace = true;
            }
        });

        if clear_inspect {
            self.selected_card = None;
        }
        if abort_trace {
            self.abort_trace();
        }
        if run_trace {
            self.run_sample_trace();
        }

        let Some(trace) = self.trace.as_mut() else {
            return;
        };
        let pane_kind = match self.trace_mode {
            TraceMode::Java => TracePaneKind::Java,
            _ => self.active_trace_pane,
        };
        let Some(active_len) = trace.pane(pane_kind).map(|pane| pane.snapshots.len()) else {
            return;
        };
        if active_len == 0 {
            return;
        }

        if select_first {
            match self.trace_mode {
                TraceMode::Compare => {
                    let rows = compare_rows_for_display(
                        trace,
                        &trace.compare_rows(),
                        self.trace_follow_live,
                    );
                    if !rows.is_empty() {
                        jump_to_compare_row(trace, &rows, 0, &mut self.trace_follow_live);
                    }
                }
                TraceMode::Rust | TraceMode::Java => {
                    if let Some(pane) = trace.pane(pane_kind) {
                        let rows = unique_phase_rows(&pane.snapshots);
                        if let Some((_, snapshot_index)) = rows.first() {
                            jump_to_snapshot(
                                trace,
                                self.trace_mode,
                                pane_kind,
                                *snapshot_index,
                                &mut self.trace_follow_live,
                            );
                        }
                    }
                }
            }
            return;
        }
        if select_last {
            match self.trace_mode {
                TraceMode::Compare => {
                    let rows = compare_rows_for_display(
                        trace,
                        &trace.compare_rows(),
                        self.trace_follow_live,
                    );
                    if !rows.is_empty() {
                        jump_to_compare_row(
                            trace,
                            &rows,
                            rows.len().saturating_sub(1),
                            &mut self.trace_follow_live,
                        );
                    }
                }
                TraceMode::Rust | TraceMode::Java => {
                    if let Some(pane) = trace.pane(pane_kind) {
                        let rows = unique_phase_rows(&pane.snapshots);
                        if let Some((_, snapshot_index)) = rows.last() {
                            jump_to_snapshot(
                                trace,
                                self.trace_mode,
                                pane_kind,
                                *snapshot_index,
                                &mut self.trace_follow_live,
                            );
                        }
                    }
                }
            }
            return;
        }
        if timeline_delta != 0 {
            match self.trace_mode {
                TraceMode::Compare => {
                    let rows = compare_rows_for_display(
                        trace,
                        &trace.compare_rows(),
                        self.trace_follow_live,
                    );
                    if !rows.is_empty() {
                        let current = selected_compare_row_index(trace, &rows);
                        let target = current
                            .saturating_add_signed(timeline_delta)
                            .clamp(0, rows.len().saturating_sub(1));
                        jump_to_compare_row(trace, &rows, target, &mut self.trace_follow_live);
                    }
                }
                TraceMode::Rust | TraceMode::Java => {
                    if let Some(pane) = trace.pane(pane_kind) {
                        let rows = unique_phase_rows(&pane.snapshots);
                        if !rows.is_empty() {
                            let current = selected_phase_row_index(pane, &rows);
                            let target = current
                                .saturating_add_signed(timeline_delta)
                                .clamp(0, rows.len().saturating_sub(1));
                            jump_to_snapshot(
                                trace,
                                self.trace_mode,
                                pane_kind,
                                rows[target].1,
                                &mut self.trace_follow_live,
                            );
                        }
                    }
                }
            }
        }
    }

    fn current_frame_counts(&self) -> (usize, usize) {
        let Some(trace) = self.trace.as_ref() else {
            return (0, 0);
        };
        let pane = match self.trace_mode {
            TraceMode::Java => trace.java.as_ref(),
            _ => trace
                .pane(self.active_trace_pane)
                .or_else(|| trace.rust.as_ref())
                .or_else(|| trace.java.as_ref()),
        };
        let Some(pane) = pane else {
            return (0, 0);
        };
        let total = pane.snapshots.len();
        let current = if total == 0 {
            0
        } else {
            pane.selected_snapshot.saturating_add(1)
        };
        (current, total)
    }

    fn current_event_descriptor(&self) -> (String, String) {
        let Some(trace) = self.trace.as_ref() else {
            return (
                "Run a trace".to_string(),
                "pick a matchup and inspect frames".to_string(),
            );
        };
        let pane = match self.trace_mode {
            TraceMode::Java => trace.java.as_ref(),
            _ => trace
                .pane(self.active_trace_pane)
                .or_else(|| trace.rust.as_ref())
                .or_else(|| trace.java.as_ref()),
        };
        let Some(pane) = pane else {
            return ("Trace idle".to_string(), "no active pane".to_string());
        };
        let Some(snapshot) = pane.snapshots.get(pane.selected_snapshot) else {
            return ("Trace idle".to_string(), "no snapshots".to_string());
        };
        let label = pane
            .log_entries
            .iter()
            .filter_map(ParityLogEntry::as_callback)
            .find(|callback| callback.turn == snapshot.turn && callback.phase == snapshot.phase)
            .map(|callback| callback.name.clone())
            .unwrap_or_else(|| snapshot.phase.clone());
        let meta = format!(
            "turn {} · active p{} · priority p{} · stack {}",
            snapshot.turn,
            snapshot.active_player,
            snapshot.priority_player,
            snapshot.stack.len()
        );
        (shorten_list(&label, 18), shorten_list(&meta, 28))
    }
}

fn available_deck_names(app: &App) -> Vec<String> {
    let mut names = vec![app.trace_deck1_input.clone(), app.trace_deck2_input.clone()];
    for preset in &app.trace_presets {
        names.push(preset.deck1.clone());
        names.push(preset.deck2.clone());
    }
    names.sort();
    names.dedup();
    names.retain(|name| !name.trim().is_empty());
    names
}

impl TraceSession {
    fn new(mode: TraceMode, config: &RunConfig) -> Self {
        Self {
            mode,
            deck1: config.deck1.clone(),
            deck2: config.deck2.clone(),
            seed: config.seed,
            max_turns: config.max_turns,
            loose_parity: config.loose_parity,
            rust: matches!(mode, TraceMode::Rust | TraceMode::Compare)
                .then(|| TracePaneState::new(config)),
            java: matches!(mode, TraceMode::Java | TraceMode::Compare)
                .then(|| TracePaneState::new(config)),
            comparison: None,
            pending_comparison: None,
            compare_selected_row: 0,
            compare_selected_anchor: None,
            compare_visible_row_count: 0,
            compare_display_rows: Vec::new(),
            compare_live_rows: RefCell::new(Vec::new()),
            compare_live_counts: Cell::new((0, 0)),
            compare_rows_cache: RefCell::new(Vec::new()),
            compare_rows_cache_versions: Cell::new((u64::MAX, u64::MAX)),
        }
    }

    fn pane_mut(&mut self, pane: TracePaneKind) -> &mut TracePaneState {
        match pane {
            TracePaneKind::Rust => self.rust.as_mut().expect("rust pane missing"),
            TracePaneKind::Java => self.java.as_mut().expect("java pane missing"),
        }
    }

    fn pane(&self, pane: TracePaneKind) -> Option<&TracePaneState> {
        match pane {
            TracePaneKind::Rust => self.rust.as_ref(),
            TracePaneKind::Java => self.java.as_ref(),
        }
    }

    fn set_comparison_result(&mut self, result: Option<MatchupResult>) {
        self.comparison = result.map(TraceComparison::from_matchup_result);
    }

    fn set_pending_comparison_result(&mut self, result: Option<MatchupResult>) {
        self.pending_comparison = result.map(TraceComparison::from_matchup_result);
    }

    fn compare_rows(&self) -> Vec<ComparePhaseRow> {
        let rust_rows = self
            .rust
            .as_ref()
            .map(|pane| unique_phase_rows(&pane.snapshots))
            .unwrap_or_default();
        let java_rows = self
            .java
            .as_ref()
            .map(|pane| unique_phase_rows(&pane.snapshots))
            .unwrap_or_default();
        let (prev_rust_count, prev_java_count) = self.compare_live_counts.get();
        if rust_rows.len() < prev_rust_count || java_rows.len() < prev_java_count {
            self.compare_live_rows.borrow_mut().clear();
            self.compare_live_counts.set((0, 0));
        }
        {
            let mut rows = self.compare_live_rows.borrow_mut();
            let (mut rust_count, mut java_count) = self.compare_live_counts.get();
            for (key, idx) in rust_rows.iter().skip(rust_count) {
                append_compare_live_row(&mut rows, key.clone(), Some(*idx), None);
                rust_count += 1;
            }
            for (key, idx) in java_rows.iter().skip(java_count) {
                append_compare_live_row(&mut rows, key.clone(), None, Some(*idx));
                java_count += 1;
            }
            self.compare_live_counts.set((rust_count, java_count));
        }
        self.compare_live_rows.borrow().clone()
    }

    fn compare_rows_lcs(&self) -> Vec<ComparePhaseRow> {
        let versions = (
            self.rust.as_ref().map_or(0, |pane| pane.snapshot_version),
            self.java.as_ref().map_or(0, |pane| pane.snapshot_version),
        );
        if self.compare_rows_cache_versions.get() != versions {
            *self.compare_rows_cache.borrow_mut() = build_compare_phase_rows_uncached(self);
            self.compare_rows_cache_versions.set(versions);
        }
        self.compare_rows_cache.borrow().clone()
    }

    fn compare_display_row_matches(source: &ComparePhaseRow, displayed: &ComparePhaseRow) -> bool {
        source.key == displayed.key
            && source.rust_index == displayed.rust_index
            && source.java_index == displayed.java_index
    }

    fn append_next_compare_display_row(
        &mut self,
        follow_live: bool,
        collecting_context: bool,
    ) -> bool {
        let rows = self.compare_rows();
        let start = self
            .compare_display_rows
            .last()
            .and_then(|last| {
                rows.iter()
                    .position(|row| Self::compare_display_row_matches(row, last))
                    .map(|idx| idx.saturating_add(1))
            })
            .unwrap_or(0);
        let divergence_turn = self
            .comparison
            .as_ref()
            .and_then(|comparison| comparison.first_divergence.as_ref())
            .map(|divergence| divergence.turn);
        for row in rows.into_iter().skip(start) {
            let shared = row.rust_index.is_some() && row.java_index.is_some();
            let include = if collecting_context {
                shared && divergence_turn.is_some_and(|turn| row.key.turn <= turn)
            } else if follow_live || self.pending_comparison.is_some() {
                shared
            } else {
                false
            };
            if !include {
                continue;
            }
            self.compare_display_rows.push(row.clone());
            self.compare_visible_row_count = self.compare_display_rows.len();
            if follow_live {
                self.compare_selected_row = self.compare_display_rows.len().saturating_sub(1);
                self.compare_selected_anchor = Some(CompareSelectionAnchor {
                    key: row.key.clone(),
                    rust_index: row.rust_index,
                    java_index: row.java_index,
                });
                if let Some(rust) = self.rust.as_mut() {
                    if let Some(idx) = row.rust_index {
                        rust.selected_snapshot = idx.min(rust.snapshots.len().saturating_sub(1));
                    }
                    rust.pending_timeline_scroll = true;
                }
                if let Some(java) = self.java.as_mut() {
                    if let Some(idx) = row.java_index {
                        java.selected_snapshot = idx.min(java.snapshots.len().saturating_sub(1));
                    }
                    java.pending_timeline_scroll = true;
                }
            }
            return true;
        }
        false
    }

    fn reveal_all_pending(&mut self) {
        if let Some(rust) = self.rust.as_mut() {
            rust.reveal_all_pending();
        }
        if let Some(java) = self.java.as_mut() {
            java.reveal_all_pending();
        }
    }
}

impl TracePaneState {
    fn new(config: &RunConfig) -> Self {
        Self {
            deck1: config.deck1.clone(),
            deck2: config.deck2.clone(),
            seed: config.seed,
            max_turns: config.max_turns,
            log_entries: Vec::new(),
            snapshots: Vec::new(),
            selected_snapshot: 0,
            final_game: None,
            pending_entries: VecDeque::new(),
            last_reveal_at: Instant::now(),
            pending_timeline_scroll: true,
            snapshot_version: 0,
            stream_complete: false,
        }
    }

    fn push_entry(&mut self, entry: ParityLogEntry) {
        self.pending_entries.push_back(entry);
    }

    fn reveal_pending(&mut self, interval: Duration, follow_live: bool) -> bool {
        if self.pending_entries.is_empty() {
            return false;
        }
        let now = Instant::now();
        if now.duration_since(self.last_reveal_at) < interval {
            return false;
        }
        self.last_reveal_at = now;
        let Some(entry) = self.pending_entries.pop_front() else {
            return false;
        };
        let mut revealed_snapshot = false;
        if let ParityLogEntry::Snapshot(snapshot) = &entry {
            self.snapshots.push(snapshot.clone());
            self.snapshot_version = self.snapshot_version.wrapping_add(1);
            revealed_snapshot = true;
            if follow_live {
                self.selected_snapshot = self.snapshots.len().saturating_sub(1);
                self.pending_timeline_scroll = true;
            }
        }
        self.log_entries.push(entry);
        revealed_snapshot
    }

    fn reveal_all_pending(&mut self) {
        while let Some(entry) = self.pending_entries.pop_front() {
            if let ParityLogEntry::Snapshot(snapshot) = &entry {
                self.snapshots.push(snapshot.clone());
                self.snapshot_version = self.snapshot_version.wrapping_add(1);
            }
            self.log_entries.push(entry);
        }
        self.last_reveal_at = Instant::now();
    }

    fn finalize(&mut self, game: GameTrace, replace_visible: bool) {
        if replace_visible {
            self.log_entries = game.log.clone();
            self.snapshots = game.snapshot_vec();
            self.snapshot_version = self.snapshot_version.wrapping_add(1);
            self.pending_entries.clear();
        }
        self.final_game = Some(game);
        self.stream_complete = true;
    }

    fn finalize_java(&mut self, data: JavaMatchupData, replace_visible: bool) {
        if replace_visible {
            self.log_entries = data.log.clone();
            self.snapshots = data.snapshot_vec();
            self.snapshot_version = self.snapshot_version.wrapping_add(1);
            self.pending_entries.clear();
        }
        self.stream_complete = true;
    }

    fn decision_count(&self) -> usize {
        self.log_entries
            .iter()
            .filter(|entry| matches!(entry, ParityLogEntry::Decision(_)))
            .count()
    }

    fn callback_count(&self) -> usize {
        self.log_entries
            .iter()
            .filter(|entry| matches!(entry, ParityLogEntry::Callback(_)))
            .count()
    }
}

impl TraceComparison {
    fn from_matchup_result(result: MatchupResult) -> Self {
        let rust_snapshot = result.rust_snapshot;
        let java_snapshot = result.java_snapshot;
        let divergence_key = rust_snapshot
            .as_ref()
            .map(snapshot_phase_key)
            .or_else(|| java_snapshot.as_ref().map(snapshot_phase_key));
        let first_divergence = result.first_divergence;
        let per_snapshot = first_divergence.iter().cloned().collect();
        Self {
            snapshots_compared: result.snapshots_compared,
            first_divergence,
            per_snapshot,
            divergence_key,
            rust_snapshot,
            java_snapshot,
        }
    }

    fn divergence_for_snapshot(&self, snapshot_index: usize) -> Option<&Divergence> {
        self.per_snapshot
            .iter()
            .find(|divergence| divergence.snapshot_index == snapshot_index)
    }

    fn passed(&self) -> bool {
        self.first_divergence.is_none()
    }
}

impl CallbackKey {
    fn from_entry(entry: &ParityLogEntry) -> Option<Self> {
        if entry.as_snapshot().is_some() {
            return None;
        }
        Some(Self {
            turn: entry.turn(),
            phase: entry.phase().to_string(),
            player: entry.player(),
            name: entry.kind().to_string(),
        })
    }
}

fn snapshot_phase_key(snapshot: &StateSnapshot) -> PhaseKey {
    PhaseKey {
        turn: snapshot.turn,
        phase: snapshot.phase.clone(),
        priority_player: snapshot.priority_player,
    }
}

fn unique_phase_rows(snapshots: &[StateSnapshot]) -> Vec<(PhaseKey, usize)> {
    let mut rows = Vec::new();
    let mut last_key: Option<PhaseKey> = None;
    for (idx, snapshot) in snapshots.iter().enumerate() {
        let key = snapshot_phase_key(snapshot);
        if last_key.as_ref() != Some(&key) {
            rows.push((key.clone(), idx));
            last_key = Some(key);
        }
    }
    rows
}

fn build_compare_phase_rows_uncached(trace: &TraceSession) -> Vec<ComparePhaseRow> {
    let rust_rows = trace
        .rust
        .as_ref()
        .map(|pane| unique_phase_rows(&pane.snapshots))
        .unwrap_or_default();
    let java_rows = trace
        .java
        .as_ref()
        .map(|pane| unique_phase_rows(&pane.snapshots))
        .unwrap_or_default();
    let n = rust_rows.len();
    let m = java_rows.len();
    if n == 0 && m == 0 {
        return Vec::new();
    }

    let mut lcs = vec![0usize; (n + 1) * (m + 1)];
    let idx = |i: usize, j: usize| i * (m + 1) + j;
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            lcs[idx(i, j)] = if rust_rows[i].0 == java_rows[j].0 {
                lcs[idx(i + 1, j + 1)] + 1
            } else {
                lcs[idx(i + 1, j)].max(lcs[idx(i, j + 1)])
            };
        }
    }

    let mut rows = Vec::with_capacity(n.max(m));
    let mut ri = 0usize;
    let mut ji = 0usize;
    while ri < n && ji < m {
        let (rkey, ridx) = &rust_rows[ri];
        let (jkey, jidx) = &java_rows[ji];
        if rkey == jkey {
            rows.push(ComparePhaseRow {
                key: rkey.clone(),
                rust_index: Some(*ridx),
                java_index: Some(*jidx),
            });
            ri += 1;
            ji += 1;
        } else if lcs[idx(ri + 1, ji)] >= lcs[idx(ri, ji + 1)] {
            rows.push(ComparePhaseRow {
                key: rkey.clone(),
                rust_index: Some(*ridx),
                java_index: None,
            });
            ri += 1;
        } else {
            rows.push(ComparePhaseRow {
                key: jkey.clone(),
                rust_index: None,
                java_index: Some(*jidx),
            });
            ji += 1;
        }
    }
    while ri < n {
        let (rkey, ridx) = &rust_rows[ri];
        rows.push(ComparePhaseRow {
            key: rkey.clone(),
            rust_index: Some(*ridx),
            java_index: None,
        });
        ri += 1;
    }
    while ji < m {
        let (jkey, jidx) = &java_rows[ji];
        rows.push(ComparePhaseRow {
            key: jkey.clone(),
            rust_index: None,
            java_index: Some(*jidx),
        });
        ji += 1;
    }

    rows
}

fn selected_compare_row_index(trace: &TraceSession, rows: &[ComparePhaseRow]) -> usize {
    if let Some(anchor) = trace.compare_selected_anchor.as_ref() {
        if let Some(index) = rows.iter().position(|row| {
            row.rust_index == anchor.rust_index
                && row.java_index == anchor.java_index
                && row.rust_index.is_some() == anchor.rust_index.is_some()
                && row.java_index.is_some() == anchor.java_index.is_some()
        }) {
            return index;
        }
        if let Some(index) = rows.iter().position(|row| {
            row.rust_index.is_some() && row.rust_index == anchor.rust_index && row.key == anchor.key
        }) {
            return index;
        }
        if let Some(index) = rows.iter().position(|row| {
            row.java_index.is_some() && row.java_index == anchor.java_index && row.key == anchor.key
        }) {
            return index;
        }
        if let Some(index) = rows.iter().position(|row| row.key == anchor.key) {
            return index;
        }
    }
    trace.compare_selected_row.min(rows.len().saturating_sub(1))
}

fn selected_phase_row_index(trace: &TracePaneState, rows: &[(PhaseKey, usize)]) -> usize {
    if let Some(index) = rows
        .iter()
        .position(|(_, snapshot_index)| *snapshot_index == trace.selected_snapshot)
    {
        return index;
    }
    let selected_key = trace
        .snapshots
        .get(trace.selected_snapshot)
        .map(snapshot_phase_key);
    rows.iter()
        .position(|(key, _)| selected_key.as_ref() == Some(key))
        .unwrap_or_else(|| rows.len().saturating_sub(1))
}

fn append_compare_live_row(
    rows: &mut Vec<ComparePhaseRow>,
    key: PhaseKey,
    rust_index: Option<usize>,
    java_index: Option<usize>,
) {
    if let Some(index) = rows.iter().rposition(|row| {
        row.key == key
            && ((rust_index.is_some() && row.rust_index.is_none() && row.java_index.is_some())
                || (java_index.is_some() && row.java_index.is_none() && row.rust_index.is_some()))
    }) {
        let row = &mut rows[index];
        if let Some(idx) = rust_index {
            row.rust_index = Some(idx);
        }
        if let Some(idx) = java_index {
            row.java_index = Some(idx);
        }
        return;
    }
    rows.push(ComparePhaseRow {
        key,
        rust_index,
        java_index,
    });
}

fn divergence_for_phase<'a>(
    comparison: Option<&'a TraceComparison>,
    key: &PhaseKey,
) -> Option<&'a Divergence> {
    comparison.and_then(|comparison| {
        comparison
            .per_snapshot
            .iter()
            .find(|divergence| divergence.turn == key.turn && divergence.phase == key.phase)
    })
}

fn divergence_for_compare_row<'a>(
    comparison: Option<&'a TraceComparison>,
    trace: &TraceSession,
    row: &ComparePhaseRow,
) -> Option<&'a Divergence> {
    comparison.and_then(|comparison| {
        let rust_matches = comparison.rust_snapshot.as_ref().is_some_and(|snapshot| {
            row.rust_index
                .and_then(|idx| trace.rust.as_ref()?.snapshots.get(idx))
                == Some(snapshot)
        });
        let java_matches = comparison.java_snapshot.as_ref().is_some_and(|snapshot| {
            row.java_index
                .and_then(|idx| trace.java.as_ref()?.snapshots.get(idx))
                == Some(snapshot)
        });
        if comparison.rust_snapshot.is_some() || comparison.java_snapshot.is_some() {
            if !(rust_matches || java_matches) {
                return None;
            }
        } else if comparison.divergence_key.as_ref() != Some(&row.key) {
            return None;
        }
        comparison.first_divergence.as_ref()
    })
}

fn latest_follow_compare_row_index(rows: &[ComparePhaseRow]) -> Option<usize> {
    rows.iter()
        .rposition(|row| row.rust_index.is_some() && row.java_index.is_some())
        .or_else(|| rows.len().checked_sub(1))
}

fn latest_visible_shared_compare_row_index(trace: &TraceSession) -> Option<usize> {
    let rows = trace.compare_rows();
    rows.iter()
        .enumerate()
        .rev()
        .find(|(_, row)| row.rust_index.is_some() && row.java_index.is_some())
        .map(|(idx, _)| idx)
}

fn compare_row_occurrence(rows: &[ComparePhaseRow], row_index: usize) -> usize {
    let Some(target) = rows.get(row_index) else {
        return 1;
    };
    rows.iter()
        .take(row_index + 1)
        .filter(|row| row.key == target.key)
        .count()
}

fn pending_divergence_ready(trace: &TraceSession) -> bool {
    let Some(comparison) = trace.pending_comparison.as_ref() else {
        return false;
    };
    let frontier = trace
        .compare_selected_row
        .saturating_add(1)
        .min(trace.compare_display_rows.len());
    let rows = &trace.compare_display_rows[..frontier];
    let Some(divergence_index) = divergence_row_index(trace, rows, comparison) else {
        return false;
    };
    rows.len() > divergence_index
}

fn compare_rows_for_display(
    trace: &TraceSession,
    rows: &[ComparePhaseRow],
    trace_follow_live: bool,
) -> Vec<ComparePhaseRow> {
    if trace_follow_live
        || trace.pending_comparison.is_some()
        || trace.compare_visible_row_count > 0
    {
        let rust_still_revealing = trace
            .rust
            .as_ref()
            .is_some_and(|pane| !pane.stream_complete || !pane.pending_entries.is_empty());
        let java_still_revealing = trace
            .java
            .as_ref()
            .is_some_and(|pane| !pane.stream_complete || !pane.pending_entries.is_empty());
        let collecting_context = trace
            .comparison
            .as_ref()
            .is_some_and(|comparison| !comparison.passed())
            && (rust_still_revealing || java_still_revealing);
        let mut display_rows = trace.compare_display_rows.clone();
        if (trace_follow_live || trace.pending_comparison.is_some()) && !collecting_context {
            let frontier = trace
                .compare_selected_row
                .saturating_add(1)
                .min(display_rows.len());
            display_rows.truncate(frontier);
        }
        return display_rows;
    }
    let rust_still_revealing = trace
        .rust
        .as_ref()
        .is_some_and(|pane| !pane.stream_complete || !pane.pending_entries.is_empty());
    let java_still_revealing = trace
        .java
        .as_ref()
        .is_some_and(|pane| !pane.stream_complete || !pane.pending_entries.is_empty());
    let streaming = rust_still_revealing || java_still_revealing;
    let mut filtered = if trace.pending_comparison.is_some() {
        rows.iter()
            .filter(|row| row.rust_index.is_some() && row.java_index.is_some())
            .cloned()
            .collect()
    } else if let Some(comparison) = trace.comparison.as_ref() {
        if !comparison.passed() {
            if let Some(row_index) = divergence_row_index(trace, rows, comparison) {
                let divergence_turn = rows[row_index].key.turn;
                rows.iter()
                    .enumerate()
                    .filter_map(|(idx, row)| {
                        let shared = row.rust_index.is_some() && row.java_index.is_some();
                        if idx < row_index {
                            shared.then(|| row.clone())
                        } else {
                            (shared && row.key.turn <= divergence_turn).then(|| row.clone())
                        }
                    })
                    .collect()
            } else {
                rows.to_vec()
            }
        } else {
            rows.to_vec()
        }
    } else {
        let streaming = streaming
            && (trace.rust.as_ref().is_some_and(|pane| {
                !pane.snapshots.is_empty() || !pane.pending_entries.is_empty()
            }) || trace.java.as_ref().is_some_and(|pane| {
                !pane.snapshots.is_empty() || !pane.pending_entries.is_empty()
            }));
        if trace_follow_live && streaming {
            rows.iter()
                .filter(|row| row.rust_index.is_some() && row.java_index.is_some())
                .cloned()
                .collect()
        } else {
            rows.to_vec()
        }
    };
    let selected_frontier = trace
        .compare_selected_row
        .saturating_add(1)
        .min(filtered.len());
    let hold_to_playback_frontier = trace_follow_live
        || trace.pending_comparison.is_some()
        || (trace
            .comparison
            .as_ref()
            .is_some_and(|comparison| !comparison.passed())
            && streaming);
    let frontier = if hold_to_playback_frontier {
        selected_frontier
    } else {
        trace
            .compare_visible_row_count
            .min(filtered.len())
            .max(selected_frontier)
    };
    filtered.truncate(frontier);
    filtered
}

fn divergence_row_index(
    trace: &TraceSession,
    rows: &[ComparePhaseRow],
    comparison: &TraceComparison,
) -> Option<usize> {
    rows.iter()
        .position(|row| divergence_for_compare_row(Some(comparison), trace, row).is_some())
        .or_else(|| {
            comparison
                .divergence_key
                .as_ref()
                .and_then(|key| rows.iter().position(|row| row.key == *key))
        })
}

fn compare_selected_snapshot_indices(
    trace: &TraceSession,
    rows: &[ComparePhaseRow],
) -> (Option<usize>, Option<usize>) {
    let selected = rows.get(selected_compare_row_index(trace, rows));
    let mut rust_index = selected.and_then(|row| row.rust_index);
    let mut java_index = selected.and_then(|row| row.java_index);
    if let (Some(row), Some(comparison)) = (selected, trace.comparison.as_ref()) {
        if divergence_for_compare_row(Some(comparison), trace, row).is_some() {
            if let (Some(pane), Some(snapshot)) =
                (trace.rust.as_ref(), comparison.rust_snapshot.as_ref())
            {
                rust_index = pane
                    .snapshots
                    .iter()
                    .position(|candidate| candidate == snapshot);
            }
            if let (Some(pane), Some(snapshot)) =
                (trace.java.as_ref(), comparison.java_snapshot.as_ref())
            {
                java_index = pane
                    .snapshots
                    .iter()
                    .position(|candidate| candidate == snapshot);
            }
        }
    }
    (rust_index, java_index)
}

fn set_compare_row_selection(trace: &mut TraceSession, rows: &[ComparePhaseRow], row_index: usize) {
    let Some(row) = rows.get(row_index) else {
        return;
    };
    trace.compare_selected_row = row_index;
    trace.compare_visible_row_count = trace
        .compare_visible_row_count
        .max(row_index.saturating_add(1));
    trace.compare_selected_anchor = Some(CompareSelectionAnchor {
        key: row.key.clone(),
        rust_index: row.rust_index,
        java_index: row.java_index,
    });
    if let Some(rust) = trace.rust.as_mut() {
        if let Some(idx) = row.rust_index {
            rust.selected_snapshot = idx.min(rust.snapshots.len().saturating_sub(1));
        }
        rust.pending_timeline_scroll = true;
    }
    if let Some(java) = trace.java.as_mut() {
        if let Some(idx) = row.java_index {
            java.selected_snapshot = idx.min(java.snapshots.len().saturating_sub(1));
        }
        java.pending_timeline_scroll = true;
    }
}

fn jump_to_compare_row(
    trace: &mut TraceSession,
    rows: &[ComparePhaseRow],
    row_index: usize,
    trace_follow_live: &mut bool,
) {
    *trace_follow_live = false;
    set_compare_row_selection(trace, rows, row_index);
}

fn jump_to_compare_divergence(
    trace: &mut TraceSession,
    divergence: &Divergence,
    trace_follow_live: &mut bool,
) {
    let rows = trace.compare_rows();
    if let Some(row_index) = rows
        .iter()
        .position(|row| row.key.turn == divergence.turn && row.key.phase == divergence.phase)
    {
        jump_to_compare_row(trace, &rows, row_index, trace_follow_live);
    } else {
        jump_to_comparison_snapshot(trace, divergence.snapshot_index, trace_follow_live);
    }
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.poll_trace_task();
        self.handle_keyboard_navigation(ctx);
        if !self.trace_halted_on_divergence {
            if let Some(trace) = self.trace.as_mut() {
                let pane_follow_live =
                    self.trace_follow_live && !matches!(self.trace_mode, TraceMode::Compare);
                let mut revealed_snapshot = false;
                if let Some(rust) = trace.rust.as_mut() {
                    revealed_snapshot |= rust.reveal_pending(
                        Duration::from_millis(self.trace_reveal_ms),
                        pane_follow_live,
                    );
                }
                if let Some(java) = trace.java.as_mut() {
                    revealed_snapshot |= java.reveal_pending(
                        Duration::from_millis(self.trace_reveal_ms),
                        pane_follow_live,
                    );
                }
                if matches!(self.trace_mode, TraceMode::Compare)
                    && revealed_snapshot
                    && (self.trace_follow_live || self.trace_collecting_context)
                {
                    let _ = trace.append_next_compare_display_row(
                        self.trace_follow_live,
                        self.trace_collecting_context,
                    );
                    let rows = trace.compare_display_rows.clone();
                    let current_row = selected_compare_row_index(trace, &rows);
                    self.compare_debug_state = Some(format!(
                        "playback: selected={} displayed={} pending={} comparison={} rows={}",
                        current_row,
                        trace.compare_display_rows.len(),
                        trace.pending_comparison.is_some(),
                        trace.comparison.is_some(),
                        rows.len()
                    ));
                }
            }
            self.promote_pending_compare_if_ready();
        } else if let Some(trace) = self.trace.as_mut() {
            if let Some(rust) = trace.rust.as_mut() {
                rust.pending_timeline_scroll = true;
            }
            if let Some(java) = trace.java.as_mut() {
                java.pending_timeline_scroll = true;
            }
        }
        if !self.trace_running {
            self.promote_pending_compare_if_ready();
        }
        if self.trace_running
            || self.java_harness_building
            || self.trace.as_ref().is_some_and(|trace| {
                trace
                    .rust
                    .as_ref()
                    .is_some_and(|pane| !pane.pending_entries.is_empty())
                    || trace
                        .java
                        .as_ref()
                        .is_some_and(|pane| !pane.pending_entries.is_empty())
            })
        {
            ctx.request_repaint_after(Duration::from_millis(50));
        }
        if let Some(card) = self.selected_card.clone() {
            if self.source != card.raw {
                self.source = card.raw;
                self.current_path = None;
                self.load_error = None;
            }
        }

        let source_for_parse = self.source.clone();
        let parsed = ParsedCardScript::parse(&source_for_parse);
        egui::TopBottomPanel::top("menu_bar")
            .exact_height(theme::MENU_BAR_HEIGHT)
            .show(ctx, |ui| {
                render_menu_bar(ui, self);
            });

        egui::TopBottomPanel::top("toolbar")
            .exact_height(theme::TOOLBAR_HEIGHT)
            .show(ctx, |ui| {
                render_toolbar(ui, self);
            });

        egui::TopBottomPanel::bottom("status_bar")
            .exact_height(theme::STATUS_BAR_HEIGHT)
            .show(ctx, |ui| {
                render_status_bar(ui, self);
            });

        egui::SidePanel::left("left_rail")
            .resizable(true)
            .show_separator_line(false)
            .default_width(theme::LEFT_RAIL_WIDTH)
            .min_width(220.0)
            .max_width(900.0)
            .frame(theme::rail_frame())
            .show(ctx, |ui| {
                let source_meta = self
                    .selected_card
                    .as_ref()
                    .map(|card| card.name.clone())
                    .or(self
                        .current_path
                        .as_ref()
                        .and_then(|path| path.file_name())
                        .and_then(|name| name.to_str())
                        .map(|name| name.to_string()));
                render_section_frame_with_meta(
                    ui,
                    "left_source",
                    self.trace_panel_height,
                    "Source",
                    source_meta.as_deref(),
                    |ui| {
                        if !self.trace_follow_live {
                            ui.colored_label(theme::YELLOW, "LOCKED");
                        }
                        if self.selected_card.is_some()
                            && ui.button("Clear selected card").clicked()
                        {
                            self.selected_card = None;
                        }
                        render_selection_highlight_frame(
                            ui,
                            self.selected_card.is_some(),
                            self.selected_card
                                .as_ref()
                                .map(|card| format!("trace selection · {}", card.name)),
                            |ui| {
                                egui::ScrollArea::vertical()
                                    .auto_shrink([false, false])
                                    .show(ui, |ui| {
                                        let mut layouter =
                                            |ui: &egui::Ui, text: &str, wrap_width: f32| {
                                                layout_source_galley(ui, text, wrap_width)
                                            };
                                        ui.add(
                                            egui::TextEdit::multiline(&mut self.source)
                                                .desired_width(f32::INFINITY)
                                                .desired_rows(40)
                                                .code_editor()
                                                .layouter(&mut layouter),
                                        );
                                    });
                            },
                        );
                    },
                );
                drag_height_handle(ui, &mut self.trace_panel_height);
                render_section_frame_with_meta(
                    ui,
                    "left_summary",
                    self.summary_panel_height,
                    "Card Summary",
                    None,
                    |ui| {
                        egui::ScrollArea::vertical()
                            .auto_shrink([false, false])
                            .show(ui, |ui| {
                                render_summary(ui, &parsed);
                            });
                    },
                );
                drag_height_handle(ui, &mut self.summary_panel_height);
                let remaining_height = ui.available_height().max(180.0);
                let ast_meta = match self.ast_view_mode {
                    AstViewMode::Graph => "graph",
                    AstViewMode::Text => "text",
                };
                render_section_frame_with_meta(
                    ui,
                    "left_ast",
                    remaining_height,
                    "Parsed AST",
                    Some(ast_meta),
                    |ui| {
                        egui::ScrollArea::both()
                            .id_salt("left_ast_canvas")
                            .auto_shrink([false, false])
                            .show(ui, |ui| {
                                render_ast(
                                    ui,
                                    &parsed,
                                    self.selected_card.as_ref().map(|card| card.name.as_str()),
                                    &mut self.ast_view_mode,
                                );
                            });
                    },
                );
            });

        egui::SidePanel::right("right_rail")
            .resizable(true)
            .show_separator_line(false)
            .default_width(if matches!(self.trace_mode, TraceMode::Compare) {
                theme::RIGHT_RAIL_WIDTH * 1.45
            } else {
                theme::RIGHT_RAIL_WIDTH
            })
            .min_width(220.0)
            .max_width(1000.0)
            .frame(theme::rail_frame())
            .show(ctx, |ui| {
                let active_trace_counts = self
                    .active_trace_pane_ref()
                    .map(|trace| (trace.decision_count(), trace.callback_count()));
                let trace_mode = self.trace_mode;
                let archive_ref = self.archive.as_ref();
                let trace_ref = &self.trace;
                let min_snapshot_height = if matches!(self.trace_mode, TraceMode::Compare) {
                    320.0
                } else {
                    360.0
                };
                self.right_snapshot_panel_height =
                    self.right_snapshot_panel_height.max(min_snapshot_height);
                let snapshot_meta = match self.trace_mode {
                    TraceMode::Rust => Some("RUST"),
                    TraceMode::Java => Some("JAVA"),
                    TraceMode::Compare => Some("RUST · JAVA"),
                };
                render_section_frame_with_meta(
                    ui,
                    "right_snapshot",
                    self.right_snapshot_panel_height,
                    "Snapshot",
                    snapshot_meta,
                    |ui| {
                        render_snapshot_shell(
                            ui,
                            trace_ref,
                            trace_mode,
                            archive_ref,
                            &mut self.selected_card,
                        );
                    },
                );
                drag_height_handle(ui, &mut self.right_snapshot_panel_height);
                let frame_meta = self
                    .active_trace_pane_ref()
                    .map(|pane| format!("#{}", pane.selected_snapshot))
                    .unwrap_or_else(|| "#0".to_string());
                self.right_events_panel_height = self.right_events_panel_height.max(220.0);
                render_section_frame_with_meta(
                    ui,
                    "right_events",
                    self.right_events_panel_height,
                    "Frame Events",
                    Some(&frame_meta),
                    |ui| {
                        render_event_shell(ui, trace_ref, trace_mode);
                    },
                );
                drag_height_handle(ui, &mut self.right_events_panel_height);
                let remaining_height = ui.available_height().max(130.0);
                render_section_frame_with_meta(
                    ui,
                    "right_diagnostics",
                    remaining_height,
                    "Diagnostics",
                    self.trace_error.as_deref().map(|_| "error"),
                    |ui| {
                        egui::ScrollArea::vertical()
                            .auto_shrink([false, false])
                            .show(ui, |ui| {
                                let (rust_snaps, java_snaps) = self.snapshot_counts();
                                ui.horizontal_wrapped(|ui| {
                                    ui.colored_label(theme::ACCENT, "source");
                                    ui.label(
                                        self.current_path
                                            .as_ref()
                                            .map_or("(unsaved sample)".to_string(), |path| {
                                                path.display().to_string()
                                            }),
                                    );
                                });
                                ui.horizontal_wrapped(|ui| {
                                    ui.colored_label(theme::RUST, "rust");
                                    ui.label(format!("{rust_snaps} snapshots"));
                                    ui.colored_label(theme::JAVA, "java");
                                    ui.label(format!("{java_snaps} snapshots"));
                                });
                                if let Some(trace) = &self.trace {
                                    if let Some(comparison) = trace.comparison.as_ref() {
                                        let status =
                                            if comparison.passed() { "PASS" } else { "FAIL" };
                                        ui.horizontal_wrapped(|ui| {
                                            ui.colored_label(
                                                if comparison.passed() {
                                                    theme::GREEN
                                                } else {
                                                    theme::RED
                                                },
                                                format!("parity {status}"),
                                            );
                                            ui.label(format!(
                                                "{} divergence(s)",
                                                comparison.per_snapshot.len()
                                            ));
                                        });
                                    }
                                }
                                if let Some((decision_count, callback_count)) = active_trace_counts
                                {
                                    ui.colored_label(
                                        theme::FG_2,
                                        format!(
                                            "decisions {} · callbacks {}",
                                            decision_count, callback_count
                                        ),
                                    );
                                }
                                if let Some(err) = &self.load_error {
                                    ui.colored_label(theme::RED, err);
                                }
                                if let Some(err) = &self.archive_error {
                                    ui.colored_label(theme::RED, err);
                                }
                                if let Some(err) = &self.trace_error {
                                    ui.colored_label(theme::RED, err);
                                }
                                if let Some(status) = self.trace_status.as_deref() {
                                    ui.colored_label(theme::FG_3, status);
                                }
                                if !self.trace_debug_log.is_empty() {
                                    ui.separator();
                                    ui.colored_label(theme::FG_2, "debug");
                                    for line in self.trace_debug_log.iter().rev().take(12) {
                                        ui.monospace(line);
                                    }
                                }
                            });
                    },
                );
            });

        egui::CentralPanel::default()
            .frame(theme::rail_frame())
            .show(ctx, |ui| {
                let height = ui.available_height().max(240.0);
                let trace_meta = self
                    .active_trace_pane_ref()
                    .map(|pane| {
                        format!(
                            "{} snapshots · {} callbacks",
                            pane.snapshots.len(),
                            pane.callback_count()
                        )
                    })
                    .unwrap_or_else(|| "idle".to_string());
                render_section_frame_with_meta(
                    ui,
                    "center_trace",
                    height,
                    "Engine Trace",
                    Some(&trace_meta),
                    |ui| {
                        render_trace(
                            ui,
                            &mut self.trace,
                            self.trace_error.as_deref(),
                            self.trace_running,
                            self.trace_status.as_deref(),
                            &self.search_query,
                            &mut self.trace_follow_live,
                        );
                    },
                );
            });

        render_toolbar_popovers(ctx, self);
        render_deck_modal(ctx, self);
    }
}

fn render_menu_bar(ui: &mut egui::Ui, app: &App) {
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = 0.0;
        for item in ["File", "Edit", "Run", "Trace", "View", "Help"] {
            let button = egui::Button::new(egui::RichText::new(item).size(theme::CHROME_TEXT_SIZE))
                .frame(false);
            ui.add_sized([44.0, theme::MENU_BAR_HEIGHT - 6.0], button);
        }
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            let sample = app
                .trace
                .as_ref()
                .map(|trace| format!("sample seed {}", trace.seed))
                .unwrap_or_else(|| "sample idle".to_string());
            ui.colored_label(theme::FG_3, sample);
            ui.separator();
            let archive_label = app
                .archive
                .as_ref()
                .map(|_| {
                    app.archive_path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or("cardset.rkyv")
                        .to_string()
                })
                .unwrap_or_else(|| "archive missing".to_string());
            ui.colored_label(theme::FG_2, archive_label);
        });
    });
}

fn render_toolbar(ui: &mut egui::Ui, app: &mut App) {
    let trace_busy = app.trace_running || app.trace_collecting_context;
    let (frame_current, frame_total) = app.current_frame_counts();
    let (event_label, event_meta) = app.current_event_descriptor();
    let java_version = app
        .java_jar_path
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|value| shorten_list(value, 18))
        .unwrap_or_else(|| "no jar".to_string());
    let current_preset_name = app
        .trace_presets
        .get(app.selected_trace_preset)
        .map(|preset| preset.name.clone())
        .unwrap_or_else(|| "sample matchup".to_string());
    let run_summary = format!(
        "T{}·G{}/{}·#{}",
        app.trace_max_turns_input,
        app.trace_game_index_input,
        app.trace_games_input,
        app.trace_seed_input
    );
    let has_trace_frames = app
        .active_trace_pane_ref()
        .is_some_and(|pane| !pane.snapshots.is_empty());
    let can_step_back = app
        .active_trace_pane_ref()
        .is_some_and(|pane| pane.selected_snapshot > 0);
    let can_step_forward = app
        .active_trace_pane_ref()
        .is_some_and(|pane| pane.selected_snapshot + 1 < pane.snapshots.len());
    let toolbar_width = ui.available_width();

    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing = egui::vec2(6.0, 0.0);

        egui::Frame::none()
            .fill(theme::BG_0)
            .stroke(egui::Stroke::new(1.0, theme::BORDER))
            .show(ui, |ui| {
                ui.spacing_mut().item_spacing.x = 0.0;
                let primary_label = if app.trace_collecting_context {
                    "◆"
                } else if app.trace_running {
                    "■"
                } else {
                    "▶"
                };
                let primary_tooltip = if app.trace_collecting_context {
                    "Capturing divergence context… · Esc aborts"
                } else if app.trace_running {
                    "Abort trace · Esc"
                } else {
                    "Run trace · F5"
                };
                let button_specs = [
                    (
                        "↺",
                        !trace_busy && !app.java_harness_building,
                        false,
                        "Restart · Cmd+R",
                    ),
                    ("⤴", can_step_back, false, "Step out · Shift+F11"),
                    ("⤓", can_step_forward, false, "Step into · F11"),
                    ("↦", has_trace_frames, false, "Step over · F10"),
                    (
                        primary_label,
                        !app.java_harness_building,
                        true,
                        primary_tooltip,
                    ),
                ];
                for (index, (label, enabled, primary, tooltip)) in button_specs.iter().enumerate() {
                    let button = egui::Button::new(
                        egui::RichText::new(*label).size(12.0).color(if *primary {
                            theme::BG_0
                        } else {
                            theme::FG_1
                        }),
                    )
                    .frame(true)
                    .fill(if *primary { theme::ACCENT } else { theme::BG_0 })
                    .stroke(egui::Stroke::new(1.0, theme::BORDER))
                    .min_size(egui::vec2(if *primary { 32.0 } else { 24.0 }, 22.0));
                    let response = ui.add_enabled(*enabled, button);
                    response.clone().on_hover_text(*tooltip);
                    if response.clicked() {
                        match index {
                            0 => app.restart_trace(),
                            1 => app.step_trace(-1),
                            2 => app.step_trace(1),
                            3 => app.step_trace(1),
                            4 => {
                                if trace_busy {
                                    app.abort_trace();
                                } else {
                                    app.continue_trace();
                                }
                            }
                            _ => {}
                        }
                    }
                }
            });

        if toolbar_width > 1280.0 {
            egui::Frame::none()
                .fill(theme::BG_0)
                .stroke(egui::Stroke::new(1.0, theme::BORDER))
                .inner_margin(egui::Margin {
                    left: 8.0,
                    right: 8.0,
                    top: 2.0,
                    bottom: 2.0,
                })
                .show(ui, |ui| {
                    ui.spacing_mut().item_spacing.x = 6.0;
                    ui.colored_label(theme::FG_3, egui::RichText::new("SPEED").size(10.0));
                    ui.add_sized(
                        [70.0, 18.0],
                        egui::Slider::new(&mut app.trace_reveal_ms, 5..=250)
                            .show_value(false)
                            .clamping(egui::SliderClamping::Always),
                    );
                    ui.colored_label(
                        theme::FG_1,
                        egui::RichText::new(format!("{}ms", app.trace_reveal_ms)).size(10.0),
                    );
                });
        }

        if toolbar_width > 1100.0 {
            let locked = !app.trace_follow_live;
            let label = if locked {
                "LOCKED"
            } else if app.trace_collecting_context {
                "CTX"
            } else if app.trace_running {
                "LIVE"
            } else {
                "PAUSED"
            };
            let color = if locked {
                theme::YELLOW
            } else if app.trace_collecting_context {
                theme::ACCENT
            } else if app.trace_running {
                theme::GREEN
            } else {
                theme::FG_3
            };
            let response = egui::Frame::none()
                .fill(theme::BG_0)
                .stroke(egui::Stroke::new(1.0, theme::BORDER))
                .inner_margin(egui::Margin {
                    left: 8.0,
                    right: 8.0,
                    top: 2.0,
                    bottom: 2.0,
                })
                .show(ui, |ui| {
                    ui.horizontal(|ui| {
                        let (dot_rect, _) =
                            ui.allocate_exact_size(egui::vec2(6.0, 6.0), egui::Sense::hover());
                        ui.painter().circle_filled(dot_rect.center(), 3.0, color);
                        ui.colored_label(color, egui::RichText::new(label).size(10.0));
                    });
                })
                .response
                .interact(egui::Sense::click());
            if response.clicked() {
                app.trace_follow_live = !app.trace_follow_live;
            }
        }

        egui::Frame::none()
            .fill(theme::BG_0)
            .stroke(egui::Stroke::new(1.0, theme::BORDER))
            .inner_margin(egui::Margin {
                left: 4.0,
                right: 6.0,
                top: 2.0,
                bottom: 2.0,
            })
            .show(ui, |ui| {
                ui.spacing_mut().item_spacing.x = 2.0;
                let backend_text = match app.trace_mode {
                    TraceMode::Rust => "Rust",
                    TraceMode::Java => "Java",
                    TraceMode::Compare => "Side·by·side",
                };
                egui::ComboBox::from_id_salt("toolbar_backend_mode")
                    .selected_text(backend_text)
                    .width(128.0)
                    .show_ui(ui, |ui| {
                        ui.selectable_value(&mut app.trace_mode, TraceMode::Rust, "Rust");
                        ui.selectable_value(&mut app.trace_mode, TraceMode::Java, "Java");
                        ui.selectable_value(
                            &mut app.trace_mode,
                            TraceMode::Compare,
                            "Side-by-side",
                        );
                    });
                if matches!(app.trace_mode, TraceMode::Java | TraceMode::Compare) {
                    let java_button = ui.add(
                        egui::Button::new(
                            egui::RichText::new(format!("Java backend ▾  {java_version}"))
                                .size(10.0)
                                .extra_letter_spacing(0.8)
                                .color(theme::JAVA),
                        )
                        .fill(theme::BG_0)
                        .stroke(egui::Stroke::new(1.0, theme::JAVA))
                        .min_size(egui::vec2(168.0, 22.0)),
                    );
                    if java_button.clicked() {
                        app.toolbar_popover = match app.toolbar_popover {
                            Some(ToolbarPopover::Java) => None,
                            _ => Some(ToolbarPopover::Java),
                        };
                        app.toolbar_popover_just_opened = app.toolbar_popover.is_some();
                    }
                }
                ui.colored_label(theme::BORDER_STRONG, "/");
                toolbar_segment_button(
                    ui,
                    &format!(
                        "{} vs {}",
                        shorten_list(&app.trace_deck1_input, 18),
                        shorten_list(&app.trace_deck2_input, 18)
                    ),
                    None,
                    None,
                    false,
                );
                ui.add_space(4.0);
                ui.add_sized(
                    [54.0, 16.0],
                    egui::Label::new(
                        egui::RichText::new(format!("#{frame_current}"))
                            .size(13.0)
                            .strong()
                            .color(theme::ACCENT),
                    ),
                );
                ui.add_sized(
                    [44.0, 16.0],
                    egui::Label::new(
                        egui::RichText::new(format!("/ {frame_total}"))
                            .size(10.0)
                            .color(theme::FG_3),
                    ),
                );
                ui.separator();
                ui.add_sized(
                    [108.0, 16.0],
                    egui::Label::new(
                        egui::RichText::new(event_label)
                            .size(10.0)
                            .color(theme::FG_0)
                            .strong(),
                    ),
                );
                ui.add_sized(
                    [92.0, 16.0],
                    egui::Label::new(
                        egui::RichText::new(event_meta)
                            .size(10.0)
                            .color(theme::FG_3),
                    ),
                );
                ui.add_space(8.0);
                let search_width = if toolbar_width > 1500.0 { 148.0 } else { 116.0 };
                let search_frame = egui::Frame::none()
                    .fill(theme::BG_1)
                    .stroke(egui::Stroke::new(1.0, theme::BORDER))
                    .inner_margin(egui::Margin {
                        left: 6.0,
                        right: 4.0,
                        top: 2.0,
                        bottom: 2.0,
                    });
                search_frame.show(ui, |ui| {
                    ui.set_width(search_width);
                    ui.spacing_mut().item_spacing.x = 4.0;
                    ui.horizontal(|ui| {
                        ui.add_sized(
                            [
                                search_width
                                    - if app.search_query.is_empty() {
                                        8.0
                                    } else {
                                        22.0
                                    },
                                16.0,
                            ],
                            egui::TextEdit::singleline(&mut app.search_query)
                                .hint_text("Search trace…")
                                .frame(false),
                        );
                        if !app.search_query.is_empty() && ui.small_button("✕").clicked() {
                            app.search_query.clear();
                        }
                    });
                });
            });

        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            if ui
                .add_enabled(
                    !app.trace_running && !app.java_harness_building,
                    egui::Button::new(
                        egui::RichText::new("Run trace")
                            .size(10.0)
                            .extra_letter_spacing(0.8)
                            .color(theme::BG_0),
                    )
                    .fill(theme::ACCENT)
                    .stroke(egui::Stroke::new(1.0, theme::ACCENT))
                    .min_size(egui::vec2(96.0, 22.0)),
                )
                .clicked()
            {
                app.run_sample_trace();
            }
            if ui
                .button(
                    egui::RichText::new("Copy CLI")
                        .size(10.0)
                        .extra_letter_spacing(0.8),
                )
                .clicked()
            {
                ui.ctx().copy_text(app.current_cli_command());
                app.trace_status = Some("Copied forge-parity CLI command".to_string());
            }
            let run_config_button = ui.add(
                egui::Button::new(
                    egui::RichText::new(format!("Run config ▾  {run_summary}"))
                        .size(10.0)
                        .extra_letter_spacing(0.8),
                )
                .fill(theme::BG_0)
                .stroke(egui::Stroke::new(1.0, theme::BORDER))
                .min_size(egui::vec2(170.0, 22.0)),
            );
            if run_config_button.clicked() {
                app.toolbar_popover = match app.toolbar_popover {
                    Some(ToolbarPopover::RunConfig) => None,
                    _ => Some(ToolbarPopover::RunConfig),
                };
                app.toolbar_popover_just_opened = app.toolbar_popover.is_some();
            }
            run_config_button.on_hover_text(current_preset_name);
        });
    });
}

fn toolbar_segment_button(
    ui: &mut egui::Ui,
    text: &str,
    swatch: Option<egui::Color32>,
    suffix: Option<&str>,
    uppercase: bool,
) -> egui::Response {
    let label = if uppercase {
        text.to_uppercase()
    } else {
        text.to_string()
    };
    let width = 14.0
        + label.chars().count() as f32 * if uppercase { 6.3 } else { 6.8 }
        + suffix.map_or(0.0, |value| value.chars().count() as f32 * 5.8 + 8.0)
        + swatch.map_or(0.0, |_| 14.0);
    let (rect, response) = ui.allocate_exact_size(egui::vec2(width, 18.0), egui::Sense::click());
    if response.hovered() {
        ui.painter().rect_filled(rect, 0.0, theme::BG_2);
    }
    let mut content_ui = ui.new_child(
        egui::UiBuilder::new()
            .max_rect(rect.shrink2(egui::vec2(6.0, 1.0)))
            .layout(egui::Layout::left_to_right(egui::Align::Center)),
    );
    content_ui.spacing_mut().item_spacing.x = 6.0;
    if let Some(color) = swatch {
        let (swatch_rect, _) =
            content_ui.allocate_exact_size(egui::vec2(8.0, 8.0), egui::Sense::hover());
        content_ui.painter().rect_filled(swatch_rect, 0.0, color);
    }
    content_ui.label(
        egui::RichText::new(label)
            .size(if uppercase { 10.0 } else { 11.0 })
            .color(if uppercase { theme::FG_2 } else { theme::FG_1 }),
    );
    if let Some(suffix) = suffix {
        content_ui.colored_label(theme::FG_3, egui::RichText::new(suffix).size(10.0));
    }
    response
}

fn render_run_config_popup(ui: &mut egui::Ui, app: &mut App) {
    ui.set_min_width(480.0);
    let deck_names = available_deck_names(app);
    egui::Frame::none()
        .fill(theme::BG_1)
        .stroke(egui::Stroke::new(1.0, theme::BORDER_STRONG))
        .show(ui, |ui| {
            ui.spacing_mut().item_spacing = egui::vec2(12.0, 8.0);
            ui.vertical(|ui| {
                ui.horizontal(|ui| {
                    ui.colored_label(
                        theme::FG_2,
                        egui::RichText::new("RUN CONFIGURATION").size(10.0).strong(),
                    );
                    ui.colored_label(theme::FG_3, "· applied to next run trace");
                });
                ui.separator();
                egui::Grid::new("run_config_popup_grid")
                    .num_columns(2)
                    .spacing([12.0, 8.0])
                    .show(ui, |ui| {
                        ui.colored_label(theme::FG_3, "BACKEND");
                        ui.horizontal(|ui| {
                            ui.selectable_value(&mut app.trace_mode, TraceMode::Rust, "Rust");
                            ui.selectable_value(&mut app.trace_mode, TraceMode::Java, "Java");
                            ui.selectable_value(
                                &mut app.trace_mode,
                                TraceMode::Compare,
                                "Side·by·side",
                            );
                        });
                        ui.end_row();

                        ui.colored_label(theme::FG_3, "MATCHUP");
                        let selected_preset_name = app
                            .trace_presets
                            .get(app.selected_trace_preset)
                            .map(|preset| preset.name.as_str())
                            .unwrap_or("sample");
                        let mut new_preset = app.selected_trace_preset;
                        egui::ComboBox::from_id_salt("trace_matchup_preset_popup")
                            .selected_text(selected_preset_name)
                            .width(220.0)
                            .show_ui(ui, |ui| {
                                for (idx, preset) in app.trace_presets.iter().enumerate() {
                                    ui.selectable_value(&mut new_preset, idx, &preset.name);
                                }
                            });
                        if new_preset != app.selected_trace_preset {
                            app.apply_trace_preset(new_preset);
                        }
                        ui.end_row();

                        ui.colored_label(theme::FG_3, "DECK 1");
                        ui.horizontal(|ui| {
                            egui::ComboBox::from_id_salt("run_cfg_deck1")
                                .selected_text(shorten_list(&app.trace_deck1_input, 24))
                                .width(220.0)
                                .show_ui(ui, |ui| {
                                    for deck_name in &deck_names {
                                        ui.selectable_value(
                                            &mut app.trace_deck1_input,
                                            deck_name.clone(),
                                            deck_name,
                                        );
                                    }
                                });
                            ui.add_sized(
                                [160.0, 20.0],
                                egui::TextEdit::singleline(&mut app.trace_deck1_input),
                            );
                        });
                        ui.end_row();

                        ui.colored_label(theme::FG_3, "DECK 2");
                        ui.horizontal(|ui| {
                            egui::ComboBox::from_id_salt("run_cfg_deck2")
                                .selected_text(shorten_list(&app.trace_deck2_input, 24))
                                .width(220.0)
                                .show_ui(ui, |ui| {
                                    for deck_name in &deck_names {
                                        ui.selectable_value(
                                            &mut app.trace_deck2_input,
                                            deck_name.clone(),
                                            deck_name,
                                        );
                                    }
                                });
                            ui.add_sized(
                                [160.0, 20.0],
                                egui::TextEdit::singleline(&mut app.trace_deck2_input),
                            );
                        });
                        ui.end_row();

                        ui.colored_label(theme::FG_3, "FORMAT");
                        ui.add_sized(
                            [180.0, 20.0],
                            egui::TextEdit::singleline(&mut app.trace_variant),
                        );
                        ui.end_row();

                        ui.colored_label(theme::FG_3, "SEED");
                        ui.horizontal(|ui| {
                            ui.add(
                                egui::DragValue::new(&mut app.trace_seed_input)
                                    .speed(1.0)
                                    .range(0..=u64::MAX),
                            );
                            if ui.button("↻ random").clicked() {
                                app.trace_seed_input =
                                    (Instant::now().elapsed().as_nanos() % 10_000) as u64;
                            }
                        });
                        ui.end_row();

                        ui.colored_label(theme::FG_3, "TURNS");
                        ui.horizontal(|ui| {
                            ui.add(
                                egui::DragValue::new(&mut app.trace_max_turns_input)
                                    .speed(1.0)
                                    .range(1..=200),
                            );
                            ui.colored_label(theme::FG_3, "max turns per game");
                        });
                        ui.end_row();

                        ui.colored_label(theme::FG_3, "GAMES");
                        ui.horizontal(|ui| {
                            ui.add(
                                egui::DragValue::new(&mut app.trace_games_input)
                                    .speed(1.0)
                                    .range(1..=200),
                            );
                            app.trace_games_input = app.trace_games_input.max(1);
                            ui.colored_label(theme::FG_3, "game");
                            ui.add(
                                egui::DragValue::new(&mut app.trace_game_index_input)
                                    .speed(1.0)
                                    .range(1..=app.trace_games_input.max(1)),
                            );
                            app.trace_game_index_input = app
                                .trace_game_index_input
                                .clamp(1, app.trace_games_input.max(1));
                            ui.colored_label(theme::FG_3, format!("of {}", app.trace_games_input));
                        });
                        ui.end_row();

                        ui.colored_label(theme::FG_3, "FLAGS");
                        ui.horizontal_wrapped(|ui| {
                            ui.checkbox(&mut app.trace_prefer_actions, "prefer actions");
                            ui.checkbox(&mut app.trace_deep, "deep");
                            ui.checkbox(&mut app.trace_loose_parity, "loose parity");
                        });
                        ui.end_row();
                    });
                ui.separator();
                ui.horizontal(|ui| {
                    ui.colored_label(
                        theme::FG_3,
                        "Use the toolbar Run trace action to launch this config.",
                    );
                });
            });
        });
}

fn render_java_popup(ui: &mut egui::Ui, app: &mut App) {
    ui.set_min_width(360.0);
    egui::Frame::none()
        .fill(theme::BG_1)
        .stroke(egui::Stroke::new(1.0, theme::BORDER_STRONG))
        .show(ui, |ui| {
            ui.vertical(|ui| {
                ui.colored_label(
                    theme::FG_2,
                    egui::RichText::new("JAVA BACKEND").size(10.0).strong(),
                );
                ui.separator();
                render_java_popup_row(
                    ui,
                    "☕",
                    "Open .jar…",
                    app.java_jar_path.display().to_string(),
                    "Select the current harness jar.",
                    |ui| {
                        if ui.button("Open .jar…").clicked() {
                            if let Some(path) = rfd::FileDialog::new()
                                .add_filter("Java archive", &["jar"])
                                .pick_file()
                            {
                                app.java_jar_path = path;
                                app.prewarm_java_server();
                                ui.memory_mut(|mem| mem.close_popup());
                            }
                        }
                    },
                );
                render_java_popup_row(
                    ui,
                    "⚙",
                    "Detect",
                    "Scan workspace and cache",
                    "Find the latest forge harness jar automatically.",
                    |ui| {
                        if ui.button("Detect").clicked() {
                            if let Some(path) = discover_java_jar(Some(&app.java_jar_path)) {
                                app.java_jar_path = path;
                                app.trace_error = None;
                                app.prewarm_java_server();
                                ui.memory_mut(|mem| mem.close_popup());
                            } else {
                                app.trace_error = Some(
                                    "Java harness not found. Use Build Java harness or Open Java JAR…"
                                        .to_string(),
                                );
                            }
                        }
                    },
                );
                render_java_popup_row(
                    ui,
                    "⚒",
                    "Build harness",
                    "Compile Rust↔Java bridge",
                    "Use the existing harness build pipeline.",
                    |ui| {
                        if ui
                            .add_enabled(
                                !app.trace_running && !app.java_harness_building,
                                egui::Button::new("Build"),
                            )
                            .clicked()
                        {
                            app.build_java_harness();
                            ui.memory_mut(|mem| mem.close_popup());
                        }
                    },
                );
                render_java_popup_row(
                    ui,
                    "▶",
                    "Run trace",
                    "Execute configured matchup",
                    "Run the selected matchup through the active backend(s).",
                    |ui| {
                        if ui
                            .add_enabled(
                                !app.trace_running && !app.java_harness_building,
                                egui::Button::new("Run trace"),
                            )
                            .clicked()
                        {
                            app.run_sample_trace();
                            ui.memory_mut(|mem| mem.close_popup());
                        }
                    },
                );
            });
        });
}

fn render_java_popup_row(
    ui: &mut egui::Ui,
    icon: &str,
    title: &str,
    value: impl Into<String>,
    description: &str,
    add_action: impl FnOnce(&mut egui::Ui),
) {
    let value = value.into();
    let row_height = 56.0;
    let (rect, _) = ui.allocate_exact_size(
        egui::vec2(ui.available_width(), row_height),
        egui::Sense::hover(),
    );
    let mut row_ui = ui.new_child(
        egui::UiBuilder::new()
            .max_rect(rect.shrink2(egui::vec2(2.0, 4.0)))
            .layout(egui::Layout::left_to_right(egui::Align::Center)),
    );
    row_ui.spacing_mut().item_spacing.x = 10.0;
    row_ui.add_sized(
        [16.0, row_height - 8.0],
        egui::Label::new(egui::RichText::new(icon).color(theme::JAVA).size(14.0)),
    );
    row_ui.vertical(|ui| {
        ui.label(
            egui::RichText::new(title)
                .color(theme::FG_0)
                .strong()
                .size(11.0),
        );
        ui.colored_label(theme::FG_2, egui::RichText::new(value).size(10.0));
        ui.colored_label(theme::FG_3, egui::RichText::new(description).size(10.0));
    });
    row_ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
        add_action(ui);
    });
    ui.painter().hline(
        rect.x_range(),
        rect.bottom(),
        egui::Stroke::new(1.0, theme::BORDER),
    );
}

fn render_trace_config_bar(ui: &mut egui::Ui, app: &mut App) {
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing = egui::vec2(4.0, 0.0);

        let selected_preset_name = app
            .trace_presets
            .get(app.selected_trace_preset)
            .map(|preset| preset.name.as_str())
            .unwrap_or("sample");
        let mut new_preset = app.selected_trace_preset;
        ui.colored_label(theme::FG_3, "MATCHUP");
        egui::ComboBox::from_id_salt("trace_matchup_preset")
            .selected_text(selected_preset_name)
            .width(150.0)
            .show_ui(ui, |ui| {
                for (idx, preset) in app.trace_presets.iter().enumerate() {
                    ui.selectable_value(&mut new_preset, idx, &preset.name);
                }
            });
        if new_preset != app.selected_trace_preset {
            app.apply_trace_preset(new_preset);
        }
        ui.label("Deck 1");
        ui.add_sized(
            [132.0, 20.0],
            egui::TextEdit::singleline(&mut app.trace_deck1_input)
                .hint_text("red_burn / inline:..."),
        );
        ui.label("Deck 2");
        ui.add_sized(
            [132.0, 20.0],
            egui::TextEdit::singleline(&mut app.trace_deck2_input)
                .hint_text("green_stompy / inline:..."),
        );
        ui.label("Seed");
        ui.add(
            egui::DragValue::new(&mut app.trace_seed_input)
                .speed(1.0)
                .range(0..=u64::MAX),
        );
        ui.label("Turns");
        ui.add(
            egui::DragValue::new(&mut app.trace_max_turns_input)
                .speed(1.0)
                .range(1..=200),
        );
        ui.label("Games");
        ui.add(
            egui::DragValue::new(&mut app.trace_games_input)
                .speed(1.0)
                .range(1..=200),
        );
        app.trace_games_input = app.trace_games_input.max(1);
        ui.label("Game");
        ui.add(
            egui::DragValue::new(&mut app.trace_game_index_input)
                .speed(1.0)
                .range(1..=app.trace_games_input.max(1)),
        );
        app.trace_game_index_input = app
            .trace_game_index_input
            .clamp(1, app.trace_games_input.max(1));
        ui.colored_label(
            theme::FG_3,
            format!(
                "effective seed {}",
                app.trace_seed_input.saturating_add(app.trace_game_offset())
            ),
        );
        ui.checkbox(&mut app.trace_prefer_actions, "prefer actions");
        ui.checkbox(&mut app.trace_deep, "deep");
        ui.checkbox(&mut app.trace_loose_parity, "loose parity");
        ui.colored_label(theme::FG_3, format!("fmt {}", app.trace_variant));
        if !app.trace_commanders.is_empty() {
            ui.colored_label(
                theme::FG_3,
                format!(
                    "cmdr {}",
                    shorten_list(&app.trace_commanders.join(" / "), 44)
                ),
            );
        }

        ui.separator();
        if ui.button("Load .txt…").clicked() {
            if let Some(path) = rfd::FileDialog::new()
                .add_filter("Forge card script", &["txt"])
                .pick_file()
            {
                match std::fs::read_to_string(&path) {
                    Ok(text) => {
                        app.source = text;
                        app.current_path = Some(path);
                        app.load_error = None;
                        app.selected_card = None;
                    }
                    Err(err) => app.load_error = Some(format!("{err}")),
                }
            }
        }
        if ui.button("Open archive…").clicked() {
            if let Some(path) = rfd::FileDialog::new()
                .add_filter("rkyv archive", &["rkyv"])
                .pick_file()
            {
                app.load_archive(path);
            }
        }
        if ui.button("Reload archive").clicked() {
            app.load_archive(app.archive_path.clone());
        }

        ui.separator();
        if ui.button("Open Java JAR…").clicked() {
            if let Some(path) = rfd::FileDialog::new()
                .add_filter("Java archive", &["jar"])
                .pick_file()
            {
                app.java_jar_path = path;
                app.prewarm_java_server();
            }
        }
        if ui.button("Detect Java JAR").clicked() {
            if let Some(path) = discover_java_jar(Some(&app.java_jar_path)) {
                app.java_jar_path = path;
                app.trace_error = None;
                app.prewarm_java_server();
            } else {
                app.trace_error = Some(
                    "Java harness not found. Use Build Java harness or Open Java JAR…".to_string(),
                );
            }
        }
        if ui
            .add_enabled(
                !app.trace_running && !app.java_harness_building,
                egui::Button::new("Build Java harness"),
            )
            .clicked()
        {
            app.build_java_harness();
        }
        if ui
            .add_enabled(
                !app.trace_running && !app.java_harness_building,
                egui::Button::new("Run trace"),
            )
            .clicked()
        {
            app.run_sample_trace();
        }
        if ui.button("Clear trace").clicked() {
            app.trace = None;
            app.trace_error = None;
            app.trace_running = false;
            app.trace_status = None;
        }

        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            let java_ready = resolved_existing_path(&app.java_jar_path).is_some();
            let java_status = if java_ready {
                "java ready"
            } else if app.java_harness_building {
                "java building"
            } else {
                "java missing"
            };
            ui.colored_label(
                if java_ready {
                    theme::GREEN
                } else if app.java_harness_building {
                    theme::YELLOW
                } else {
                    theme::RED
                },
                java_status,
            );
        });
    });
}

fn render_status_bar(ui: &mut egui::Ui, app: &App) {
    let (rust_snapshots, java_snapshots) = app.snapshot_counts();
    ui.horizontal(|ui| {
        ui.colored_label(theme::GREEN, "●");
        ui.label("forge-parity rust+java");
        ui.colored_label(theme::BORDER_STRONG, "│");
        let selected_count = app
            .active_trace_pane_ref()
            .map(|pane| pane.selected_snapshot.saturating_add(1))
            .unwrap_or(0);
        ui.label(format!(
            "frame {selected_count} · rust {rust_snapshots} · java {java_snapshots}"
        ));
        ui.colored_label(theme::BORDER_STRONG, "│");
        ui.label(
            app.trace
                .as_ref()
                .map(|trace| format!("matchup seed {}", trace.seed))
                .unwrap_or_else(|| "matchup idle".to_string()),
        );
        if matches!(app.trace_mode, TraceMode::Compare) {
            ui.colored_label(theme::BORDER_STRONG, "│");
            let progress = app
                .trace
                .as_ref()
                .and_then(|trace| trace.comparison.as_ref())
                .map(|comparison| {
                    if comparison.snapshots_compared == 0 {
                        0.0
                    } else {
                        ((comparison.snapshots_compared - comparison.per_snapshot.len()) as f32
                            / comparison.snapshots_compared as f32)
                            .clamp(0.0, 1.0)
                    }
                })
                .unwrap_or(0.0);
            ui.label("parity");
            let (rect, _) = ui.allocate_exact_size(egui::vec2(80.0, 4.0), egui::Sense::hover());
            ui.painter().rect_filled(rect, 0.0, theme::BG_3);
            ui.painter().rect_filled(
                egui::Rect::from_min_max(
                    rect.min,
                    egui::pos2(rect.left() + rect.width() * progress, rect.bottom()),
                ),
                0.0,
                theme::ACCENT,
            );
            ui.label(format!("{:.0}%", progress * 100.0));
        }
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.colored_label(
                theme::FG_3,
                if app.trace_follow_live {
                    "selection follows live"
                } else {
                    "selection LOCKED"
                },
            );
        });
    });
}

fn render_toolbar_popovers(ctx: &egui::Context, app: &mut App) {
    let Some(which) = app.toolbar_popover else {
        return;
    };
    if ctx.input(|input| input.key_pressed(egui::Key::Escape)) {
        app.toolbar_popover = None;
        return;
    }

    let screen_rect = ctx.screen_rect();
    let top = theme::MENU_BAR_HEIGHT + theme::TOOLBAR_HEIGHT;
    let (width, right_offset) = match which {
        ToolbarPopover::RunConfig => (
            480.0,
            if matches!(app.trace_mode, TraceMode::Java | TraceMode::Compare) {
                116.0
            } else {
                8.0
            },
        ),
        ToolbarPopover::Java => (360.0, 8.0),
    };
    let popup_rect = egui::Rect::from_min_size(
        egui::pos2(
            screen_rect.right() - right_offset - width,
            screen_rect.top() + top,
        ),
        egui::vec2(
            width,
            if matches!(which, ToolbarPopover::RunConfig) {
                320.0
            } else {
                220.0
            },
        ),
    );

    if !app.toolbar_popover_just_opened && ctx.input(|i| i.pointer.any_click()) {
        if let Some(pos) = ctx.input(|i| i.pointer.latest_pos()) {
            if !popup_rect.contains(pos) {
                app.toolbar_popover = None;
                return;
            }
        }
    }

    egui::Area::new(egui::Id::new(match which {
        ToolbarPopover::RunConfig => "toolbar_run_area",
        ToolbarPopover::Java => "toolbar_java_area",
    }))
    .order(egui::Order::Foreground)
    .fixed_pos(popup_rect.min)
    .show(ctx, |ui| {
        ui.set_width(width);
        match which {
            ToolbarPopover::RunConfig => render_run_config_popup(ui, app),
            ToolbarPopover::Java => render_java_popup(ui, app),
        }
    });
    app.toolbar_popover_just_opened = false;
}

fn render_deck_modal(ctx: &egui::Context, app: &mut App) {
    if !app.deck_modal_open {
        return;
    }
    if ctx.input(|input| input.key_pressed(egui::Key::Escape)) {
        app.deck_modal_open = false;
        return;
    }

    let screen_rect = ctx.screen_rect();
    let layer_id = egui::LayerId::new(egui::Order::Foreground, egui::Id::new("deck_modal"));
    let painter = ctx.layer_painter(layer_id);
    painter.rect_filled(screen_rect, 0.0, egui::Color32::from_black_alpha(180));

    let mut close_modal = false;
    egui::Area::new(egui::Id::new("deck_modal_area"))
        .order(egui::Order::Foreground)
        .anchor(egui::Align2::CENTER_TOP, egui::vec2(0.0, 80.0))
        .show(ctx, |ui| {
            egui::Frame::none()
                .fill(theme::BG_1)
                .stroke(egui::Stroke::new(1.0, theme::BORDER_STRONG))
                .inner_margin(egui::Margin {
                    left: 14.0,
                    right: 14.0,
                    top: 10.0,
                    bottom: 10.0,
                })
                .show(ui, |ui| {
                    ui.set_width(620.0);
                    ui.set_max_height(screen_rect.height() * 0.7);

                    ui.horizontal(|ui| {
                        ui.label(
                            egui::RichText::new("Open archive or preset deck")
                                .size(11.0)
                                .color(theme::FG_2),
                        );
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            if ui.button("×").clicked() {
                                close_modal = true;
                            }
                        });
                    });
                    ui.separator();
                    ui.horizontal(|ui| {
                        ui.colored_label(theme::FG_3, "🔍");
                        ui.add_sized(
                            [520.0, 22.0],
                            egui::TextEdit::singleline(&mut app.deck_modal_query)
                                .hint_text("search archives, presets, or paste a path…"),
                        );
                        ui.colored_label(theme::FG_3, "esc");
                    });
                    ui.separator();

                    let query = app.deck_modal_query.to_ascii_lowercase();
                    let mut recent_archives = vec![app.archive_path.clone()];
                    let default_archive = PathBuf::from(DEFAULT_ARCHIVE_PATH);
                    if !recent_archives.iter().any(|path| path == &default_archive) {
                        recent_archives.push(default_archive);
                    }

                    egui::ScrollArea::vertical()
                        .max_height(screen_rect.height() * 0.5)
                        .auto_shrink([false, false])
                        .show(ui, |ui| {
                            ui.colored_label(theme::FG_3, "Recent archives");
                            for (index, path) in recent_archives.iter().enumerate() {
                                let label = path
                                    .file_name()
                                    .and_then(|value| value.to_str())
                                    .unwrap_or("archive");
                                if !query.is_empty() && !label.to_ascii_lowercase().contains(&query)
                                {
                                    continue;
                                }
                                let selected = *path == app.archive_path;
                                if selectable_modal_row(
                                    ui,
                                    label,
                                    &format!(
                                        "{} cards",
                                        app.archive
                                            .as_ref()
                                            .map_or(0, |archive| archive.archive().cards.len())
                                    ),
                                    &format!("⌘{}", index + 1),
                                    selected,
                                )
                                .clicked()
                                {
                                    app.load_archive(path.clone());
                                    close_modal = true;
                                }
                            }

                            ui.add_space(10.0);
                            ui.colored_label(theme::FG_3, "Preset decks");
                            let preset_rows: Vec<(usize, String, String, String)> = app
                                .trace_presets
                                .iter()
                                .enumerate()
                                .map(|(idx, preset)| {
                                    (
                                        idx,
                                        preset.name.clone(),
                                        preset.deck1.clone(),
                                        preset.deck2.clone(),
                                    )
                                })
                                .collect();
                            for (idx, name, deck1, deck2) in preset_rows {
                                let searchable =
                                    format!("{} {} {}", name, deck1, deck2).to_ascii_lowercase();
                                if !query.is_empty() && !searchable.contains(&query) {
                                    continue;
                                }
                                let selected = idx == app.selected_trace_preset;
                                if selectable_modal_row(
                                    ui,
                                    &name,
                                    &format!("{} vs {}", deck1, deck2),
                                    "↵",
                                    selected,
                                )
                                .clicked()
                                {
                                    app.apply_trace_preset(idx);
                                    close_modal = true;
                                }
                            }
                        });

                    ui.separator();
                    ui.horizontal(|ui| {
                        ui.colored_label(theme::FG_3, "↑↓ navigate");
                        ui.colored_label(theme::FG_3, "↵ open");
                        ui.colored_label(theme::FG_3, "esc close");
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            if ui.button("+ Browse for .rkdb…").clicked() {
                                if let Some(path) = rfd::FileDialog::new()
                                    .add_filter("rkyv archive", &["rkyv", "rkdb"])
                                    .pick_file()
                                {
                                    app.load_archive(path);
                                    close_modal = true;
                                }
                            }
                        });
                    });
                });
        });

    if ctx.input(|i| i.pointer.any_click()) {
        if let Some(pos) = ctx.input(|i| i.pointer.latest_pos()) {
            let modal_rect = egui::Rect::from_center_size(
                egui::pos2(screen_rect.center().x, screen_rect.top() + 80.0 + 200.0),
                egui::vec2(620.0, 420.0),
            );
            if !modal_rect.contains(pos) {
                close_modal = true;
            }
        }
    }
    if close_modal {
        app.deck_modal_open = false;
    }
}

fn selectable_modal_row(
    ui: &mut egui::Ui,
    name: &str,
    description: &str,
    shortcut: &str,
    selected: bool,
) -> egui::Response {
    let (rect, response) =
        ui.allocate_exact_size(egui::vec2(ui.available_width(), 40.0), egui::Sense::click());
    let fill = if selected {
        theme::ACCENT_BG
    } else if response.hovered() {
        theme::BG_2
    } else {
        theme::BG_1
    };
    ui.painter().rect_filled(rect, 0.0, fill);
    if selected {
        ui.painter().rect_filled(
            egui::Rect::from_min_max(rect.min, egui::pos2(rect.left() + 2.0, rect.bottom())),
            0.0,
            theme::ACCENT,
        );
    }
    let mut row_ui = ui.new_child(
        egui::UiBuilder::new()
            .max_rect(rect.shrink2(egui::vec2(12.0, 6.0)))
            .layout(egui::Layout::left_to_right(egui::Align::Center)),
    );
    row_ui.vertical(|ui| {
        ui.label(egui::RichText::new(name).color(theme::FG_0).strong());
        ui.colored_label(theme::FG_3, description);
    });
    row_ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
        ui.colored_label(theme::FG_3, shortcut);
    });
    response
}

fn render_section_frame(
    ui: &mut egui::Ui,
    id: &str,
    height: f32,
    title: &str,
    add_contents: impl FnOnce(&mut egui::Ui),
) {
    render_section_frame_with_meta(ui, id, height, title, None, add_contents);
}

fn render_section_frame_with_meta(
    ui: &mut egui::Ui,
    id: &str,
    height: f32,
    title: &str,
    meta: Option<&str>,
    add_contents: impl FnOnce(&mut egui::Ui),
) {
    let available_width = ui.available_width();
    let panel_height = height.max(theme::PANEL_HEADER_HEIGHT + 40.0);
    let panel_size = egui::vec2(available_width, panel_height);
    let (rect, _) = ui.allocate_exact_size(panel_size, egui::Sense::hover());
    ui.painter().rect_filled(rect, 0.0, theme::BG_FLOAT);
    ui.painter()
        .rect_stroke(rect, 0.0, egui::Stroke::new(1.0, theme::BORDER_SUBTLE));

    let header_rect = egui::Rect::from_min_size(
        rect.min,
        egui::vec2(rect.width(), theme::PANEL_HEADER_HEIGHT),
    );
    ui.painter().rect_filled(header_rect, 0.0, theme::BG_1);
    ui.painter().hline(
        header_rect.x_range(),
        header_rect.bottom(),
        egui::Stroke::new(1.0, theme::BORDER_SUBTLE),
    );

    let body_rect = egui::Rect::from_min_max(
        egui::pos2(
            rect.left() + theme::PANEL_SIDE_PADDING,
            header_rect.bottom() + theme::PANEL_TOP_PADDING,
        ),
        egui::pos2(
            rect.right() - theme::PANEL_SIDE_PADDING,
            rect.bottom() - theme::PANEL_TOP_PADDING,
        ),
    );

    let mut header_ui = ui.new_child(
        egui::UiBuilder::new()
            .max_rect(header_rect.shrink2(egui::vec2(theme::PANEL_HEADER_INSET, 2.0)))
            .layout(egui::Layout::left_to_right(egui::Align::Center)),
    );
    header_ui.spacing_mut().item_spacing.x = 6.0;
    header_ui.label(
        egui::RichText::new(title.to_uppercase())
            .size(theme::SMALL_TEXT_SIZE)
            .color(theme::FG_2)
            .strong()
            .text_style(egui::TextStyle::Small),
    );
    header_ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
        if let Some(meta) = meta {
            let color = if meta.contains("RUST") {
                theme::RUST
            } else if meta.contains("JAVA") {
                theme::JAVA
            } else if meta == "error" {
                theme::RED
            } else {
                theme::FG_3
            };
            ui.colored_label(
                color,
                egui::RichText::new(meta).size(theme::SMALL_TEXT_SIZE),
            );
        }
    });

    let mut body_ui = ui.new_child(
        egui::UiBuilder::new()
            .max_rect(body_rect)
            .layout(egui::Layout::top_down(egui::Align::Min)),
    );
    body_ui.set_min_width(body_rect.width());
    body_ui.set_width(body_rect.width());
    body_ui.set_min_height(body_rect.height());
    body_ui.push_id(id, |ui| {
        add_contents(ui);
    });
}

fn drag_height_handle(ui: &mut egui::Ui, height: &mut f32) {
    let desired_size = egui::vec2(ui.available_width(), 10.0);
    let (rect, response) = ui.allocate_exact_size(desired_size, egui::Sense::drag());
    if response.dragged() {
        *height = (*height + response.drag_delta().y).clamp(140.0, 900.0);
    }
    ui.painter().rect_filled(rect, 0.0, theme::BG_0);
    let stroke_color = if response.dragged() || response.hovered() {
        theme::ACCENT
    } else {
        theme::BORDER
    };
    let line_rect = rect.shrink2(egui::vec2(18.0, 3.0));
    ui.painter().hline(
        line_rect.x_range(),
        line_rect.center().y,
        egui::Stroke::new(1.0, stroke_color),
    );
}

fn render_trace(
    ui: &mut egui::Ui,
    trace: &mut Option<TraceSession>,
    trace_error: Option<&str>,
    trace_running: bool,
    trace_status: Option<&str>,
    search_query: &str,
    trace_follow_live: &mut bool,
) {
    if trace_running {
        ui.horizontal(|ui| {
            ui.spinner();
            ui.weak(trace_status.unwrap_or("Running trace…"));
        });
    } else if let Some(status) = trace_status {
        ui.weak(status);
    }
    if let Some(err) = trace_error {
        ui.colored_label(egui::Color32::LIGHT_RED, err);
    }

    let Some(trace) = trace.as_mut() else {
        let rect = ui.available_rect_before_wrap();
        let center = rect.center();
        let box_rect = egui::Rect::from_center_size(center, egui::vec2(436.0, 108.0));
        ui.allocate_rect(rect, egui::Sense::hover());
        ui.painter().rect_filled(box_rect, 0.0, theme::BG_1);
        ui.painter()
            .rect_stroke(box_rect, 0.0, egui::Stroke::new(1.0, theme::BORDER_SUBTLE));
        let mut empty_ui = ui.new_child(
            egui::UiBuilder::new()
                .max_rect(box_rect.shrink2(egui::vec2(14.0, 12.0)))
                .layout(egui::Layout::top_down(egui::Align::Min)),
        );
        empty_ui.colored_label(
            theme::FG_0,
            egui::RichText::new("Run a trace").size(11.0).strong(),
        );
        empty_ui.add_space(4.0);
        empty_ui.colored_label(
            theme::FG_2,
            "Pick a regression preset or enter arbitrary deck specs in the matchup strip.",
        );
        empty_ui.add_space(8.0);
        empty_ui.colored_label(theme::FG_3, "Rust / Java / Side-by-side parity inspection");
        return;
    };

    ui.horizontal_wrapped(|ui| {
        ui.weak(format!("seed: {}", trace.seed));
        ui.weak(format!("max turns: {}", trace.max_turns));
        ui.weak(format!("mode: {}", trace.mode.label()));
    });
    ui.weak(format!("deck1: {}", trace.deck1));
    ui.weak(format!("deck2: {}", trace.deck2));

    if let Some(comparison) = trace.comparison.clone() {
        ui.separator();
        render_comparison_summary(ui, trace, &comparison, trace_follow_live);
    }

    ui.separator();
    match trace.mode {
        TraceMode::Rust => {
            if let Some(pane) = trace.rust.as_mut() {
                render_trace_pane(
                    ui,
                    pane,
                    TracePaneKind::Rust,
                    trace.comparison.as_ref(),
                    search_query,
                    trace_follow_live,
                );
            } else {
                ui.weak("(no Rust trace)");
            }
        }
        TraceMode::Java => {
            if let Some(pane) = trace.java.as_mut() {
                render_trace_pane(
                    ui,
                    pane,
                    TracePaneKind::Java,
                    trace.comparison.as_ref(),
                    search_query,
                    trace_follow_live,
                );
            } else {
                ui.weak("(no Java trace)");
            }
        }
        TraceMode::Compare => {
            if trace.rust.is_some() || trace.java.is_some() {
                render_compare_trace_pane(ui, trace, search_query, trace_follow_live);
            } else {
                ui.weak("(no trace)");
            }
        }
    }
}

pub(crate) fn render_selection_highlight_frame(
    ui: &mut egui::Ui,
    selected: bool,
    label: Option<String>,
    add_contents: impl FnOnce(&mut egui::Ui),
) {
    let frame = egui::Frame::none()
        .fill(if selected { theme::BG_1 } else { theme::BG_0 })
        .inner_margin(egui::Margin::same(6.0))
        .stroke(egui::Stroke::new(
            if selected { 1.5 } else { 1.0 },
            if selected {
                theme::ACCENT
            } else {
                theme::BORDER
            },
        ));
    frame.show(ui, |ui| {
        if let Some(label) = label {
            ui.colored_label(theme::ACCENT, label);
            ui.add_space(4.0);
        }
        add_contents(ui);
    });
}

fn render_comparison_summary(
    ui: &mut egui::Ui,
    trace: &mut TraceSession,
    comparison: &TraceComparison,
    trace_follow_live: &mut bool,
) {
    ui.horizontal_wrapped(|ui| {
        let status = if comparison.passed() {
            ("PASS", egui::Color32::LIGHT_GREEN)
        } else {
            ("FAIL", egui::Color32::LIGHT_RED)
        };
        ui.colored_label(status.1, format!("Parity {}", status.0));
        ui.weak(format!(
            "snapshots compared: {}",
            comparison.snapshots_compared
        ));
        ui.weak(format!("divergences: {}", comparison.per_snapshot.len()));
    });

    if let Some(divergence) = comparison.first_divergence.as_ref() {
        egui::Frame::group(ui.style()).show(ui, |ui| {
            ui.horizontal_wrapped(|ui| {
                ui.colored_label(
                    egui::Color32::LIGHT_RED,
                    format!("First divergence at #{}", divergence.snapshot_index),
                );
                ui.strong(&divergence.field);
                if ui.button("Jump to diff").clicked() {
                    jump_to_compare_divergence(trace, divergence, trace_follow_live);
                }
            });
            ui.horizontal(|ui| {
                ui.label("Rust");
                ui.monospace(&divergence.rust_value);
            });
            ui.horizontal(|ui| {
                ui.label("Java");
                ui.monospace(&divergence.java_value);
            });
        });

        if comparison.per_snapshot.len() > 1 {
            ui.separator();
            ui.label("Divergence timeline");
            egui::ScrollArea::vertical()
                .id_salt("comparison_divergence_list")
                .max_height(140.0)
                .show(ui, |ui| {
                    for divergence in comparison.per_snapshot.iter().take(24) {
                        let label = format!(
                            "#{}  T{}  {}  {}",
                            divergence.snapshot_index,
                            divergence.turn,
                            divergence.phase,
                            divergence.field
                        );
                        if ui
                            .selectable_label(
                                false,
                                egui::RichText::new(label).color(egui::Color32::LIGHT_RED),
                            )
                            .clicked()
                        {
                            jump_to_compare_divergence(trace, divergence, trace_follow_live);
                        }
                        ui.horizontal(|ui| {
                            ui.small("Rust");
                            ui.monospace(&divergence.rust_value);
                        });
                        ui.horizontal(|ui| {
                            ui.small("Java");
                            ui.monospace(&divergence.java_value);
                        });
                        ui.separator();
                    }
                });
        }

        if let (Some(rust), Some(java)) = (trace.rust.as_ref(), trace.java.as_ref()) {
            ui.separator();
            render_divergence_investigation(ui, rust, java, divergence);
        }
    } else {
        ui.small("No snapshot divergences detected.");
    }
}

fn render_divergence_investigation(
    ui: &mut egui::Ui,
    rust: &TracePaneState,
    java: &TracePaneState,
    divergence: &Divergence,
) {
    let (rust_window, java_window) = extract_investigation_window(
        &rust.log_entries,
        &java.log_entries,
        divergence.snapshot_index,
    );
    let paired = pair_investigation_rows(rust_window, java_window);
    ui.label("Parity investigation window");
    ui.small(format!(
        "Snapshot #{} · events leading into the divergent frame",
        divergence.snapshot_index
    ));
    if paired.is_empty() {
        ui.colored_label(theme::FG_3, "(no paired log entries in window)");
        return;
    }

    egui::ScrollArea::vertical()
        .id_salt(("comparison_investigation", divergence.snapshot_index))
        .max_height(220.0)
        .auto_shrink([false, false])
        .show(ui, |ui| {
            for row in paired {
                render_investigation_row(ui, &row);
            }
        });
}

fn jump_to_comparison_snapshot(
    trace: &mut TraceSession,
    snapshot_index: usize,
    trace_follow_live: &mut bool,
) {
    *trace_follow_live = false;
    let rows = trace.compare_rows();
    if let Some(row_index) = rows.iter().position(|row| {
        row.rust_index == Some(snapshot_index) || row.java_index == Some(snapshot_index)
    }) {
        trace.compare_selected_row = row_index;
    }
    if let Some(rust) = trace.rust.as_mut() {
        rust.selected_snapshot = snapshot_index.min(rust.snapshots.len().saturating_sub(1));
        rust.pending_timeline_scroll = true;
    }
    if let Some(java) = trace.java.as_mut() {
        java.selected_snapshot = snapshot_index.min(java.snapshots.len().saturating_sub(1));
        java.pending_timeline_scroll = true;
    }
}

fn jump_to_snapshot(
    trace: &mut TraceSession,
    mode: TraceMode,
    pane_kind: TracePaneKind,
    snapshot_index: usize,
    trace_follow_live: &mut bool,
) {
    *trace_follow_live = false;
    match mode {
        TraceMode::Compare => jump_to_comparison_snapshot(trace, snapshot_index, trace_follow_live),
        TraceMode::Rust | TraceMode::Java => {
            let pane = trace.pane_mut(pane_kind);
            pane.selected_snapshot = snapshot_index.min(pane.snapshots.len().saturating_sub(1));
            pane.pending_timeline_scroll = true;
        }
    }
}

fn render_trace_minimap(
    ui: &mut egui::Ui,
    trace: &mut TracePaneState,
    comparison: Option<&TraceComparison>,
) {
    let rows = unique_phase_rows(&trace.snapshots);
    if rows.is_empty() {
        return;
    }
    let desired_size = egui::vec2(ui.available_width(), 18.0);
    let (rect, response) = ui.allocate_exact_size(desired_size, egui::Sense::click());
    ui.painter().rect_filled(rect, 0.0, theme::BG_1);
    let len = rows.len().max(1);
    let selected_row = selected_phase_row_index(trace, &rows);
    let tick_width = (rect.width() / len as f32).max(2.0);
    for (idx, (key, _snapshot_index)) in rows.iter().enumerate() {
        let min = egui::pos2(rect.left() + idx as f32 * tick_width, rect.top());
        let max = egui::pos2((min.x + tick_width - 1.0).min(rect.right()), rect.bottom());
        let tick_rect = egui::Rect::from_min_max(min, max);
        let divergence = divergence_for_phase(comparison, key);
        let color = if divergence.is_some() {
            theme::RED
        } else {
            theme::BG_3
        };
        ui.painter().rect_filled(tick_rect, 0.0, color);
        if idx == selected_row {
            ui.painter().rect_stroke(
                tick_rect.shrink(0.5),
                0.0,
                egui::Stroke::new(1.0, theme::ACCENT),
            );
        }
    }
    if response.clicked() {
        if let Some(pointer) = response.interact_pointer_pos() {
            let index = (((pointer.x - rect.left()) / rect.width()) * len as f32)
                .floor()
                .clamp(0.0, (len.saturating_sub(1)) as f32) as usize;
            trace.selected_snapshot = rows[index].1;
            trace.pending_timeline_scroll = true;
        }
    }
}

fn render_compare_trace_pane(
    ui: &mut egui::Ui,
    trace: &mut TraceSession,
    search_query: &str,
    trace_follow_live: &mut bool,
) {
    let Some(primary) = trace.rust.as_ref().or(trace.java.as_ref()) else {
        ui.weak("(no trace)");
        return;
    };
    let rows = trace.compare_rows();
    let display_rows = compare_rows_for_display(trace, &rows, *trace_follow_live);

    ui.horizontal_wrapped(|ui| {
        if let Some(rust) = trace.rust.as_ref() {
            ui.colored_label(
                theme::ACCENT,
                format!("rust {} snapshots", rust.snapshots.len()),
            );
            ui.weak(format!("{} decisions", rust.decision_count()));
            ui.weak(format!("{} callbacks", rust.callback_count()));
        }
        if let Some(java) = trace.java.as_ref() {
            ui.colored_label(
                theme::GREEN,
                format!("java {} snapshots", java.snapshots.len()),
            );
            ui.weak(format!("{} decisions", java.decision_count()));
            ui.weak(format!("{} callbacks", java.callback_count()));
        }
    });

    if primary.snapshots.is_empty() || display_rows.is_empty() {
        ui.weak("(no snapshots)");
        return;
    }

    render_compare_trace_minimap(ui, trace, &display_rows, trace_follow_live);
    ui.add_space(6.0);
    egui::ScrollArea::vertical()
        .id_salt(("trace_timeline", "compare"))
        .auto_shrink([false, false])
        .show(ui, |ui| {
            render_compare_timeline_rows(ui, trace, &display_rows, search_query, trace_follow_live);
        });
}

fn render_compare_trace_minimap(
    ui: &mut egui::Ui,
    trace: &mut TraceSession,
    rows: &[ComparePhaseRow],
    trace_follow_live: &mut bool,
) {
    if rows.is_empty() {
        return;
    }
    let desired_size = egui::vec2(ui.available_width(), 18.0);
    let (rect, response) = ui.allocate_exact_size(desired_size, egui::Sense::click());
    ui.painter().rect_filled(rect, 0.0, theme::BG_1);
    let len = rows.len().max(1);
    let selected_row = selected_compare_row_index(trace, rows);
    let divergence_row = trace
        .comparison
        .as_ref()
        .and_then(|comparison| divergence_row_index(trace, rows, comparison));
    let tick_width = (rect.width() / len as f32).max(2.0);
    for (idx, row) in rows.iter().enumerate() {
        let min = egui::pos2(rect.left() + idx as f32 * tick_width, rect.top());
        let max = egui::pos2((min.x + tick_width - 1.0).min(rect.right()), rect.bottom());
        let tick_rect = egui::Rect::from_min_max(min, max);
        let _ = row;
        let color = if Some(idx) == divergence_row {
            theme::RED
        } else {
            theme::BG_3
        };
        ui.painter().rect_filled(tick_rect, 0.0, color);
        if idx == selected_row {
            ui.painter().rect_stroke(
                tick_rect.shrink(0.5),
                0.0,
                egui::Stroke::new(1.0, theme::ACCENT),
            );
        }
    }
    if response.clicked() {
        if let Some(pointer) = response.interact_pointer_pos() {
            let index = (((pointer.x - rect.left()) / rect.width()) * len as f32)
                .floor()
                .clamp(0.0, (len.saturating_sub(1)) as f32) as usize;
            jump_to_compare_row(trace, rows, index, trace_follow_live);
        }
    }
}

fn render_trace_pane(
    ui: &mut egui::Ui,
    trace: &mut TracePaneState,
    pane_kind: TracePaneKind,
    comparison: Option<&TraceComparison>,
    search_query: &str,
    trace_follow_live: &mut bool,
) {
    ui.horizontal_wrapped(|ui| {
        ui.weak(format!("snapshots: {}", trace.snapshots.len()));
        ui.weak(format!("decisions: {}", trace.decision_count()));
        ui.weak(format!("callbacks: {}", trace.callback_count()));
    });

    if trace.snapshots.is_empty() {
        ui.weak("(no snapshots)");
        return;
    }
    render_trace_minimap(ui, trace, comparison);
    ui.add_space(6.0);
    egui::ScrollArea::vertical()
        .id_salt(("trace_timeline", pane_kind.label()))
        .auto_shrink([false, false])
        .show(ui, |ui| {
            render_timeline_rows(ui, trace, comparison, search_query, trace_follow_live);
        });
}

fn render_timeline_rows(
    ui: &mut egui::Ui,
    trace: &mut TracePaneState,
    comparison: Option<&TraceComparison>,
    search_query: &str,
    trace_follow_live: &mut bool,
) {
    let rows = unique_phase_rows(&trace.snapshots);
    if rows.is_empty() {
        return;
    }
    let mut consumed_scroll = false;
    let mut last_turn = None;
    let needle = search_query.trim().to_ascii_lowercase();
    let selected_row = selected_phase_row_index(trace, &rows);
    for (idx, (key, snapshot_index)) in rows.iter().enumerate() {
        let snap = &trace.snapshots[*snapshot_index];
        let phase_label = short_phase_label(&key.phase);
        let divergence = divergence_for_phase(comparison, key);
        let searchable = format!(
            "#{idx} t{} {} p{} {}",
            key.turn,
            phase_label,
            key.priority_player,
            divergence.map(|d| d.field.as_str()).unwrap_or("")
        )
        .to_ascii_lowercase();
        if !needle.is_empty() && !searchable.contains(&needle) {
            continue;
        }
        if last_turn != Some(key.turn) {
            let (divider_rect, divider_response) = ui
                .allocate_exact_size(egui::vec2(ui.available_width(), 18.0), egui::Sense::click());
            let divider_bg = if divider_response.hovered() {
                theme::BG_HOVER
            } else {
                theme::BG_1
            };
            ui.painter().rect_filled(divider_rect, 0.0, divider_bg);
            ui.painter().hline(
                divider_rect.x_range(),
                divider_rect.bottom(),
                egui::Stroke::new(1.0, theme::BORDER),
            );
            let mut divider_ui = ui.new_child(
                egui::UiBuilder::new()
                    .max_rect(divider_rect.shrink2(egui::vec2(8.0, 1.0)))
                    .layout(egui::Layout::left_to_right(egui::Align::Center)),
            );
            divider_ui.colored_label(theme::FG_0, format!("Turn {}", key.turn));
            divider_ui.colored_label(theme::FG_3, "·");
            divider_ui.colored_label(theme::FG_3, &key.phase);
            divider_response
                .clone()
                .on_hover_cursor(egui::CursorIcon::PointingHand);
            if divider_response.clicked() {
                *trace_follow_live = false;
                trace.selected_snapshot = *snapshot_index;
                trace.pending_timeline_scroll = true;
            }
            last_turn = Some(key.turn);
        }
        let (row_rect, response) =
            ui.allocate_exact_size(egui::vec2(ui.available_width(), 22.0), egui::Sense::click());
        let selected = selected_row == idx;
        let background = if selected {
            theme::ACCENT_BG
        } else if divergence.is_some() {
            egui::Color32::from_rgb(66, 36, 36)
        } else if response.hovered() {
            theme::BG_HOVER
        } else {
            theme::BG_0
        };
        ui.painter().rect_filled(row_rect, 0.0, background);
        if selected {
            ui.painter().rect_filled(
                egui::Rect::from_min_max(
                    row_rect.left_top(),
                    egui::pos2(row_rect.left() + 2.0, row_rect.bottom()),
                ),
                0.0,
                theme::ACCENT,
            );
        } else if response.hovered() {
            ui.painter().rect_stroke(
                row_rect.shrink(0.5),
                0.0,
                egui::Stroke::new(1.0, theme::BORDER_STRONG),
            );
        }
        let mut row_ui = ui.new_child(
            egui::UiBuilder::new()
                .max_rect(row_rect.shrink2(egui::vec2(6.0, 2.0)))
                .layout(egui::Layout::left_to_right(egui::Align::Center)),
        );
        row_ui.spacing_mut().item_spacing.x = 8.0;
        row_ui.colored_label(
            if divergence.is_some() {
                theme::RED
            } else {
                theme::FG_3
            },
            "●",
        );
        row_ui.colored_label(theme::FG_3, format!("#{:02}", idx));
        row_ui.colored_label(theme::FG_2, format!("T{}", key.turn));
        row_ui.colored_label(row_kind_color(&key.phase), phase_label);
        row_ui.label(format!("P{}", key.priority_player));
        if let Some(divergence) = divergence {
            row_ui.colored_label(theme::RED, "△ DIVERGE");
            row_ui.small(&divergence.field);
        } else if selected {
            row_ui.colored_label(theme::ACCENT, "▶");
        }
        if let Some(divergence) = divergence {
            response.clone().on_hover_text(format!(
                "{}\nRust: {}\nJava: {}",
                divergence.field, divergence.rust_value, divergence.java_value
            ));
        }
        response
            .clone()
            .on_hover_cursor(egui::CursorIcon::PointingHand);
        if response.clicked() {
            *trace_follow_live = false;
            trace.selected_snapshot = *snapshot_index;
            trace.pending_timeline_scroll = true;
        }
        if !consumed_scroll && trace.pending_timeline_scroll && selected {
            response.scroll_to_me(Some(egui::Align::Center));
            consumed_scroll = true;
        }
    }
    if consumed_scroll {
        trace.pending_timeline_scroll = false;
    }
}

fn render_compare_timeline_rows(
    ui: &mut egui::Ui,
    trace: &mut TraceSession,
    rows: &[ComparePhaseRow],
    search_query: &str,
    trace_follow_live: &mut bool,
) {
    if rows.is_empty() {
        return;
    }
    let needle = search_query.trim().to_ascii_lowercase();
    let selected_row = selected_compare_row_index(trace, rows);
    let pending_scroll = trace
        .rust
        .as_ref()
        .is_some_and(|pane| pane.pending_timeline_scroll)
        || trace
            .java
            .as_ref()
            .is_some_and(|pane| pane.pending_timeline_scroll);
    let divergence_row = trace
        .comparison
        .as_ref()
        .and_then(|comparison| divergence_row_index(trace, rows, comparison));
    let mut consumed_scroll = false;
    let mut last_turn = None;

    for (idx, row) in rows.iter().enumerate() {
        let phase_label = short_phase_label(&row.key.phase);
        let occurrence = compare_row_occurrence(rows, idx);
        let divergence = if Some(idx) == divergence_row {
            trace
                .comparison
                .as_ref()
                .and_then(|comparison| comparison.first_divergence.as_ref())
        } else {
            None
        };
        let divergence_field = divergence.map(|d| d.field.clone()).unwrap_or_default();
        let divergence_hover = divergence.map(|d| {
            format!(
                "{}\nRust: {}\nJava: {}",
                d.field, d.rust_value, d.java_value
            )
        });
        let has_divergence = divergence.is_some();
        let searchable = format!(
            "#{idx} t{} {} p{} {}",
            row.key.turn, phase_label, row.key.priority_player, divergence_field
        )
        .to_ascii_lowercase();
        if !needle.is_empty() && !searchable.contains(&needle) {
            continue;
        }

        if last_turn != Some(row.key.turn) {
            let (divider_rect, divider_response) = ui
                .allocate_exact_size(egui::vec2(ui.available_width(), 18.0), egui::Sense::click());
            let divider_bg = if divider_response.hovered() {
                theme::BG_HOVER
            } else {
                theme::BG_1
            };
            ui.painter().rect_filled(divider_rect, 0.0, divider_bg);
            ui.painter().hline(
                divider_rect.x_range(),
                divider_rect.bottom(),
                egui::Stroke::new(1.0, theme::BORDER),
            );
            let mut divider_ui = ui.new_child(
                egui::UiBuilder::new()
                    .max_rect(divider_rect.shrink2(egui::vec2(8.0, 1.0)))
                    .layout(egui::Layout::left_to_right(egui::Align::Center)),
            );
            divider_ui.colored_label(theme::FG_0, format!("Turn {}", row.key.turn));
            divider_ui.colored_label(theme::FG_3, "·");
            divider_ui.colored_label(theme::FG_3, &row.key.phase);
            if divider_response.clicked() {
                jump_to_compare_row(trace, rows, idx, trace_follow_live);
            }
            last_turn = Some(row.key.turn);
        }

        let (row_rect, response) =
            ui.allocate_exact_size(egui::vec2(ui.available_width(), 22.0), egui::Sense::click());
        let selected = selected_row == idx;
        let background = if selected {
            theme::ACCENT_BG
        } else if has_divergence {
            egui::Color32::from_rgb(66, 36, 36)
        } else if response.hovered() {
            theme::BG_HOVER
        } else {
            theme::BG_0
        };
        ui.painter().rect_filled(row_rect, 0.0, background);
        if selected {
            ui.painter().rect_filled(
                egui::Rect::from_min_max(
                    row_rect.left_top(),
                    egui::pos2(row_rect.left() + 2.0, row_rect.bottom()),
                ),
                0.0,
                theme::ACCENT,
            );
        }
        let mut row_ui = ui.new_child(
            egui::UiBuilder::new()
                .max_rect(row_rect.shrink2(egui::vec2(6.0, 2.0)))
                .layout(egui::Layout::left_to_right(egui::Align::Center)),
        );
        row_ui.spacing_mut().item_spacing.x = 8.0;
        row_ui.colored_label(
            if has_divergence {
                theme::RED
            } else {
                theme::FG_3
            },
            "●",
        );
        row_ui.colored_label(theme::FG_3, format!("#{:02}", idx));
        row_ui.colored_label(theme::FG_2, format!("T{}", row.key.turn));
        row_ui.colored_label(row_kind_color(&row.key.phase), phase_label);
        row_ui.label(format!("P{}", row.key.priority_player));
        if occurrence > 1 {
            row_ui.colored_label(theme::FG_3, format!("·{}", occurrence));
        }
        if row.rust_index.is_none() {
            row_ui.colored_label(theme::RUST, "rust ·");
        }
        if row.java_index.is_none() {
            row_ui.colored_label(theme::JAVA, "java ·");
        }
        if has_divergence {
            row_ui.colored_label(theme::RED, "△ DIVERGE");
            row_ui.small(&divergence_field);
        } else if selected {
            row_ui.colored_label(theme::ACCENT, "▶");
        }
        if let Some(hover_text) = divergence_hover.as_deref() {
            response.clone().on_hover_text(hover_text);
        }
        if response.clicked() {
            jump_to_compare_row(trace, rows, idx, trace_follow_live);
        }
        if !consumed_scroll && pending_scroll && selected && idx == selected_row {
            response.scroll_to_me(Some(egui::Align::Center));
            consumed_scroll = true;
        }
    }

    if consumed_scroll {
        if let Some(rust) = trace.rust.as_mut() {
            rust.pending_timeline_scroll = false;
        }
        if let Some(java) = trace.java.as_mut() {
            java.pending_timeline_scroll = false;
        }
    }
}

fn short_phase_label(phase: &str) -> String {
    phase
        .replace("Beginning", "Begin")
        .replace("DeclareAttackers", "Attack")
        .replace("DeclareBlockers", "Block")
        .replace("CombatFirstStrikeDamage", "FirstStrike")
}

fn row_kind_color(phase: &str) -> egui::Color32 {
    if phase.contains("Combat") {
        theme::VIOLET
    } else if phase.contains("Main") {
        theme::FG_0
    } else {
        theme::FG_2
    }
}

fn render_snapshot(
    ui: &mut egui::Ui,
    snap: &StateSnapshot,
    archive: Option<&ArchiveState>,
    selected_card_name: Option<&str>,
    selected_card: &mut Option<InspectedCard>,
) {
    ui.horizontal_wrapped(|ui| {
        ui.strong(format!("Turn {}", snap.turn));
        ui.label(&snap.phase);
        ui.weak(format!("active: P{}", snap.active_player));
        ui.weak(format!("priority: P{}", snap.priority_player));
        if snap.game_over {
            ui.colored_label(
                egui::Color32::LIGHT_RED,
                format!(
                    "game over: {}",
                    snap.winner
                        .map(|winner| format!("P{winner}"))
                        .unwrap_or_else(|| "draw".to_string())
                ),
            );
        }
    });

    for player in &snap.players {
        ui.separator();
        ui.horizontal_wrapped(|ui| {
            ui.strong(format!("P{} {}", player.index, player.name));
            ui.weak(format!("life {}", player.life));
            ui.weak(format!("poison {}", player.poison));
            ui.weak(format!("hand {}", player.hand.len()));
            ui.weak(format!("library {}", player.library_size));
        });

        if !player.battlefield.is_empty() {
            ui.label("Battlefield");
            render_battlefield_strip(
                ui,
                &player.battlefield,
                archive,
                selected_card_name,
                selected_card,
            );
            for card in &player.battlefield {
                let mut summary = card.name.clone();
                if card.tapped {
                    summary.push_str(" (T)");
                }
                if let (Some(power), Some(toughness)) = (card.power, card.toughness) {
                    summary.push_str(&format!(" {power}/{toughness}"));
                }
                if card.damage > 0 {
                    summary.push_str(&format!(" dmg={}", card.damage));
                }
                if !card.counters.is_empty() {
                    summary.push_str(&format!(" counters={:?}", card.counters));
                }
                render_selectable_card_row(
                    ui,
                    &summary,
                    &card.name,
                    archive,
                    selected_card_name == Some(card.name.as_str()),
                    selected_card,
                );
            }
        }

        if !player.hand.is_empty() {
            ui.label("Hand");
            render_hand_strip(ui, &player.hand, archive, selected_card_name, selected_card);
        }
        if !player.graveyard.is_empty() {
            ui.label(format!("Graveyard: {}", player.graveyard.join(", ")));
        }
        if !player.exile.is_empty() {
            ui.label(format!("Exile: {}", player.exile.join(", ")));
        }
    }

    ui.separator();
    if snap.stack.is_empty() {
        ui.weak("Stack: empty");
    } else {
        ui.label("Stack");
        for item in &snap.stack {
            ui.monospace(item);
        }
    }
}

fn render_snapshot_shell(
    ui: &mut egui::Ui,
    trace: &Option<TraceSession>,
    mode: TraceMode,
    archive: Option<&ArchiveState>,
    selected_card: &mut Option<InspectedCard>,
) {
    egui::ScrollArea::vertical()
        .auto_shrink([false, false])
        .show(ui, |ui| {
            let Some(trace) = trace.as_ref() else {
                ui.colored_label(theme::FG_3, "Run a trace to inspect a snapshot.");
                return;
            };
            match mode {
                TraceMode::Compare => {
                    let rows = compare_rows_for_display(trace, &trace.compare_rows(), false);
                    let (selected_rust, selected_java) =
                        compare_selected_snapshot_indices(trace, &rows);
                    if ui.available_width() < 520.0 {
                        if let Some(rust) = trace.rust.as_ref() {
                            render_snapshot_column(
                                ui,
                                "Rust",
                                Some(theme::RUST),
                                rust,
                                selected_rust,
                                trace.java.as_ref(),
                                selected_java,
                                archive,
                                selected_card,
                            );
                            ui.add_space(8.0);
                        }
                        if let Some(java) = trace.java.as_ref() {
                            render_snapshot_column(
                                ui,
                                "Java",
                                Some(theme::JAVA),
                                java,
                                selected_java,
                                trace.rust.as_ref(),
                                selected_rust,
                                archive,
                                selected_card,
                            );
                        }
                    } else {
                        ui.columns(2, |columns| {
                            if let Some(rust) = trace.rust.as_ref() {
                                render_snapshot_column(
                                    &mut columns[0],
                                    "Rust",
                                    Some(theme::RUST),
                                    rust,
                                    selected_rust,
                                    trace.java.as_ref(),
                                    selected_java,
                                    archive,
                                    selected_card,
                                );
                            }
                            if let Some(java) = trace.java.as_ref() {
                                render_snapshot_column(
                                    &mut columns[1],
                                    "Java",
                                    Some(theme::JAVA),
                                    java,
                                    selected_java,
                                    trace.rust.as_ref(),
                                    selected_rust,
                                    archive,
                                    selected_card,
                                );
                            }
                        });
                    }
                }
                TraceMode::Rust => {
                    if let Some(rust) = trace.rust.as_ref() {
                        render_snapshot_column(
                            ui,
                            "Rust",
                            Some(theme::RUST),
                            rust,
                            None,
                            None,
                            None,
                            archive,
                            selected_card,
                        );
                    }
                }
                TraceMode::Java => {
                    if let Some(java) = trace.java.as_ref() {
                        render_snapshot_column(
                            ui,
                            "Java",
                            Some(theme::JAVA),
                            java,
                            None,
                            None,
                            None,
                            archive,
                            selected_card,
                        );
                    }
                }
            }
        });
}

fn render_snapshot_column(
    ui: &mut egui::Ui,
    title: &str,
    backend_color: Option<egui::Color32>,
    pane: &TracePaneState,
    selected_snapshot_index: Option<usize>,
    other: Option<&TracePaneState>,
    other_snapshot_index: Option<usize>,
    archive: Option<&ArchiveState>,
    selected_card: &mut Option<InspectedCard>,
) {
    let selected_index = selected_snapshot_index.unwrap_or(pane.selected_snapshot);
    let Some(snapshot) = pane.snapshots.get(selected_index) else {
        ui.colored_label(theme::FG_3, "(no snapshot)");
        return;
    };
    let other_snapshot = other.and_then(|pane| {
        pane.snapshots
            .get(other_snapshot_index.unwrap_or(pane.selected_snapshot))
    });
    ui.horizontal_wrapped(|ui| {
        ui.colored_label(theme::ACCENT, format!("Turn {}", snapshot.turn));
        render_snapshot_pill(
            ui,
            &format!("{} · P{}", snapshot.phase, snapshot.priority_player),
            theme::FG_2,
            theme::BORDER,
        );
        render_snapshot_pill(
            ui,
            &format!("active P{}", snapshot.active_player),
            theme::ACCENT,
            theme::ACCENT,
        );
        if let Some(color) = backend_color {
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                render_snapshot_pill(ui, title, color, color);
            });
        }
    });
    ui.add_space(4.0);
    let selected_card_name = selected_card.as_ref().map(|card| card.name.clone());
    for player in &snapshot.players {
        let other_player = other_snapshot.and_then(|snapshot| {
            snapshot
                .players
                .iter()
                .find(|candidate| candidate.index == player.index)
        });
        render_snapshot_player_block(
            ui,
            player,
            other_player,
            snapshot.active_player,
            archive,
            selected_card_name.as_deref(),
            selected_card,
        );
        ui.add_space(4.0);
    }
    if !snapshot.stack.is_empty() {
        ui.colored_label(theme::FG_3, egui::RichText::new("Stack").size(10.0));
        for item in &snapshot.stack {
            ui.label(egui::RichText::new(item).size(10.0).color(theme::FG_1));
        }
    }
}

fn render_snapshot_player_block(
    ui: &mut egui::Ui,
    player: &forge_parity::protocol::PlayerSnapshot,
    other: Option<&forge_parity::protocol::PlayerSnapshot>,
    active_player: u32,
    archive: Option<&ArchiveState>,
    selected_card_name: Option<&str>,
    selected_card: &mut Option<InspectedCard>,
) {
    let frame = theme::panel_frame()
        .fill(theme::BG_1)
        .stroke(egui::Stroke::new(
            if player.index == active_player {
                2.0
            } else {
                1.0
            },
            if player.index == active_player {
                theme::ACCENT
            } else {
                theme::BORDER
            },
        ))
        .inner_margin(egui::Margin {
            left: 8.0,
            right: 8.0,
            top: 5.0,
            bottom: 5.0,
        });
    frame.show(ui, |ui| {
        ui.horizontal_wrapped(|ui| {
            ui.colored_label(theme::ACCENT, format!("P{}", player.index));
            ui.label(egui::RichText::new(&player.name).size(11.0).strong());
            render_metric(
                ui,
                format!("{} life", player.life),
                other.is_some_and(|other| other.life != player.life),
            );
            render_metric(ui, format!("hand {}", player.hand.len()), false);
            render_metric(ui, format!("lib {}", player.library_size), false);
            render_metric(ui, format!("grave {}", player.graveyard.len()), false);
        });
        if !player.battlefield.is_empty() {
            ui.horizontal(|ui| {
                ui.colored_label(theme::FG_3, egui::RichText::new("Battlefield").size(10.0));
                ui.colored_label(theme::FG_2, format!("[{}]", player.battlefield.len()));
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.colored_label(
                        theme::FG_3,
                        egui::RichText::new("tap to inspect").size(10.0),
                    );
                });
            });
            render_battlefield_strip(
                ui,
                &player.battlefield,
                archive,
                selected_card_name,
                selected_card,
            );
        }
        if !player.hand.is_empty() {
            ui.add_space(4.0);
            ui.horizontal(|ui| {
                ui.colored_label(theme::FG_3, egui::RichText::new("Hand").size(10.0));
                ui.colored_label(theme::FG_2, format!("[{}]", player.hand.len()));
            });
            render_hand_strip(ui, &player.hand, archive, selected_card_name, selected_card);
        }
    });
}

fn render_snapshot_pill(
    ui: &mut egui::Ui,
    text: &str,
    text_color: egui::Color32,
    border_color: egui::Color32,
) {
    egui::Frame::none()
        .fill(theme::BG_0)
        .stroke(egui::Stroke::new(1.0, border_color))
        .inner_margin(egui::Margin {
            left: 5.0,
            right: 5.0,
            top: 1.0,
            bottom: 1.0,
        })
        .show(ui, |ui| {
            ui.label(egui::RichText::new(text).size(10.0).color(text_color));
        });
}

fn render_metric(ui: &mut egui::Ui, text: String, divergent: bool) {
    if divergent {
        ui.colored_label(theme::RED, text);
    } else {
        ui.colored_label(theme::FG_2, text);
    }
}

fn render_event_row(
    ui: &mut egui::Ui,
    time: &str,
    kind: &str,
    payload: &str,
    stripe: egui::Color32,
    divergent: bool,
) {
    let payload = shorten_list(payload, 120);
    let (rect, response) =
        ui.allocate_exact_size(egui::vec2(ui.available_width(), 34.0), egui::Sense::hover());
    let fill = if divergent {
        egui::Color32::from_rgb(66, 36, 36)
    } else if response.hovered() {
        theme::BG_HOVER
    } else {
        theme::BG_0
    };
    ui.painter().rect_filled(rect, 0.0, fill);
    ui.painter().rect_filled(
        egui::Rect::from_min_max(rect.min, egui::pos2(rect.left() + 2.0, rect.bottom())),
        0.0,
        stripe,
    );
    let mut row_ui = ui.new_child(
        egui::UiBuilder::new()
            .max_rect(rect.shrink2(egui::vec2(8.0, 3.0)))
            .layout(egui::Layout::top_down(egui::Align::Min)),
    );
    row_ui.spacing_mut().item_spacing = egui::vec2(8.0, 2.0);
    row_ui.horizontal(|ui| {
        ui.add_sized(
            [52.0, 14.0],
            egui::Label::new(egui::RichText::new(time).size(9.5).color(theme::FG_3)),
        );
        render_snapshot_pill(ui, kind, stripe, stripe);
    });
    row_ui.label(
        egui::RichText::new(&payload)
            .size(10.0)
            .color(if divergent { theme::RED } else { theme::FG_0 }),
    );
    response.on_hover_text(payload);
}

fn render_event_card_frame(
    ui: &mut egui::Ui,
    stripe: egui::Color32,
    title: &str,
    subtitle: &str,
    add_contents: impl FnOnce(&mut egui::Ui),
) {
    let response = egui::Frame::none()
        .fill(theme::BG_0)
        .stroke(egui::Stroke::new(1.0, theme::BORDER_SUBTLE))
        .inner_margin(egui::Margin::same(6.0))
        .show(ui, |ui| {
            ui.horizontal_wrapped(|ui| {
                render_snapshot_pill(ui, title, stripe, stripe);
                ui.colored_label(theme::FG_2, subtitle);
            });
            ui.add_space(4.0);
            add_contents(ui);
        });
    let rect = response.response.rect;
    ui.painter().rect_filled(
        egui::Rect::from_min_max(rect.min, egui::pos2(rect.left() + 2.0, rect.bottom())),
        0.0,
        stripe,
    );
}

fn render_callback_event_card(ui: &mut egui::Ui, callback: &CallbackRecord) {
    if callback.name == "$ACTION_SPACE" {
        render_action_space_event_card(ui, callback);
        return;
    }
    render_event_card_frame(
        ui,
        theme::GREEN,
        "CALLBACK",
        &format!(
            "P{} · {} · snapshot {}",
            callback.player, callback.phase, callback.snapshot_index
        ),
        |ui| {
            ui.horizontal_wrapped(|ui| {
                ui.label(
                    egui::RichText::new(&callback.name)
                        .monospace()
                        .color(theme::FG_0)
                        .strong(),
                );
                ui.colored_label(theme::FG_3, "→");
                ui.label(
                    egui::RichText::new(&callback.outcome)
                        .monospace()
                        .color(theme::FG_1),
                );
            });

            if !callback.callback_args.is_empty() {
                ui.add_space(4.0);
                ui.label(
                    egui::RichText::new("Callback args")
                        .size(theme::SMALL_TEXT_SIZE)
                        .color(theme::FG_3),
                );
                for arg in &callback.callback_args {
                    ui.add(
                        egui::Label::new(egui::RichText::new(arg).monospace().color(theme::FG_1))
                            .wrap(),
                    );
                }
            }

            if !callback.args.is_empty() {
                ui.add_space(4.0);
                ui.push_id(
                    (
                        "callback_choice_space",
                        callback.snapshot_index,
                        callback.player,
                        callback.name.as_str(),
                        callback.timestamp_ms,
                    ),
                    |ui| {
                        egui::CollapsingHeader::new(format!(
                            "Choice space ({})",
                            callback.args.len()
                        ))
                        .default_open(true)
                        .show(ui, |ui| {
                            for arg in &callback.args {
                                ui.label(layout_ansi_text(&arg.format(), theme::FG_1));
                            }
                        });
                    },
                );
            }
        },
    );
    ui.add_space(6.0);
}

/// Surface the legal-action snapshot the agent saw at this priority pass.
///
/// The parity harness emits `$ACTION_SPACE` callbacks with `outcome` formatted as
/// `[#0 <choice> | #1 <choice> | ... | PASS]` (or `SKIPPED stack_depth>=N` when
/// the action space is intentionally not enumerated, e.g. deep stacks). We
/// render the choice list as a vertical bullet list rather than as one wrapped
/// blob so each option is independently scannable.
fn render_action_space_event_card(ui: &mut egui::Ui, callback: &CallbackRecord) {
    render_event_card_frame(
        ui,
        theme::ACCENT,
        "ACTION SPACE",
        &format!(
            "P{} · {} · snapshot {}",
            callback.player, callback.phase, callback.snapshot_index
        ),
        |ui| {
            let raw = callback.outcome.trim();
            // Skip path: harness emits "SKIPPED <reason>" when it bails on enumeration.
            if let Some(reason) = raw.strip_prefix("SKIPPED") {
                ui.label(
                    egui::RichText::new(format!("skipped:{}", reason))
                        .monospace()
                        .italics()
                        .color(theme::FG_3),
                );
                return;
            }
            // Strip the surrounding `[...]` brackets if present.
            let body = raw
                .strip_prefix('[')
                .and_then(|s| s.strip_suffix(']'))
                .unwrap_or(raw);
            let choices: Vec<&str> = body
                .split('|')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .collect();
            if choices.is_empty() {
                ui.colored_label(theme::FG_3, "(no choices)");
                return;
            }
            for choice in choices {
                let is_pass = choice == "PASS";
                let color = if is_pass { theme::FG_2 } else { theme::FG_0 };
                ui.add(
                    egui::Label::new(egui::RichText::new(choice).monospace().color(color)).wrap(),
                );
            }
        },
    );
    ui.add_space(6.0);
}

fn render_decision_event_card(
    ui: &mut egui::Ui,
    decision: &forge_parity::protocol::DecisionRecord,
) {
    render_event_card_frame(
        ui,
        theme::ACCENT,
        "PRIORITY",
        &format!("P{} · {}", decision.deciding_player, decision.phase),
        |ui| {
            ui.horizontal_wrapped(|ui| {
                ui.label(
                    egui::RichText::new(&decision.kind)
                        .monospace()
                        .color(theme::FG_0)
                        .strong(),
                );
                ui.colored_label(theme::FG_3, "→");
                ui.label(
                    egui::RichText::new(&decision.choice)
                        .monospace()
                        .color(theme::FG_1),
                );
            });
            if !decision.options.is_empty() {
                ui.add_space(4.0);
                ui.push_id(
                    (
                        "decision_options",
                        decision.turn,
                        decision.phase.as_str(),
                        decision.deciding_player,
                        decision.kind.as_str(),
                        decision.timestamp_ms,
                    ),
                    |ui| {
                        egui::CollapsingHeader::new(format!(
                            "Options ({})",
                            decision.options.len()
                        ))
                        .default_open(false)
                        .show(ui, |ui| {
                            for option in &decision.options {
                                ui.label(layout_ansi_text(&option.format(), theme::FG_1));
                            }
                        });
                    },
                );
            }
        },
    );
    ui.add_space(6.0);
}

fn render_event_shell(ui: &mut egui::Ui, trace: &Option<TraceSession>, mode: TraceMode) {
    let Some(trace) = trace.as_ref() else {
        ui.colored_label(theme::FG_3, "No active event stream.");
        return;
    };
    match mode {
        TraceMode::Compare => {
            let rows = compare_rows_for_display(trace, &trace.compare_rows(), false);
            let (selected_rust, selected_java) = compare_selected_snapshot_indices(trace, &rows);
            if ui.available_width() < 520.0 {
                if let Some(rust) = trace.rust.as_ref() {
                    render_related_log_shell(ui, rust, TracePaneKind::Rust, selected_rust);
                    ui.add_space(8.0);
                }
                if let Some(java) = trace.java.as_ref() {
                    render_related_log_shell(ui, java, TracePaneKind::Java, selected_java);
                }
            } else {
                ui.columns(2, |columns| {
                    if let Some(rust) = trace.rust.as_ref() {
                        render_related_log_shell(
                            &mut columns[0],
                            rust,
                            TracePaneKind::Rust,
                            selected_rust,
                        );
                    }
                    if let Some(java) = trace.java.as_ref() {
                        render_related_log_shell(
                            &mut columns[1],
                            java,
                            TracePaneKind::Java,
                            selected_java,
                        );
                    }
                });
            }
        }
        TraceMode::Rust => {
            if let Some(rust) = trace.rust.as_ref() {
                render_related_log_shell(ui, rust, TracePaneKind::Rust, None);
            }
        }
        TraceMode::Java => {
            if let Some(java) = trace.java.as_ref() {
                render_related_log_shell(ui, java, TracePaneKind::Java, None);
            }
        }
    }
}

fn shorten_list(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }
    let shortened: String = value.chars().take(limit.saturating_sub(1)).collect();
    format!("{shortened}…")
}

fn layout_source_galley(ui: &egui::Ui, source: &str, wrap_width: f32) -> Arc<egui::Galley> {
    let mut job = highlight_source_job(source);
    job.wrap.max_width = wrap_width;
    ui.fonts(|fonts| fonts.layout_job(job))
}

fn ansi_text_format(color: egui::Color32, strong: bool) -> egui::TextFormat {
    egui::TextFormat {
        font_id: egui::FontId::monospace(if strong { 11.0 } else { 10.5 }),
        color,
        ..Default::default()
    }
}

fn ansi_color_from_code(code: u8) -> egui::Color32 {
    match code {
        31 | 91 => theme::RED,
        32 | 92 => theme::GREEN,
        33 | 93 => theme::YELLOW,
        34 | 94 => theme::ACCENT,
        35 | 95 => theme::VIOLET,
        36 | 96 => theme::JAVA,
        37 | 97 => theme::FG_0,
        90 => theme::FG_3,
        _ => theme::FG_1,
    }
}

fn layout_ansi_text(text: &str, default_color: egui::Color32) -> egui::text::LayoutJob {
    let mut job = egui::text::LayoutJob::default();
    let mut current_color = default_color;
    let mut strong = false;
    let mut current = String::new();
    let bytes = text.as_bytes();
    let mut idx = 0usize;

    while idx < bytes.len() {
        if bytes[idx] == 0x1b && idx + 1 < bytes.len() && bytes[idx + 1] == b'[' {
            if !current.is_empty() {
                job.append(&current, 0.0, ansi_text_format(current_color, strong));
                current.clear();
            }
            idx += 2;
            let start = idx;
            while idx < bytes.len() && bytes[idx] != b'm' {
                idx += 1;
            }
            if idx >= bytes.len() {
                break;
            }
            let codes = &text[start..idx];
            for code in codes
                .split(';')
                .filter_map(|value| value.parse::<u8>().ok())
            {
                match code {
                    0 => {
                        current_color = default_color;
                        strong = false;
                    }
                    1 => strong = true,
                    22 => strong = false,
                    30..=37 | 90..=97 => current_color = ansi_color_from_code(code),
                    39 => current_color = default_color,
                    _ => {}
                }
            }
            idx += 1;
        } else {
            current.push(bytes[idx] as char);
            idx += 1;
        }
    }
    if !current.is_empty() {
        job.append(&current, 0.0, ansi_text_format(current_color, strong));
    }
    job.wrap.max_width = f32::INFINITY;
    job
}

fn render_related_log(
    ui: &mut egui::Ui,
    trace: &TracePaneState,
    pane_kind: TracePaneKind,
    snap: &StateSnapshot,
    snapshot_index: usize,
) {
    // Filter by turn only, not (turn, phase). Snapshots typically fire at
    // turn boundaries (e.g. Untap), but callbacks fire across all phases of
    // the turn (Main1, Main2, Upkeep, CombatBegin, …). A strict (turn, phase)
    // match would hide every non-Untap callback on every Untap snapshot —
    // including the new $ACTION_SPACE cards, which only emit at priority
    // passes. "What happened this turn" is the more useful unit anyway.
    let related_callbacks: Vec<&CallbackRecord> = trace
        .log_entries
        .iter()
        .filter_map(ParityLogEntry::as_callback)
        .filter(|callback| callback.turn == snap.turn)
        .collect();
    let related_decisions: Vec<_> = trace
        .log_entries
        .iter()
        .filter_map(ParityLogEntry::as_decision)
        .filter(|decision| decision.turn == snap.turn)
        .collect();

    egui::ScrollArea::both()
        .id_salt(("trace_events", pane_kind.label(), snapshot_index))
        .auto_shrink([false, false])
        .show(ui, |ui| {
            if related_callbacks.is_empty() && related_decisions.is_empty() {
                ui.colored_label(theme::FG_3, "No active event stream.");
                return;
            }

            ui.horizontal_wrapped(|ui| {
                ui.colored_label(theme::FG_3, format!("turn {}", snap.turn));
                if !related_callbacks.is_empty() {
                    ui.colored_label(
                        theme::GREEN,
                        format!("callbacks {}", related_callbacks.len()),
                    );
                }
                if !related_decisions.is_empty() {
                    ui.colored_label(
                        theme::ACCENT,
                        format!("decisions {}", related_decisions.len()),
                    );
                }
            });
            ui.add_space(4.0);

            for callback in related_callbacks {
                render_callback_event_card(ui, callback);
            }

            for decision in related_decisions {
                render_decision_event_card(ui, decision);
            }
        });
}

fn render_related_log_shell(
    ui: &mut egui::Ui,
    trace: &TracePaneState,
    pane_kind: TracePaneKind,
    snapshot_index: Option<usize>,
) {
    let selected_index = snapshot_index.unwrap_or(trace.selected_snapshot);
    let Some(snapshot) = trace.snapshots.get(selected_index) else {
        ui.colored_label(theme::FG_3, "(no events)");
        return;
    };
    render_related_log(ui, trace, pane_kind, snapshot, selected_index);
}

fn pair_investigation_rows(
    rust_entries: &[ParityLogEntry],
    java_entries: &[ParityLogEntry],
) -> Vec<(Option<String>, Option<String>, bool)> {
    let rust_keyed: Vec<(Option<CallbackKey>, String)> = rust_entries
        .iter()
        .map(|entry| {
            (
                CallbackKey::from_entry(entry),
                entry.format().trim_start().to_string(),
            )
        })
        .collect();
    let mut java_available: Vec<(Option<CallbackKey>, String, bool)> = java_entries
        .iter()
        .map(|entry| {
            (
                CallbackKey::from_entry(entry),
                entry.format().trim_start().to_string(),
                false,
            )
        })
        .collect();

    let mut rows = Vec::new();
    for (rust_key, rust_text) in &rust_keyed {
        let mut matched = false;
        let match_pos = match rust_key {
            Some(key) => java_available
                .iter()
                .position(|(java_key, _, used)| !used && java_key.as_ref() == Some(key)),
            None => java_available
                .iter()
                .position(|(java_key, _, used)| !used && java_key.is_none()),
        };
        if let Some(match_pos) = match_pos {
            for entry in java_available.iter_mut().take(match_pos) {
                if !entry.2 {
                    entry.2 = true;
                    rows.push((None, Some(entry.1.clone()), true));
                }
            }
            java_available[match_pos].2 = true;
            rows.push((
                Some(rust_text.clone()),
                Some(java_available[match_pos].1.clone()),
                false,
            ));
            matched = true;
        }
        if !matched {
            rows.push((Some(rust_text.clone()), None, true));
        }
    }

    for (_, java_text, used) in &java_available {
        if !*used {
            rows.push((None, Some(java_text.clone()), true));
        }
    }

    rows
}

fn render_investigation_row(ui: &mut egui::Ui, row: &(Option<String>, Option<String>, bool)) {
    let (rust_text, java_text, unmatched) = row;
    let stroke = if *unmatched {
        egui::Stroke::new(1.0, theme::RED)
    } else {
        egui::Stroke::new(1.0, theme::BORDER_SUBTLE)
    };
    egui::Frame::none()
        .fill(if *unmatched { theme::BG_1 } else { theme::BG_0 })
        .stroke(stroke)
        .inner_margin(egui::Margin::same(6.0))
        .show(ui, |ui| {
            ui.columns(2, |columns| {
                render_investigation_cell(
                    &mut columns[0],
                    "Rust",
                    rust_text.as_deref(),
                    *unmatched,
                );
                render_investigation_cell(
                    &mut columns[1],
                    "Java",
                    java_text.as_deref(),
                    *unmatched,
                );
            });
        });
}

fn render_investigation_cell(ui: &mut egui::Ui, label: &str, text: Option<&str>, unmatched: bool) {
    ui.vertical(|ui| {
        ui.colored_label(
            if unmatched { theme::RED } else { theme::FG_3 },
            egui::RichText::new(label).size(theme::SMALL_TEXT_SIZE),
        );
        match text {
            Some(text) => {
                ui.label(layout_ansi_text(
                    text,
                    if unmatched { theme::FG_0 } else { theme::FG_1 },
                ));
            }
            None => {
                ui.colored_label(theme::FG_3, "—");
            }
        }
    });
}

fn sample_trace_preset() -> TracePreset {
    TracePreset {
        name: "sample matchup".to_string(),
        deck1: TRACE_DECK_1.to_string(),
        deck2: TRACE_DECK_2.to_string(),
        seed: 42,
        max_turns: 5,
        games: 1,
        variant: "Constructed".to_string(),
        commanders: Vec::new(),
    }
}

fn load_trace_presets() -> Vec<TracePreset> {
    let mut presets = vec![sample_trace_preset()];
    let path = repo_relative_path(REGRESSION_JSON_PATH);
    let Ok(text) = std::fs::read_to_string(path) else {
        return presets;
    };
    let Ok(entries) = serde_json::from_str::<Vec<RegressionEntry>>(&text) else {
        return presets;
    };
    presets.extend(
        entries
            .into_iter()
            .filter_map(|entry| trace_preset_from_args(&entry.name, &entry.args)),
    );
    presets
}

fn trace_preset_from_args(name: &str, args: &str) -> Option<TracePreset> {
    let tokens = shlex::split(args)?;
    let mut deck1 = None;
    let mut deck2 = None;
    let mut seed = 42u64;
    let mut max_turns = 20u32;
    let mut games = 1u32;
    let mut variant = "Constructed".to_string();
    let mut commanders = Vec::new();
    let mut i = 0usize;
    while i < tokens.len() {
        match tokens[i].as_str() {
            "--deck1" => {
                i += 1;
                deck1 = tokens.get(i).cloned();
            }
            "--deck2" => {
                i += 1;
                deck2 = tokens.get(i).cloned();
            }
            "--seed" => {
                i += 1;
                if let Some(value) = tokens.get(i).and_then(|value| value.parse::<u64>().ok()) {
                    seed = value;
                }
            }
            "--max-turns" => {
                i += 1;
                if let Some(value) = tokens.get(i).and_then(|value| value.parse::<u32>().ok()) {
                    max_turns = value;
                }
            }
            "--games" => {
                i += 1;
                if let Some(value) = tokens.get(i).and_then(|value| value.parse::<u32>().ok()) {
                    games = value.max(1);
                }
            }
            "--variant" => {
                i += 1;
                if let Some(value) = tokens.get(i) {
                    variant = value.clone();
                }
            }
            "--commander" => {
                i += 1;
                if let Some(value) = tokens.get(i) {
                    commanders.push(value.clone());
                }
            }
            _ => {}
        }
        i += 1;
    }
    Some(TracePreset {
        name: name.to_string(),
        deck1: deck1?,
        deck2: deck2?,
        seed,
        max_turns,
        games,
        variant,
        commanders,
    })
}
