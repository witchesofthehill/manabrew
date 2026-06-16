//! Shared JSON protocol types for cross-engine differential testing.
//!
//! All types derive `Serialize` and `Deserialize` so both the Rust engine and
//! a future Java harness can exchange them as JSON over stdout/stdin.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

// ── Decision Points ────────────────────────────────────────────────

/// Emitted when a player must make a choice.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionPoint {
    pub turn: u32,
    pub phase: String,
    pub active_player: u32,
    pub deciding_player: u32,
    pub decision_type: DecisionType,
    pub options: DecisionOptions,
}

/// The kind of decision being requested.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DecisionType {
    Mulligan,
    MainPhaseAction,
    DeclareAttackers,
    DeclareBlockers,
    ChooseTargetPlayer,
    ChooseTargetCard,
    ChooseTargetAny,
    ChooseSacrifice,
    ChooseDiscard,
    ChooseScry,
    ChooseSurveil,
    ChooseMode,
    ChooseOptionalTrigger,
    ChooseLandOrSpell,
}

/// Available options for a decision, keyed by card/player name (not IDs).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DecisionOptions {
    /// Card names that can be played (main phase)
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub playable_cards: Vec<String>,
    /// Land names that can be tapped for mana
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub tappable_lands: Vec<String>,
    /// Creature names eligible to attack
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub attackers: Vec<String>,
    /// Creature names eligible to block
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub blockers: Vec<String>,
    /// Valid target player indices
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub valid_player_targets: Vec<u32>,
    /// Valid target card names
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub valid_card_targets: Vec<String>,
    /// Card names in hand (for discard decisions)
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub hand_cards: Vec<String>,
    /// Number of cards to discard
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub discard_count: Option<usize>,
    /// Mode descriptions (for modal spells)
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub mode_descriptions: Vec<String>,
    /// Min/max modes to pick
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub min_modes: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub max_modes: Option<usize>,
    /// Trigger description (for optional triggers)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub trigger_description: Option<String>,
}

/// A decision fed back to the engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum Decision {
    Mulligan { keep: bool },
    MainPhaseAction { action: String },
    DeclareAttackers { names: Vec<String> },
    DeclareBlockers { pairs: Vec<(String, String)> },
    ChooseTargetPlayer { player_id: u32 },
    ChooseTargetCard { name: String },
    ChooseTargetAny { target: TargetAnyChoice },
    ChooseSacrifice { name: String },
    ChooseDiscard { names: Vec<String> },
    ChooseScry { to_bottom: Vec<String> },
    ChooseSurveil { to_graveyard: Vec<String> },
    ChooseMode { indices: Vec<usize> },
    ChooseOptionalTrigger { accept: bool },
    ChooseLandOrSpell { land: Option<bool> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum TargetAnyChoice {
    Player { player_id: u32 },
    Card { name: String },
    None,
}

// ── State Snapshots ────────────────────────────────────────────────

/// Normalized game state for comparison between engines.
/// All lists are sorted alphabetically by card name for deterministic comparison.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StateSnapshot {
    pub turn: u32,
    pub phase: String,
    pub active_player: u32,
    pub priority_player: u32,
    pub game_over: bool,
    pub winner: Option<u32>,
    pub players: Vec<PlayerSnapshot>,
    pub stack: Vec<String>,
    #[serde(default)]
    pub timestamp_ms: u64,
}

/// Per-player state snapshot.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlayerSnapshot {
    pub name: String,
    pub index: u32,
    pub life: i32,
    pub poison: i32,
    pub lands_played: i32,
    pub has_lost: bool,
    pub has_won: bool,
    pub battlefield: Vec<CardSnapshot>,
    pub graveyard: Vec<String>,
    pub hand: Vec<String>,
    pub exile: Vec<String>,
    pub library_size: usize,
    /// Top N cards of the library in draw order (top first). Diagnostic field
    /// for detecting silent library-order divergences between Rust and Java;
    /// compared as an ordered list, not sorted.
    #[serde(default)]
    pub library_top: Vec<String>,
}

/// A card on the battlefield, normalized for comparison.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CardSnapshot {
    pub name: String,
    pub tapped: bool,
    pub power: Option<i32>,
    pub toughness: Option<i32>,
    pub damage: i32,
    pub summoning_sick: bool,
    pub counters: BTreeMap<String, i32>,
    pub controller: u32,
}

// ── Game Trace ─────────────────────────────────────────────────────

