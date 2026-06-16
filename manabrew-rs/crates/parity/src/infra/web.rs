//! Axum HTTP server for the continuous parity dashboard.
//!
//! Provides REST API endpoints and an embedded single-page dashboard.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{Html, IntoResponse, Json},
    routing::{get, post},
    Router,
};

use crate::infra::storage::Storage;
use crate::log_buffer::LogBuffer;

/// Runtime-adjustable configuration, shared between web server, game loop, and analyzer.
pub struct DashboardConfig {
    /// Games per matchup per batch (10, 30, or 40).
    pub games_per_matchup: AtomicUsize,
    /// Whether fuzz deck generation is enabled.
    pub fuzz_enabled: AtomicBool,
    /// Whether to include self-matchups (deck vs itself).
    pub self_matchups: AtomicBool,
    /// Current LLM model name.
    pub llm_model: Mutex<String>,
    /// Whether the analysis daemon is running (shared with analyzer).
    pub analysis_running: Arc<AtomicBool>,
    /// Whether the game runner is paused (queue jobs still run).
    pub games_paused: AtomicBool,
    /// Delay in ms between games (0 = no delay).
    pub game_delay_ms: AtomicUsize,
}

impl DashboardConfig {
    /// Create with sensible defaults. Analysis starts paused.
    pub fn new() -> Self {
        Self {
            games_per_matchup: AtomicUsize::new(1),
            fuzz_enabled: AtomicBool::new(false),
            self_matchups: AtomicBool::new(true),
            llm_model: Mutex::new(
                std::env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-4o-mini".into()),
            ),
            analysis_running: Arc::new(AtomicBool::new(false)),
            games_paused: AtomicBool::new(false),
            game_delay_ms: AtomicUsize::new(500),
        }
    }
}

/// Shared application state for the web server.
pub struct AppState {
    pub storage: Mutex<Storage>,
    pub start_time: std::time::Instant,
    pub start_time_iso: String,
    pub config: Arc<DashboardConfig>,
    pub logs: LogBuffer,
    pub job_queue: Arc<JobQueue>,
    /// Git commit SHA the server was built from.
    pub commit_sha: Option<String>,
    /// Deck name prefixes to exclude from stats (e.g. "real_").
    pub exclude_prefixes: Vec<String>,
}

#[derive(serde::Deserialize)]
pub struct TrendQuery {
    #[serde(default = "default_bucket")]
    bucket: String,
    #[serde(default = "default_limit")]
    limit: usize,
    /// Optional ISO-8601 timestamp; only include data from this time onwards.
    since: Option<String>,
}

fn default_bucket() -> String {
    "hour".into()
}

fn default_limit() -> usize {
    24
}

#[derive(serde::Deserialize)]
pub struct FailuresQuery {
    #[serde(default = "default_failures_limit")]
    limit: usize,
    /// Optional filter: only return failures matching this divergence field (normalized).
    field: Option<String>,
    /// Optional ISO-8601 timestamp; only include failures from this time onwards.
    since: Option<String>,
}

fn default_failures_limit() -> usize {
    50
}