/// A complete record of a game: per-phase snapshots.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameTrace {
    pub seed: u64,
    pub deck1: String,
    pub deck2: String,
    pub max_turns: u32,
    /// Game variant (e.g., "Constructed", "Commander", "Oathbreaker").
    #[serde(default = "default_variant")]
    pub variant: String,
    /// Commander card names (for Commander variants).
    #[serde(default)]
    pub commanders: Vec<String>,
    pub log: Vec<ParityLogEntry>,
    /// Card names that were played/cast during the game.
    pub covered_cards: Vec<String>,
}

impl GameTrace {
    pub fn snapshots(&self) -> impl Iterator<Item = &StateSnapshot> {
        self.log.iter().filter_map(|e| e.as_snapshot())
    }

    pub fn callbacks(&self) -> impl Iterator<Item = &CallbackRecord> {
        self.log.iter().filter_map(|e| e.as_callback())
    }

    pub fn decisions(&self) -> impl Iterator<Item = &DecisionRecord> {
        self.log.iter().filter_map(|e| e.as_decision())
    }

    pub fn snapshot_vec(&self) -> Vec<StateSnapshot> {
        self.snapshots().cloned().collect()
    }

    pub fn callback_vec(&self) -> Vec<CallbackRecord> {
        self.callbacks().cloned().collect()
    }
}

fn default_variant() -> String {
    "Constructed".to_string()
}

pub trait ParityLog {
    fn turn(&self) -> u32;
    fn phase(&self) -> &str;
    fn player(&self) -> u32;
    fn kind(&self) -> &str;
    fn choice(&self) -> &str;
    fn options(&self) -> &[ChoiceLogEntry];
    fn callback_args(&self) -> &[String] {
        &[]
    }
    fn timestamp_ms(&self) -> u64;

    fn format(&self) -> String {
        let header = format!(
            "    T{}::{}::P{} \x1b[94m{}\x1b[0m -> {}",
            self.turn(),
            self.phase(),
            self.player(),
            self.kind(),
            self.choice(),
        );
        let opts = self.options();

        if opts.is_empty() {
            header
        } else {
            let mut lines = vec![header];
            for entry in opts {
                lines.push(format!("        {}", entry.format()));
            }
            lines.join("\n")
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DecisionRecord {
    pub turn: u32,
    pub phase: String,
    pub deciding_player: u32,
    pub kind: String,
    pub options: Vec<ChoiceLogEntry>,
    pub choice: String,
    #[serde(default)]
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChoiceLogEntry {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub choices: Option<usize>,
    pub outcome: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rng_call_count: Option<u64>,
}

impl ChoiceLogEntry {
    pub fn from_json(s: String) -> Self {
        serde_json::from_str::<ChoiceLogEntry>(&s).unwrap_or_else(|_| Self {
            name: s,
            choices: None,
            outcome: String::new(),
            rng_call_count: None,
        })
    }

    pub fn format(&self) -> String {
        let mut s = String::new();
        s.push_str(&self.name);
        if let Some(n) = self.choices {
            s.push_str(&format!("[{}]", n));
        }
        if !self.outcome.is_empty() {
            s.push_str(&format!(" -> {}", self.outcome));
        }
        if let Some(cc) = self.rng_call_count {
            s.push_str(&format!(" \x1b[33m{{{}}}\x1b[0m", cc));
        }
        s
    }
}

/// A callback record captured during game execution.
/// Groups by snapshot_index so we can show which callbacks happened
/// between two consecutive snapshots when a divergence is found.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallbackRecord {
    pub snapshot_index: usize,
    pub turn: u32,
    pub phase: String,
    pub player: u32,
    pub name: String,
    pub outcome: String,
    pub args: Vec<ChoiceLogEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub callback_args: Vec<String>,
    #[serde(default)]
    pub timestamp_ms: u64,
}

impl ParityLog for StateSnapshot {
    fn turn(&self) -> u32 {
        self.turn
    }
    fn phase(&self) -> &str {
        &self.phase
    }
    fn player(&self) -> u32 {
        self.active_player
    }
    fn kind(&self) -> &str {
        "snapshot"
    }
    fn choice(&self) -> &str {
        if self.game_over {
            "game_over"
        } else {
            "in_progress"
        }
    }
    fn options(&self) -> &[ChoiceLogEntry] {
        &[]
    }
    fn timestamp_ms(&self) -> u64 {
        self.timestamp_ms
    }
}

impl ParityLog for DecisionRecord {
    fn turn(&self) -> u32 {
        self.turn
    }
    fn phase(&self) -> &str {
        &self.phase
    }
    fn player(&self) -> u32 {
        self.deciding_player
    }
    fn kind(&self) -> &str {
        &self.kind
    }
    fn choice(&self) -> &str {
        &self.choice
    }
    fn options(&self) -> &[ChoiceLogEntry] {
        &self.options
    }
    fn timestamp_ms(&self) -> u64 {
        self.timestamp_ms
    }
}

impl ParityLog for CallbackRecord {
    fn turn(&self) -> u32 {
        self.turn
    }
    fn phase(&self) -> &str {
        &self.phase
    }
    fn player(&self) -> u32 {
        self.player
    }
    fn kind(&self) -> &str {
        &self.name
    }
    fn choice(&self) -> &str {
        &self.outcome
    }
    fn options(&self) -> &[ChoiceLogEntry] {
        &self.args
    }
    fn callback_args(&self) -> &[String] {
        &self.callback_args
    }
    fn timestamp_ms(&self) -> u64 {
        self.timestamp_ms
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "entry_type", rename_all = "snake_case")]
pub enum ParityLogEntry {
    Snapshot(StateSnapshot),
    Callback(CallbackRecord),
    Decision(DecisionRecord),
}

impl ParityLogEntry {
    pub fn as_snapshot(&self) -> Option<&StateSnapshot> {
        match self {
            Self::Snapshot(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_callback(&self) -> Option<&CallbackRecord> {
        match self {
            Self::Callback(c) => Some(c),
            _ => None,
        }
    }

    pub fn as_decision(&self) -> Option<&DecisionRecord> {
        match self {
            Self::Decision(d) => Some(d),
            _ => None,
        }
    }
}

impl ParityLog for ParityLogEntry {
    fn turn(&self) -> u32 {
        match self {
            Self::Snapshot(s) => s.turn(),
            Self::Callback(c) => c.turn(),
            Self::Decision(d) => d.turn(),
        }
    }
    fn phase(&self) -> &str {
        match self {
            Self::Snapshot(s) => s.phase(),
            Self::Callback(c) => c.phase(),
            Self::Decision(d) => d.phase(),
        }
    }
    fn player(&self) -> u32 {
        match self {
            Self::Snapshot(s) => s.player(),
            Self::Callback(c) => c.player(),
            Self::Decision(d) => d.player(),
        }
    }
    fn kind(&self) -> &str {
        match self {
            Self::Snapshot(s) => s.kind(),
            Self::Callback(c) => c.kind(),
            Self::Decision(d) => d.kind(),
        }
    }
    fn choice(&self) -> &str {
        match self {
            Self::Snapshot(s) => s.choice(),
            Self::Callback(c) => c.choice(),
            Self::Decision(d) => d.choice(),
        }
    }
    fn options(&self) -> &[ChoiceLogEntry] {
        match self {
            Self::Snapshot(s) => s.options(),
            Self::Callback(c) => c.options(),
            Self::Decision(d) => d.options(),
        }
    }
    fn callback_args(&self) -> &[String] {
        match self {
            Self::Snapshot(s) => s.callback_args(),
            Self::Callback(c) => c.callback_args(),
            Self::Decision(d) => d.callback_args(),
        }
    }
    fn timestamp_ms(&self) -> u64 {
        match self {
            Self::Snapshot(s) => s.timestamp_ms(),
            Self::Callback(c) => c.timestamp_ms(),
            Self::Decision(d) => d.timestamp_ms(),
        }
    }
}

// ── Parity Report ──────────────────────────────────────────────────

/// A divergence between Rust and Java engine state at a specific phase.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Divergence {
    pub snapshot_index: usize,
    pub turn: u32,
    pub phase: String,
    pub field: String,
    pub rust_value: String,
    pub java_value: String,
}

/// Full parity report comparing two engine runs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParityReport {
    pub seed: u64,
    pub deck1: String,
    pub deck2: String,
    pub total_snapshots: usize,
    pub divergences: Vec<Divergence>,
    pub passed: bool,
}

// ── Matrix Mode Types ──────────────────────────────────────────────

/// Status of a single matchup in matrix mode.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MatchupStatus {
    Pass,
    Skipped,
    Fail,
    Error,
}

/// Result of a single deck-pair + seed matchup.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchupResult {
    pub deck1: String,
    pub deck2: String,
    pub seed: u64,
    pub status: MatchupStatus,
    pub snapshots_compared: usize,
    pub divergence_count: usize,
    pub first_divergence: Option<Divergence>,
    pub error_message: Option<String>,
    pub skip_reason: Option<String>,
    /// The Rust snapshot at the point of divergence.
    pub rust_snapshot: Option<StateSnapshot>,
    /// The Java snapshot at the point of divergence.
    pub java_snapshot: Option<StateSnapshot>,
    /// Card names covered in this matchup (played/cast at least once).
    pub covered_cards: Vec<String>,
    #[serde(default)]
    pub rust_log: Vec<ParityLogEntry>,
    #[serde(default)]
    pub java_log: Vec<ParityLogEntry>,
    pub finished_turn: Option<u32>,
}

impl MatchupResult {
    pub fn error(config: &super::runner::RunConfig, message: String) -> Self {
        Self {
            deck1: config.deck1.clone(),
            deck2: config.deck2.clone(),
            seed: config.seed,
            status: MatchupStatus::Error,
            snapshots_compared: 0,
            divergence_count: 0,
            first_divergence: None,
            error_message: Some(message),
            skip_reason: None,
            rust_snapshot: None,
            java_snapshot: None,
            covered_cards: vec![],
            rust_log: vec![],
            java_log: vec![],
            finished_turn: None,
        }
    }

    pub fn skipped(config: &super::runner::RunConfig, reason: String) -> Self {
        Self {
            deck1: config.deck1.clone(),
            deck2: config.deck2.clone(),
            seed: config.seed,
            status: MatchupStatus::Skipped,
            snapshots_compared: 0,
            divergence_count: 0,
            first_divergence: None,
            error_message: None,
            skip_reason: Some(reason),
            rust_snapshot: None,
            java_snapshot: None,
            covered_cards: vec![],
            rust_log: vec![],
            java_log: vec![],
            finished_turn: None,
        }
    }
}

/// Aggregate report for all matchups in matrix mode.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatrixReport {
    pub total_matchups: usize,
    pub passed: usize,
    pub skipped: usize,
    pub failed: usize,
    pub errors: usize,
    pub seeds: Vec<u64>,
    pub decks: Vec<String>,
    pub max_turns: u32,
    pub results: Vec<MatchupResult>,
}

// ── Continuous Parity Types ──────────────────────────────────────

/// A single run record stored in the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunRecord {
    pub id: i64,
    pub batch_id: i64,
    pub deck1: String,
    pub deck2: String,
    pub seed: u64,
    pub status: MatchupStatus,
    pub snapshots_compared: usize,
    pub divergence_count: usize,
    pub first_divergence_field: Option<String>,
    pub first_divergence_rust: Option<String>,
    pub first_divergence_java: Option<String>,
    pub covered_cards: Vec<String>,
    pub duration_ms: u64,
    pub error_message: Option<String>,
    pub rust_trace: Option<String>,
    pub java_trace: Option<String>,
    pub is_fuzz: bool,
    pub timestamp: String,
    /// Git commit SHA that produced this run result.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_sha: Option<String>,
}