/// Optional time filter used by matrix and other endpoints.
#[derive(serde::Deserialize)]
pub struct SinceQuery {
    /// Optional ISO-8601 timestamp; only include data from this time onwards.
    since: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct LogsQuery {
    /// Return entries with id > since (for incremental polling).
    #[serde(default)]
    since: u64,
    /// Max entries to return (default 200).
    #[serde(default = "default_logs_limit")]
    limit: usize,
}

fn default_logs_limit() -> usize {
    200
}

/// JSON shape for partial config updates.
#[derive(serde::Deserialize)]
struct ConfigUpdate {
    games_per_matchup: Option<usize>,
    fuzz_enabled: Option<bool>,
    self_matchups: Option<bool>,
    llm_model: Option<String>,
    games_paused: Option<bool>,
    game_delay_ms: Option<usize>,
}

/// JSON shape returned by GET /api/config.
#[derive(serde::Serialize)]
struct ConfigResponse {
    games_per_matchup: usize,
    fuzz_enabled: bool,
    self_matchups: bool,
    llm_model: String,
    analysis_running: bool,
    games_paused: bool,
    game_delay_ms: usize,
}

/// JSON shape returned by GET /api/analysis/status.
#[derive(serde::Serialize)]
struct AnalysisStatusResponse {
    running: bool,
    backend: String,
    model: String,
}

// ── CI Job Queue ─────────────────────────────────────────────────

/// A single matchup to execute via the job queue.
pub struct QueuedJob {
    pub batch_id: u64,
    pub regression_name: String,
    pub deck1: String,
    pub deck2: String,
    pub seed: u64,
    pub max_turns: u32,
    pub deep: bool,
    pub prefer_actions: bool,
    pub variant: String,
    pub commanders: Vec<String>,
}

/// Per-matchup result within a batch.
#[derive(serde::Serialize, Clone)]
pub struct JobResult {
    pub deck1: String,
    pub deck2: String,
    pub seed: u64,
    pub status: String,
    pub error: Option<String>,
    /// Divergence field name (e.g. "p1.life", "battlefield.count")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub divergence_field: Option<String>,
    /// Rust engine value at divergence
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rust_value: Option<String>,
    /// Java engine value at divergence
    #[serde(skip_serializing_if = "Option::is_none")]
    pub java_value: Option<String>,
    /// Turn/phase where divergence occurred
    #[serde(skip_serializing_if = "Option::is_none")]
    pub divergence_location: Option<String>,
    /// Full Rust engine trace (for diff output)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rust_trace: Option<String>,
    /// Full Java engine trace (for diff output)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub java_trace: Option<String>,
}

/// The matchup currently being executed for a batch.
#[derive(serde::Serialize, Clone)]
pub struct ActiveJob {
    pub regression_name: String,
    pub deck1: String,
    pub deck2: String,
    pub seed: u64,
    pub max_turns: u32,
}

/// Tracks progress of a submitted batch.
#[derive(serde::Serialize, Clone)]
pub struct BatchStatus {
    pub name: String,
    pub total: usize,
    pub completed: usize,
    pub passed: usize,
    pub skipped: usize,
    pub failed: usize,
    pub errors: usize,
    pub done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_job: Option<ActiveJob>,
    pub results: Vec<JobResult>,
}

impl BatchStatus {
    /// Maximum number of results kept in memory per batch.
    const MAX_RESULTS: usize = 500;

    /// Push a result, evicting the oldest passing results if over capacity.
    pub fn push_result(&mut self, result: JobResult) {
        self.results.push(result);
        if self.results.len() > Self::MAX_RESULTS {
            // Remove oldest passing/skipped results first to keep failures visible.
            if let Some(pos) = self
                .results
                .iter()
                .position(|r| r.status == "pass" || r.status == "skipped")
            {
                self.results.remove(pos);
            } else {
                self.results.remove(0);
            }
        }
    }
}

/// Thread-safe job queue shared between web handlers and game loop.
pub struct JobQueue {
    pub queue: Mutex<VecDeque<QueuedJob>>,
    pub batches: Mutex<HashMap<u64, BatchStatus>>,
    pub next_batch_id: AtomicU64,
}

impl JobQueue {
    pub fn new() -> Self {
        Self {
            queue: Mutex::new(VecDeque::new()),
            batches: Mutex::new(HashMap::new()),
            next_batch_id: AtomicU64::new(1),
        }
    }

    /// Remove completed batches older than `max_age`.
    pub fn cleanup_done_batches(&self, max_age: std::time::Duration) {
        // No timestamps on batches, so just remove all completed ones
        // when the map exceeds a size threshold.
        let _ = max_age;
        let mut batches = self.batches.lock().unwrap();
        if batches.len() <= 50 {
            return;
        }
        batches.retain(|_id, b| !b.done);
    }
}

/// JSON shape for a regression entry (matches regression.json format).
#[derive(serde::Deserialize)]
struct RegressionEntry {
    name: String,
    args: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ExpandedMatchup {
    deck1: String,
    deck2: String,
    seed: u64,
    max_turns: u32,
    deep: bool,
    prefer_actions: bool,
    variant: String,
    commanders: Vec<String>,
}

/// Split a shell-like argument string while honoring simple single/double quotes.
/// This is enough for regression.json `args` fields such as:
/// `--commander 'Neheb, the Worthy'`
fn tokenize_arg_string(args: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;

    for ch in args.chars() {
        match quote {
            Some(q) if ch == q => {
                quote = None;
            }
            Some(_) => cur.push(ch),
            None => {
                if ch == '\'' || ch == '"' {
                    quote = Some(ch);
                } else if ch.is_whitespace() {
                    if !cur.is_empty() {
                        out.push(std::mem::take(&mut cur));
                    }
                } else {
                    cur.push(ch);
                }
            }
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Expand a regression entry's args string into individual matchups.
fn expand_regression_entry(args: &str, default_max_turns: u32) -> Vec<ExpandedMatchup> {
    let tokens = tokenize_arg_string(args);

    let mut matrix = false;
    let mut seeds: Vec<u64> = Vec::new();
    let mut explicit_seeds = false;
    let mut decks: Vec<String> = Vec::new();
    let mut deck1: Option<String> = None;
    let mut deck2: Option<String> = None;
    let mut max_turns = default_max_turns;
    let mut games: usize = 1;
    let mut seed_start: u64 = 42;
    let mut deep = false;
    let mut prefer_actions = false;
    let mut variant = "Constructed".to_string();
    let mut commanders: Vec<String> = Vec::new();

    let mut i = 0;
    while i < tokens.len() {
        match tokens[i].as_str() {
            "--matrix" => matrix = true,
            "--deep" => deep = true,
            "--prefer-actions" => prefer_actions = true,
            "--seeds" => {
                if i + 1 < tokens.len() {
                    i += 1;
                    explicit_seeds = true;
                    seeds = tokens[i]
                        .split(',')
                        .filter_map(|s| s.parse().ok())
                        .collect();
                }
            }
            "--decks" => {
                if i + 1 < tokens.len() {
                    i += 1;
                    decks = tokens[i].split(',').map(|s| s.to_string()).collect();
                }
            }
            "--deck1" => {
                if i + 1 < tokens.len() {
                    i += 1;
                    deck1 = Some(tokens[i].to_string());
                }
            }
            "--deck2" => {
                if i + 1 < tokens.len() {
                    i += 1;
                    deck2 = Some(tokens[i].to_string());
                }
            }
            "--seed" => {
                if i + 1 < tokens.len() {
                    i += 1;
                    if let Ok(s) = tokens[i].parse() {
                        seed_start = s;
                    }
                }
            }
            "--max-turns" => {
                if i + 1 < tokens.len() {
                    i += 1;
                    if let Ok(t) = tokens[i].parse() {
                        max_turns = t;
                    }
                }
            }
            "--games" => {
                if i + 1 < tokens.len() {
                    i += 1;
                    if let Ok(g) = tokens[i].parse() {
                        games = g;
                    }
                }
            }
            "--variant" => {
                if i + 1 < tokens.len() {
                    i += 1;
                    variant = tokens[i].clone();
                }
            }
            "--commander" => {
                if i + 1 < tokens.len() {
                    i += 1;
                    commanders.push(tokens[i].clone());
                }
            }
            _ => {} // ignore unknown flags
        }
        i += 1;
    }

    let mut matchups = Vec::new();

    if matrix {
        // Matrix mode: all ordered deck pairs × all seeds
        if seeds.is_empty() {
            seeds = vec![42, 100, 999];
        }
        for d1 in &decks {
            for d2 in &decks {
                if d1 != d2 {
                    for &s in &seeds {
                        matchups.push(ExpandedMatchup {
                            deck1: d1.clone(),
                            deck2: d2.clone(),
                            seed: s,
                            max_turns,
                            deep,
                            prefer_actions,
                            variant: variant.clone(),
                            commanders: commanders.clone(),
                        });
                    }
                }
            }
        }
    } else if let (Some(d1), Some(d2)) = (deck1.clone(), deck2.clone()) {
        // Specific deck pair mode
        if !explicit_seeds {
            // Use --games to generate seed range from seed_start
            for g in 0..games {
                matchups.push(ExpandedMatchup {
                    deck1: d1.clone(),
                    deck2: d2.clone(),
                    seed: seed_start + g as u64,
                    max_turns,
                    deep,
                    prefer_actions,
                    variant: variant.clone(),
                    commanders: commanders.clone(),
                });
            }
        } else {
            for &s in &seeds {
                matchups.push(ExpandedMatchup {
                    deck1: d1.clone(),
                    deck2: d2.clone(),
                    seed: s,
                    max_turns,
                    deep,
                    prefer_actions,
                    variant: variant.clone(),
                    commanders: commanders.clone(),
                });
            }
        }
    } else if !decks.is_empty() && decks.len() == 2 {
        // Two decks specified via --decks but not --matrix
        if seeds.is_empty() {
            seeds = vec![42];
        }
        for &s in &seeds {
            matchups.push(ExpandedMatchup {
                deck1: decks[0].clone(),
                deck2: decks[1].clone(),
                seed: s,
                max_turns,
                deep,
                prefer_actions,
                variant: variant.clone(),
                commanders: commanders.clone(),
            });
        }
    }

    matchups
}

#[cfg(test)]
mod tests {
    use super::{expand_regression_entry, tokenize_arg_string, ExpandedMatchup};

    #[test]
    fn expand_regression_entry_uses_seed_as_range_start_for_games() {
        let matchups = expand_regression_entry(
            "--deck1 keyword_advanced2 --deck2 keyword_advanced2 --max-turns 40 --games 10 --seed 42",
            10,
        );

        assert_eq!(matchups.len(), 10);
        assert_eq!(
            matchups.first(),
            Some(&ExpandedMatchup {
                deck1: "keyword_advanced2".into(),
                deck2: "keyword_advanced2".into(),
                seed: 42,
                max_turns: 40,
                deep: false,
                prefer_actions: false,
                variant: "Constructed".into(),
                commanders: vec![],
            })
        );
        assert_eq!(
            matchups.last(),
            Some(&ExpandedMatchup {
                deck1: "keyword_advanced2".into(),
                deck2: "keyword_advanced2".into(),
                seed: 51,
                max_turns: 40,
                deep: false,
                prefer_actions: false,
                variant: "Constructed".into(),
                commanders: vec![],
            })
        );
    }

    #[test]
    fn expand_regression_entry_preserves_explicit_seed_list() {
        let matchups = expand_regression_entry(
            "--deck1 red_burn --deck2 green_stompy --seeds 42,100,999 --games 10 --max-turns 30",
            10,
        );

        assert_eq!(
            matchups,
            vec![
                ExpandedMatchup {
                    deck1: "red_burn".into(),
                    deck2: "green_stompy".into(),
                    seed: 42,
                    max_turns: 30,
                    deep: false,
                    prefer_actions: false,
                    variant: "Constructed".into(),
                    commanders: vec![],
                },
                ExpandedMatchup {
                    deck1: "red_burn".into(),
                    deck2: "green_stompy".into(),
                    seed: 100,
                    max_turns: 30,
                    deep: false,
                    prefer_actions: false,
                    variant: "Constructed".into(),
                    commanders: vec![],
                },
                ExpandedMatchup {
                    deck1: "red_burn".into(),
                    deck2: "green_stompy".into(),
                    seed: 999,
                    max_turns: 30,
                    deep: false,
                    prefer_actions: false,
                    variant: "Constructed".into(),
                    commanders: vec![],
                },
            ]
        );
    }

    #[test]
    fn tokenize_args_keeps_quoted_commander_name() {
        let tokens = tokenize_arg_string("--variant Commander --commander 'Neheb, the Worthy'");
        assert_eq!(
            tokens,
            vec!["--variant", "Commander", "--commander", "Neheb, the Worthy"]
        );
    }

    #[test]
    fn expand_regression_entry_parses_variant_and_commander() {
        let matchups = expand_regression_entry(
            "--variant Commander --commander 'Neheb, the Worthy' --deck1 neheb_minotaur_commander --deck2 neheb_minotaur_commander --seed 42 --max-turns 22 --games 1",
            10,
        );
        assert_eq!(matchups.len(), 1);
        assert_eq!(matchups[0].variant, "Commander");
        assert_eq!(matchups[0].commanders, vec!["Neheb, the Worthy"]);
    }
}

/// Build the Axum router with all API routes and the dashboard.
pub fn build_router(state: Arc<AppState>) -> Router {
    let router = Router::new()
        .route("/", get(dashboard_handler))
        .route("/api/stats", get(stats_handler))
        .route("/api/trend", get(trend_handler))
        .route("/api/failures", get(failures_handler))
        .route("/api/matrix", get(matrix_handler))
        .route("/api/run/:id", get(run_handler))
        .route("/api/clusters", get(clusters_handler))
        .route(
            "/api/config",
            get(config_get_handler).post(config_post_handler),
        )
        .route("/api/analysis/toggle", post(analysis_toggle_handler))
        .route("/api/analysis/status", get(analysis_status_handler))
        .route("/api/logs", get(logs_handler))
        .route("/api/fuzz/recent", get(fuzz_recent_handler))
        .route("/api/health", get(health_handler))
        .route("/api/jobs", post(submit_jobs_handler))
        .route("/api/jobs/:batch_id", get(batch_status_handler))
        .route("/api/run-matchup", post(run_matchup_handler));

    #[cfg(feature = "analyze")]
    let router = router.route("/api/models", get(models_handler));

    router.with_state(state)
}

async fn dashboard_handler() -> Html<&'static str> {
    Html(include_str!("dashboard.html"))
}

async fn stats_handler(
    State(state): State<Arc<AppState>>,
    Query(params): Query<SinceQuery>,
) -> impl IntoResponse {
    let uptime = state.start_time.elapsed().as_secs();
    let storage = state.storage.lock().unwrap();
    match storage.stats(
        uptime,
        &state.start_time_iso,
        params.since.as_deref(),
        &state.exclude_prefixes,
    ) {
        Ok(mut stats) => {
            stats.commit_sha = state.commit_sha.clone();
            Json(stats).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn trend_handler(
    State(state): State<Arc<AppState>>,
    Query(params): Query<TrendQuery>,
) -> impl IntoResponse {
    let storage = state.storage.lock().unwrap();
    match storage.trend(
        &params.bucket,
        params.limit,
        params.since.as_deref(),
        &state.exclude_prefixes,
    ) {
        Ok(trend) => Json(trend).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn failures_handler(
    State(state): State<Arc<AppState>>,
    Query(params): Query<FailuresQuery>,
) -> impl IntoResponse {
    let storage = state.storage.lock().unwrap();
    let result = if let Some(ref field) = params.field {
        storage.failures_by_field(
            field,
            params.limit,
            params.since.as_deref(),
            &state.exclude_prefixes,
        )
    } else {
        storage.recent_failures(
            params.limit,
            params.since.as_deref(),
            &state.exclude_prefixes,
        )
    };
    match result {
        Ok(failures) => Json(failures).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn matrix_handler(
    State(state): State<Arc<AppState>>,
    Query(params): Query<SinceQuery>,
) -> impl IntoResponse {
    let storage = state.storage.lock().unwrap();
    match storage.deck_pair_matrix(params.since.as_deref(), &state.exclude_prefixes) {
        Ok(matrix) => Json(matrix).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn run_handler(State(state): State<Arc<AppState>>, Path(id): Path<i64>) -> impl IntoResponse {
    let storage = state.storage.lock().unwrap();
    match storage.get_run(id) {
        Ok(record) => Json(record).into_response(),
        Err(e) => {
            tracing::error!(id, %e, "Failed to load run");
            (StatusCode::NOT_FOUND, format!("Run {id} not found: {e}")).into_response()
        }
    }
}

/// Normalize a divergence field by replacing array indices with `[*]`.
fn normalize_field(field: &str) -> String {
    let mut result = String::with_capacity(field.len());
    let mut chars = field.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '[' {
            result.push('[');
            while let Some(&next) = chars.peek() {
                if next == ']' {
                    break;
                }
                chars.next();
            }
            result.push('*');
        } else {
            result.push(c);
        }
    }
    result
}

async fn clusters_handler(
    State(state): State<Arc<AppState>>,
    Query(params): Query<SinceQuery>,
) -> impl IntoResponse {
    use crate::infra::storage::FieldCluster;

    let storage = state.storage.lock().unwrap();
    match storage.get_clusters_by_field(params.since.as_deref()) {
        Ok(clusters) => {
            // Aggregate clusters by normalized field name (strip array indices)
            let mut merged: std::collections::BTreeMap<String, FieldCluster> =
                std::collections::BTreeMap::new();
            for fc in clusters {
                let key = normalize_field(&fc.field);
                merged
                    .entry(key.clone())
                    .and_modify(|existing| {
                        existing.total_failures += fc.total_failures;
                        existing.num_deck_pairs += fc.num_deck_pairs;
                        if fc.first_seen < existing.first_seen {
                            existing.first_seen = fc.first_seen.clone();
                        }
                        if fc.last_seen > existing.last_seen {
                            existing.last_seen = fc.last_seen.clone();
                        }
                        if existing.github_issue.is_none() {
                            existing.github_issue = fc.github_issue;
                        }
                        if existing.llm_analysis.is_none() {
                            existing.llm_analysis = fc.llm_analysis.clone();
                        }
                        // Merge deck_pairs
                        if let Some(ref new_pairs) = fc.deck_pairs {
                            if let Some(ref mut existing_pairs) = existing.deck_pairs {
                                existing_pairs.push_str(", ");
                                existing_pairs.push_str(new_pairs);
                            } else {
                                existing.deck_pairs = Some(new_pairs.clone());
                            }
                        }
                    })
                    .or_insert(FieldCluster { field: key, ..fc });
            }
            // Sort by total_failures descending
            let mut result: Vec<FieldCluster> = merged.into_values().collect();
            result.sort_by(|a, b| b.total_failures.cmp(&a.total_failures));
            Json(result).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

// ── Logs endpoint ─────────────────────────────────────────────────

async fn logs_handler(
    State(state): State<Arc<AppState>>,
    Query(params): Query<LogsQuery>,
) -> impl IntoResponse {
    let entries = if params.since > 0 {
        state.logs.entries_since(params.since, params.limit)
    } else {
        state.logs.recent(params.limit)
    };
    Json(entries)
}

// ── Fuzz endpoint ─────────────────────────────────────────────────

async fn fuzz_recent_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let storage = state.storage.lock().unwrap();
    match storage.recent_fuzz_games(20) {
        Ok(games) => Json(games).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

// ── Config endpoints ──────────────────────────────────────────────

async fn config_get_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let cfg = &state.config;
    let model = cfg.llm_model.lock().unwrap().clone();
    Json(ConfigResponse {
        games_per_matchup: cfg.games_per_matchup.load(Ordering::Relaxed),
        fuzz_enabled: cfg.fuzz_enabled.load(Ordering::Relaxed),
        self_matchups: cfg.self_matchups.load(Ordering::Relaxed),
        llm_model: model,
        analysis_running: cfg.analysis_running.load(Ordering::Relaxed),
        games_paused: cfg.games_paused.load(Ordering::Relaxed),
        game_delay_ms: cfg.game_delay_ms.load(Ordering::Relaxed),
    })
}

async fn config_post_handler(
    State(state): State<Arc<AppState>>,
    Json(update): Json<ConfigUpdate>,
) -> impl IntoResponse {
    let cfg = &state.config;
    if let Some(n) = update.games_per_matchup {
        let n = n.clamp(1, 100);
        cfg.games_per_matchup.store(n, Ordering::Relaxed);
    }
    if let Some(v) = update.fuzz_enabled {
        cfg.fuzz_enabled.store(v, Ordering::Relaxed);
    }
    if let Some(v) = update.self_matchups {
        cfg.self_matchups.store(v, Ordering::Relaxed);
    }
    if let Some(model) = update.llm_model {
        if !model.is_empty() {
            *cfg.llm_model.lock().unwrap() = model;
        }
    }
    if let Some(v) = update.games_paused {
        cfg.games_paused.store(v, Ordering::Relaxed);
    }
    if let Some(ms) = update.game_delay_ms {
        let ms = ms.clamp(0, 60_000);
        cfg.game_delay_ms.store(ms, Ordering::Relaxed);
    }

    // Return current config
    let model = cfg.llm_model.lock().unwrap().clone();
    Json(ConfigResponse {
        games_per_matchup: cfg.games_per_matchup.load(Ordering::Relaxed),
        fuzz_enabled: cfg.fuzz_enabled.load(Ordering::Relaxed),
        self_matchups: cfg.self_matchups.load(Ordering::Relaxed),
        llm_model: model,
        analysis_running: cfg.analysis_running.load(Ordering::Relaxed),
        games_paused: cfg.games_paused.load(Ordering::Relaxed),
        game_delay_ms: cfg.game_delay_ms.load(Ordering::Relaxed),
    })
}

// ── Analysis control endpoints ────────────────────────────────────

async fn analysis_toggle_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let running = &state.config.analysis_running;
    let was_running = running.load(Ordering::Relaxed);
    running.store(!was_running, Ordering::Relaxed);
    let now_running = !was_running;
    tracing::info!(running = now_running, "Analysis toggled");
    Json(serde_json::json!({ "running": now_running }))
}

async fn analysis_status_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let cfg = &state.config;
    let running = cfg.analysis_running.load(Ordering::Relaxed);
    let model = cfg.llm_model.lock().unwrap().clone();

    // Detect backend from env
    let backend = if std::env::var("ANTHROPIC_API_KEY")
        .map(|k| !k.is_empty())
        .unwrap_or(false)
    {
        "anthropic".to_string()
    } else if std::env::var("OPENAI_API_KEY")
        .map(|k| !k.is_empty())
        .unwrap_or(false)
    {
        let base =
            std::env::var("OPENAI_API_BASE").unwrap_or_else(|_| "https://api.openai.com".into());
        format!("openai ({})", base)
    } else {
        "none".to_string()
    };

    Json(AnalysisStatusResponse {
        running,
        backend,
        model,
    })
}

// ── CI Job Queue endpoints ────────────────────────────────────────

async fn health_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let mut resp = serde_json::json!({ "status": "ok" });
    if let Some(ref sha) = state.commit_sha {
        resp["commit_sha"] = serde_json::Value::String(sha.clone());
    }
    Json(resp)
}

#[derive(serde::Serialize)]
struct SubmitResponse {
    batch_id: u64,
    total_jobs: usize,
}

async fn submit_jobs_handler(
    State(state): State<Arc<AppState>>,
    Json(entries): Json<Vec<RegressionEntry>>,
) -> impl IntoResponse {
    let jq = &state.job_queue;
    let batch_id = jq.next_batch_id.fetch_add(1, Ordering::Relaxed);

    let mut total_jobs = 0usize;
    let mut all_names: Vec<String> = Vec::new();

    for entry in &entries {
        all_names.push(entry.name.clone());
        let matchups = expand_regression_entry(&entry.args, 10);
        let mut queue = jq.queue.lock().unwrap();
        for matchup in matchups {
            queue.push_back(QueuedJob {
                batch_id,
                regression_name: entry.name.clone(),
                deck1: matchup.deck1,
                deck2: matchup.deck2,
                seed: matchup.seed,
                max_turns: matchup.max_turns,
                deep: matchup.deep,
                prefer_actions: matchup.prefer_actions,
                variant: matchup.variant,
                commanders: matchup.commanders,
            });
            total_jobs += 1;
        }
    }

    let batch_name = all_names.join(", ");
    let batch = BatchStatus {
        name: batch_name,
        total: total_jobs,
        completed: 0,
        passed: 0,
        skipped: 0,
        failed: 0,
        errors: 0,
        done: total_jobs == 0,
        active_job: None,
        results: Vec::new(),
    };

    jq.batches.lock().unwrap().insert(batch_id, batch);

    // Purge old completed batches to prevent unbounded memory growth
    jq.cleanup_done_batches(std::time::Duration::from_secs(3600));

    Json(SubmitResponse {
        batch_id,
        total_jobs,
    })
}

async fn batch_status_handler(
    State(state): State<Arc<AppState>>,
    Path(batch_id): Path<u64>,
) -> impl IntoResponse {
    let batches = state.job_queue.batches.lock().unwrap();
    match batches.get(&batch_id) {
        Some(batch) => Json(serde_json::to_value(batch).unwrap()).into_response(),
        None => (
            StatusCode::NOT_FOUND,
            format!("Batch {} not found", batch_id),
        )
            .into_response(),
    }
}

// ── Run Matchup endpoint ──────────────────────────────────────────

/// Simple endpoint to trigger a single matchup (or small batch) via API.
///
/// POST /api/run-matchup with JSON body:
/// ```json
/// { "deck1": "red_burn", "deck2": "green_stompy", "seed": 42, "max_turns": 10 }
/// ```
#[derive(serde::Deserialize)]
struct RunMatchupRequest {
    deck1: String,
    deck2: String,
    #[serde(default = "default_matchup_seed")]
    seed: u64,
    #[serde(default = "default_matchup_max_turns")]
    max_turns: u32,
    #[serde(default)]
    deep: bool,
}

fn default_matchup_seed() -> u64 {
    42
}
fn default_matchup_max_turns() -> u32 {
    10
}

async fn run_matchup_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RunMatchupRequest>,
) -> impl IntoResponse {
    let jq = &state.job_queue;
    let batch_id = jq.next_batch_id.fetch_add(1, Ordering::Relaxed);

    let batch_name = format!("{} vs {} (seed {})", req.deck1, req.deck2, req.seed);
    let batch = BatchStatus {
        name: batch_name,
        total: 1,
        completed: 0,
        passed: 0,
        skipped: 0,
        failed: 0,
        errors: 0,
        done: false,
        active_job: None,
        results: Vec::new(),
    };
    jq.batches.lock().unwrap().insert(batch_id, batch);

    jq.queue.lock().unwrap().push_back(QueuedJob {
        batch_id,
        regression_name: "api-triggered".to_string(),
        deck1: req.deck1,
        deck2: req.deck2,
        seed: req.seed,
        max_turns: req.max_turns,
        deep: req.deep,
        prefer_actions: false,
        variant: "Constructed".to_string(),
        commanders: Vec::new(),
    });

    Json(serde_json::json!({
        "batch_id": batch_id,
        "status": "queued"
    }))
}

// ── Models proxy (LiteLLM / OpenAI-compatible) ────────────────────

#[cfg(feature = "analyze")]
/// Proxy GET /api/models to the upstream LLM provider's /v1/models endpoint.
///
/// Works with LiteLLM, llama-server, vLLM, or any OpenAI-compatible API.
/// Returns `[{id: "model-name", ...}]` — the dashboard uses this to populate
/// a model selector dropdown.
async fn models_handler() -> impl IntoResponse {
    let api_key = std::env::var("OPENAI_API_KEY").unwrap_or_default();
    let base_url =
        std::env::var("OPENAI_API_BASE").unwrap_or_else(|_| "https://api.openai.com".into());
    let url = format!("{}/v1/models", base_url.trim_end_matches('/'));

    use std::sync::OnceLock;
    static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    let client = HTTP_CLIENT.get_or_init(reqwest::Client::new);
    let mut req = client.get(&url);
    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {api_key}"));
    }

    match req.send().await {
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<serde_json::Value>().await {
                Ok(json) => {
                    // Extract just the model IDs into a simple array
                    let models: Vec<String> = json["data"]
                        .as_array()
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
                                .collect()
                        })
                        .unwrap_or_default();
                    Json(serde_json::json!({ "models": models })).into_response()
                }
                Err(e) => (
                    StatusCode::BAD_GATEWAY,
                    format!("Failed to parse models response: {e}"),
                )
                    .into_response(),
            }
        }
        Ok(resp) => {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            (
                StatusCode::BAD_GATEWAY,
                format!("Upstream {status}: {text}"),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            format!("Failed to reach LLM provider: {e}"),
        )
            .into_response(),
    }
}