/// Aggregate statistics for the continuous parity server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContinuousStats {
    pub total_games: usize,
    pub passed: usize,
    pub failed: usize,
    pub errors: usize,
    pub pass_rate: f64,
    pub games_per_minute: f64,
    pub uptime_seconds: u64,
    pub current_batch: i64,
    pub fuzz_total: usize,
    pub fuzz_passed: usize,
    pub fuzz_failed: usize,
    pub fuzz_pass_rate: f64,
    /// Git commit SHA the server was built from.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_sha: Option<String>,
}

/// A single point in a time-series trend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrendPoint {
    pub bucket: String,
    pub total: usize,
    pub passed: usize,
    pub failed: usize,
    pub errors: usize,
    pub pass_rate: f64,
}

/// Deck pair heatmap entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeckPairStats {
    pub deck1: String,
    pub deck2: String,
    pub total: usize,
    pub passed: usize,
    pub failed: usize,
    pub errors: usize,
    pub pass_rate: f64,
}

// ── Fuzz Mode Types ──────────────────────────────────────────────

/// Result of a single fuzz iteration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FuzzResult {
    pub iteration: usize,
    pub game_seed: u64,
    /// Inline-format deck spec for player 1 (for reproducibility).
    pub deck1_spec: String,
    /// Inline-format deck spec for player 2 (for reproducibility).
    pub deck2_spec: String,
    pub result: MatchupResult,
}

/// Aggregate report for fuzz random deck testing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FuzzReport {
    pub master_seed: u64,
    pub iterations: usize,
    pub max_turns: u32,
    /// Number of cards in the discovered pool.
    pub pool_size: usize,
    /// Total cards in the database.
    pub total_cards: usize,
    pub passed: usize,
    pub failed: usize,
    pub errors: usize,
    pub results: Vec<FuzzResult>,
}
