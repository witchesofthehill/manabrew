#![allow(clippy::too_many_arguments)]
//! CLI entry point for `forge-parity`.
//!
//! ```text
//! forge-parity --deck1 <name> --deck2 <name> [--seed N] [--max-turns N]
//!              [--games N]
//!              [--java-jar <path>]
//!              [--output <path>] [--format json|text] [--verbose]
//!              [--matrix] [--seeds 42,100,999] [--decks red_burn,green_stompy]
//!              [--java-workers N]
//! ```
//!
//! **Rust-only mode** (default, no `--java-jar`):
//! Dumps per-phase JSONL snapshots. Useful for golden files and debugging.
//!
//! **Full parity mode** (`--java-jar`):
//! Runs both engines, compares snapshots, reports divergences.
//!
//! **Matrix mode** (`--matrix`):
//! Runs all deck pair combinations across multiple seeds.
//!
//! **Fuzz mode** (`--fuzz`):
//! Generates random decks from the parseable card pool and runs parity tests.
//!
//! # Performance
//!
//! 1. **Parallel engines**: Rust and Java run concurrently through the shared
//!    parity runtime. Matchup time = `max(rust, java)` not `rust + java`.
//!
//! 2. **Server reuse and cache**: matrix/server modes reuse Java workers and can
//!    cache deterministic Java output. Cache misses still use side-by-side runtime
//!    execution; cache hits run Rust against the cached Java trace.
//!
//! 3. **Shared runtime semantics**: CLI, CI/server mode, and debugger compare
//!    mode all route engine scheduling through `ParityRuntime`.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use clap::Parser;
use rayon::prelude::*;
use rayon::ThreadPoolBuilder;

use forge_parity::card_pool::CardPool;
use forge_parity::deck_generator;
use forge_parity::deterministic_agent::VerboseMode;
use forge_parity::java_bridge::{JavaServer, JavaServerConfig};
use forge_parity::java_cache::{self, JavaCache};
use forge_parity::java_random::JavaRandom;
use forge_parity::parity_compare::extract_investigation_window;
use forge_parity::protocol::{
    FuzzReport, FuzzResult, MatchupResult, MatchupStatus, MatrixReport, ParityLogEntry,
};
use forge_parity::report;
use forge_parity::runner::{self, deck_search_dirs, LoadedData, RunConfig};
use forge_parity::runtime::{JavaServerPool as ServerPool, ParityRuntime};
use forge_parity::utils::decks::available_presets;
use serde::Deserialize;

const PARITY_THREAD_STACK_SIZE: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
struct ParityIgnoreEntry {
    command: String,
    reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct IgnoredMatchup {
    deck1: String,
    deck2: String,
    seed: u64,
    max_turns: u32,
    reason: String,
}

fn load_parity_ignores() -> Vec<IgnoredMatchup> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("parity_ignore.json");
    let Ok(contents) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    let entries: Vec<ParityIgnoreEntry> = match serde_json::from_str(&contents) {
        Ok(entries) => entries,
        Err(e) => {
            eprintln!("[parity] Failed to parse {}: {}", path.display(), e);
            return Vec::new();
        }
    };
    entries
        .into_iter()
        .filter_map(|entry| {
            parse_ignore_command(&entry.command).map(|mut ignored| {
                ignored.reason = entry.reason;
                ignored
            })
        })
        .collect()
}

fn parse_ignore_command(command: &str) -> Option<IgnoredMatchup> {
    let mut deck1 = None;
    let mut deck2 = None;
    let mut seed = None;
    let mut max_turns = None;
    let mut tokens = command.split_whitespace();
    while let Some(token) = tokens.next() {
        match token {
            "--deck1" => deck1 = tokens.next().map(str::to_string),
            "--deck2" => deck2 = tokens.next().map(str::to_string),
            "--seed" => seed = tokens.next().and_then(|s| s.parse::<u64>().ok()),
            "--max-turns" => max_turns = tokens.next().and_then(|s| s.parse::<u32>().ok()),
            _ => {}
        }
    }
    Some(IgnoredMatchup {
        deck1: deck1?,
        deck2: deck2?,
        seed: seed?,
        max_turns: max_turns?,
        reason: String::new(),
    })
}

fn ignored_matchup<'a>(
    config: &RunConfig,
    ignores: &'a [IgnoredMatchup],
) -> Option<&'a IgnoredMatchup> {
    ignores.iter().find(|entry| {
        entry.deck1 == config.deck1
            && entry.deck2 == config.deck2
            && entry.seed == config.seed
            && entry.max_turns == config.max_turns
    })
}

fn skipped_result(config: &RunConfig, reason: &str) -> MatchupResult {
    MatchupResult::skipped(config, reason.to_string())
}

/// Filter out decks matching any of the given prefixes.
fn filter_decks(decks: Vec<String>, exclude_prefixes: &[String]) -> Vec<String> {
    if exclude_prefixes.is_empty() {
        return decks;
    }
    decks
        .into_iter()
        .filter(|d| !exclude_prefixes.iter().any(|p| d.starts_with(p)))
        .collect()
}

#[derive(Parser, Debug)]
#[command(
    name = "forge-parity",
    about = "Cross-engine differential testing for Forge MTG engine"
)]
struct Cli {
    /// Deck for player 1: preset name, "file:path/to/deck.txt", or "inline:Name*Count|..."
    #[arg(long, default_value = "red_burn")]
    deck1: String,

    /// Deck for player 2: preset name, "file:path/to/deck.txt", or "inline:Name*Count|..."
    #[arg(long, default_value = "green_stompy")]
    deck2: String,

    /// RNG seed for reproducibility
    #[arg(long, default_value_t = 42)]
    seed: u64,

    /// Maximum number of turns before stopping
    #[arg(long, default_value_t = 10)]
    max_turns: u32,

    /// Number of games to run (single-match mode only); seeds increment from --seed
    #[arg(long, default_value_t = 1)]
    games: usize,

    /// Path to the Java Forge harness JAR (enables full parity mode)
    #[arg(long)]
    java_jar: Option<PathBuf>,

    /// Path to the Forge card scripts directory
    #[arg(long)]
    cards_dir: Option<String>,

    /// Single deck folder override. When unset, the harness searches
    /// `parity_decks/` then `public/preset_decks/` (see runner::DEFAULT_DECKS_DIRS).
    #[arg(long)]
    decks_dir: Option<String>,

    /// Output file path (stdout if not specified)
    #[arg(long, short)]
    output: Option<PathBuf>,

    /// Output format: "json" or "text"
    #[arg(long, default_value = "text")]
    format: String,

    /// Verbose output (log step-by-step decisions and per-game progress).
    /// Use bare --verbose for all turns, or --verbose=21 / --verbose=21,22 for specific turns.
    #[arg(long, short, num_args = 0..=1, default_missing_value = "")]
    verbose: Option<String>,

    /// Bias random main-phase decisions toward taking an action instead of passing.
    #[arg(long)]
    prefer_actions: bool,

    /// Capture and compare callback-entry snapshots before every decision callback.
    #[arg(long)]
    deep: bool,

    /// Allow snapshot resync: tolerate extra/missing snapshots by scanning ahead
    /// to find a matching pair. Without this flag, snapshot count mismatches are
    /// treated as hard failures.
    #[arg(long)]
    loose_parity: bool,

    /// Print side-by-side Rust/Java snapshot timeline to stderr for debugging.
    #[arg(long)]
    log_snapshots: bool,

    /// On failures, print callback window diagnostics plus side-by-side Rust/Java decision logs.
    #[arg(long)]
    investigate: bool,

    /// Print the full side-by-side Rust/Java callback log for the entire run (not just the divergence window).
    #[arg(long)]
    full_log: bool,

    /// Write Rust-side parity callbacks/snapshots to this file while the game is running.
    #[arg(long)]
    live_log: Option<PathBuf>,

    /// Run all deck pair combinations across multiple seeds
    #[arg(long)]
    matrix: bool,

    /// Comma-separated seeds for matrix mode (default: 42,100,999)
    #[arg(long, value_delimiter = ',')]
    seeds: Option<Vec<u64>>,

    /// Comma-separated deck names for matrix mode (default: all presets)
    #[arg(long, value_delimiter = ',')]
    decks: Option<Vec<String>>,

    /// Run fuzz random deck testing
    #[arg(long)]
    fuzz: bool,

    /// Number of fuzz iterations (default: 100)
    #[arg(long, default_value_t = 100)]
    iterations: usize,

    /// Master seed for fuzz reproducibility (default: 42)
    #[arg(long, default_value_t = 42)]
    master_seed: u64,

    /// Number of Java server worker processes (default: 1 for fuzz/single, num_cpus for matrix)
    #[arg(long)]
    java_workers: Option<usize>,

    /// Maximum JVM heap size per Java worker (e.g. "512m", "1g"). Default: "512m".
    /// On memory-constrained VMs, this prevents each JVM from consuming all available RAM.
    #[arg(long, default_value = "512m")]
    java_heap: String,

    /// Game variant: Constructed, Commander, Oathbreaker, TinyLeaders, Brawl.
    /// Commander variants adjust starting life and enable commander mechanics.
    #[arg(long, default_value = "Constructed")]
    variant: String,

    /// Commander card names for Commander variants. Repeat this flag for multiple commanders.
    /// Required when variant is Commander, Oathbreaker, TinyLeaders, or Brawl.
    #[arg(long = "commander")]
    commander: Vec<String>,

    /// Run continuous parity testing: execute games, store in SQLite, exit with threshold check
    #[arg(long)]
    continuous: bool,

    /// Start continuous parity server with web dashboard
    #[arg(long)]
    serve: bool,

    /// CI regression mode: process only queued jobs from API, exit when batch completes
    #[arg(long)]
    ci: bool,

    /// Maximum number of games for continuous mode (default: unlimited for serve, 100 for continuous)
    #[arg(long)]
    max_games: Option<usize>,

    /// Pass rate threshold (0.0-1.0); exit 1 if below (continuous mode only, default: 0.90)
    #[arg(long, default_value_t = 0.90)]
    threshold: f64,

    /// SQLite database path for continuous mode (default: parity.db)
    #[arg(long, default_value = "parity.db")]
    db_path: String,

    /// HTTP port for serve mode (default: 8080)
    #[arg(long, default_value_t = 8080)]
    port: u16,

    /// Number of fuzz games per batch in continuous mode (0 to disable)
    #[arg(long, default_value_t = 0)]
    fuzz_per_batch: usize,

    /// Enable the analysis daemon (clusters failures, LLM analysis, Discord/GitHub)
    #[arg(long)]
    analyze: bool,

    /// Seconds between analysis DB checks (default: 60)
    #[arg(long, default_value_t = 60)]
    poll_interval: u64,

    /// Seconds between Discord summary posts (default: 3600)
    #[arg(long, default_value_t = 3600)]
    summary_interval: u64,

    /// Minimum failures in a cluster before opening a GitHub issue (default: 5)
    #[arg(long, default_value_t = 5)]
    issue_threshold: i64,

    /// GitHub repo for issues in owner/repo format
    #[arg(long)]
    github_repo: Option<String>,

    /// Disable Java output cache (always run Java)
    #[arg(long)]
    no_cache: bool,

    /// Directory for the Java output cache (default: .parity-cache)
    #[arg(long, default_value = ".parity-cache")]
    cache_dir: String,

    /// Tracing log level for serve mode (default: warn). Accepts: error, warn, info, debug, trace.
    /// Can also be set via RUST_LOG env var which takes precedence.
    #[arg(long, default_value = "warn")]
    log_level: String,

    /// Comma-separated deck name prefixes to exclude from scheduling (default: "real_").
    /// Decks matching any prefix are skipped in matrix/continuous/serve modes.
    #[arg(long, value_delimiter = ',', default_value = "real_")]
    exclude_prefix: Vec<String>,
}

impl Cli {
    fn verbose_mode(&self) -> VerboseMode {
        match &self.verbose {
            None => VerboseMode::Off,
            Some(s) => VerboseMode::from_flag(true, Some(s.as_str())),
        }
    }

    /// True only for bare `--verbose` (all turns). Turn-specific `--verbose=25`
    /// should not trigger general progress chatter — only the agent's per-turn
    /// logging and the final diff.
    fn is_verbose(&self) -> bool {
        matches!(self.verbose, Some(ref s) if s.is_empty())
    }
}

fn build_config(cli: &Cli, deck1: &str, deck2: &str, seed: u64) -> RunConfig {
    RunConfig {
        deck1: deck1.to_string(),
        deck2: deck2.to_string(),
        seed,
        max_turns: cli.max_turns,
        cards_dir: cli.cards_dir.clone(),
        decks_dir: cli.decks_dir.clone(),
        verbose: cli.verbose_mode(),
        prefer_actions: cli.prefer_actions,
        deep: cli.deep,
        loose_parity: cli.loose_parity,
        log_snapshots: cli.log_snapshots,
        java_heap: cli.java_heap.clone(),
        variant: cli.variant.clone(),
        commanders: cli.commander.clone(),
        full_log: cli.full_log,
        live_log: cli.live_log.clone(),
    }
}

fn load_data_or_exit(cli: &Cli) -> runner::LoadedData {
    match runner::load_data(cli.cards_dir.as_deref(), cli.is_verbose()) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[parity] Load error: {}", e);
            std::process::exit(1);
        }
    }
}

/// Resolve `--issue-threshold`: explicit CLI value > `ISSUE_THRESHOLD` env > default.
fn resolve_issue_threshold(cli_val: i64) -> i64 {
    if cli_val != 5 {
        return cli_val;
    }
    std::env::var("ISSUE_THRESHOLD")
        .ok()
        .filter(|s| !s.is_empty())
        .and_then(|s| s.parse().ok())
        .unwrap_or(cli_val)
}

/// Resolve `--github-repo`: explicit CLI value > `GITHUB_REPO` env > unset.
fn resolve_github_repo(cli_val: Option<String>) -> Option<String> {
    cli_val.or_else(|| {
        std::env::var("GITHUB_REPO")
            .ok()
            .filter(|s| !s.is_empty())
    })
}

fn main() {
    let _perf_summary = forge_engine_core::perf::SummaryGuard::new();
    let mut args: Vec<String> = std::env::args().collect();
    if args.get(1).is_some_and(|arg| arg == "ci-client") {
        args.remove(1);
        forge_parity::infra::ci_client::run(&args);
        return;
    }

    let cli = Cli::parse();
    let games_flag_present =
        std::env::args().any(|arg| arg == "--games" || arg.starts_with("--games="));

    if cli.analyze && !cli.serve {
        #[cfg(feature = "analyze")]
        {
            run_analyze_only(&cli);
            return;
        }
        #[cfg(not(feature = "analyze"))]
        {
            eprintln!("[parity] --analyze requires the 'analyze' feature. Build with: cargo build --features analyze");
            std::process::exit(1);
        }
    }

    if cli.serve || cli.ci {
        #[cfg(feature = "serve")]
        {
            run_serve_mode(&cli);
        }
        #[cfg(not(feature = "serve"))]
        {
            eprintln!("[parity] --serve requires the 'serve' feature. Build with: cargo build --features serve");
            std::process::exit(1);
        }
    } else if cli.continuous {
        #[cfg(feature = "storage")]
        {
            run_continuous_mode(&cli);
        }
        #[cfg(not(feature = "storage"))]
        {
            eprintln!("[parity] --continuous requires the 'storage' feature. Build with: cargo build --features storage");
            std::process::exit(1);
        }
    } else if cli.fuzz {
        run_fuzz_mode(&cli);
    } else if cli.matrix {
        run_matrix_mode(&cli);
    } else if cli.java_jar.is_some() {
        // In Java parity mode, always use multi-game report output (including games table),
        // even for the default single game.
        run_multi_game_mode(&cli);
    } else if games_flag_present || cli.games > 1 {
        run_multi_game_mode(&cli);
    } else {
        run_rust_only_mode(&cli);
    }
}

fn run_multi_game_mode(cli: &Cli) {
    if cli.is_verbose() {
        eprintln!(
            "[parity] Running: {} vs {} | games={} | seed_start={} | max_turns={}",
            cli.deck1, cli.deck2, cli.games, cli.seed, cli.max_turns
        );
    }

    let ignores = load_parity_ignores();
    let seeds = game_seeds(cli.seed, cli.games);
    let data = load_data_or_exit(cli);

    let total = seeds.len();
    let results: Vec<MatchupResult> = if let Some(ref jar_path) = cli.java_jar {
        let workers = cli.java_workers.unwrap_or(1).max(1);
        let server_config = JavaServerConfig {
            jar_path: jar_path.clone(),
            forge_home: None,
            decks_dir: cli.decks_dir.clone(),
            verbose: cli.is_verbose(),
            java_heap: cli.java_heap.clone(),
        };
        match ServerPool::spawn(workers, &server_config) {
            Ok(pool) => {
                if cli.is_verbose() {
                    eprintln!(
                        "[parity] Multi-game mode: {} Java worker(s), {} games",
                        workers, total
                    );
                }
                let completed = AtomicUsize::new(0);
                let mut indexed: Vec<(usize, MatchupResult)> = seeds
                    .par_iter()
                    .enumerate()
                    .map(|(i, &seed)| {
                        let config = build_config(cli, &cli.deck1, &cli.deck2, seed);

                        if let Some(entry) = ignored_matchup(&config, &ignores) {
                            let result = skipped_result(&config, &entry.reason);
                            if cli.is_verbose() {
                                let n = completed.fetch_add(1, Ordering::Relaxed) + 1;
                                eprintln!(
                                    "[parity] [{}/{}] seed={} ... SKIPPED: {}",
                                    n, total, seed, entry.reason
                                );
                            }
                            return (i, result);
                        }

                        let result = run_single_matchup_pool(&config, &data, &pool);

                        if cli.is_verbose() {
                            let n = completed.fetch_add(1, Ordering::Relaxed) + 1;
                            match result.status {
                                MatchupStatus::Pass => {
                                    eprintln!(
                                        "[parity] [{}/{}] seed={} ... PASS ({} snapshots)",
                                        n, total, seed, result.snapshots_compared
                                    );
                                }
                                MatchupStatus::Skipped => {
                                    eprintln!(
                                        "[parity] [{}/{}] seed={} ... SKIPPED: {}",
                                        n,
                                        total,
                                        seed,
                                        result.skip_reason.as_deref().unwrap_or("ignored")
                                    );
                                }
                                MatchupStatus::Fail => {
                                    eprintln!(
                                        "[parity] [{}/{}] seed={} ... FAIL ({} divergences)",
                                        n, total, seed, result.divergence_count
                                    );
                                }
                                MatchupStatus::Error => {
                                    eprintln!(
                                        "[parity] [{}/{}] seed={} ... ERROR: {}",
                                        n,
                                        total,
                                        seed,
                                        result.error_message.as_deref().unwrap_or("unknown")
                                    );
                                }
                            }
                        }
                        (i, result)
                    })
                    .collect();
                indexed.sort_by_key(|(i, _)| *i);
                let results = indexed.into_iter().map(|(_, r)| r).collect();
                pool.shutdown();
                results
            }
            Err(e) => {
                eprintln!("[parity] Failed to spawn Java server pool: {}", e);
                eprintln!("[parity] Falling back to one-shot mode");
                let mut results: Vec<MatchupResult> = Vec::with_capacity(total);
                for (i, seed) in seeds.iter().copied().enumerate() {
                    let config = build_config(cli, &cli.deck1, &cli.deck2, seed);
                    if let Some(entry) = ignored_matchup(&config, &ignores) {
                        let result = skipped_result(&config, &entry.reason);
                        if cli.is_verbose() {
                            let n = i + 1;
                            eprintln!(
                                "[parity] [{}/{}] seed={} ... SKIPPED: {}",
                                n, total, seed, entry.reason
                            );
                        }
                        results.push(result);
                        continue;
                    }
                    let result = run_single_matchup_oneshot(&config, &data, jar_path);
                    if cli.is_verbose() {
                        let n = i + 1;
                        match result.status {
                            MatchupStatus::Pass => {
                                eprintln!(
                                    "[parity] [{}/{}] seed={} ... PASS ({} snapshots)",
                                    n, total, seed, result.snapshots_compared
                                );
                            }
                            MatchupStatus::Skipped => {
                                eprintln!(
                                    "[parity] [{}/{}] seed={} ... SKIPPED: {}",
                                    n,
                                    total,
                                    seed,
                                    result.skip_reason.as_deref().unwrap_or("ignored")
                                );
                            }
                            MatchupStatus::Fail => {
                                eprintln!(
                                    "[parity] [{}/{}] seed={} ... FAIL ({} divergences)",
                                    n, total, seed, result.divergence_count
                                );
                            }
                            MatchupStatus::Error => {
                                eprintln!(
                                    "[parity] [{}/{}] seed={} ... ERROR: {}",
                                    n,
                                    total,
                                    seed,
                                    result.error_message.as_deref().unwrap_or("unknown")
                                );
                            }
                        }
                    }
                    results.push(result);
                }
                results
            }
        }
    } else {
        let completed = AtomicUsize::new(0);
        let verbose = cli.is_verbose();
        seeds
            .par_iter()
            .copied()
            .map(|seed| {
                let config = build_config(cli, &cli.deck1, &cli.deck2, seed);
                let result = run_single_matchup_rust_only(&config, &data);
                if verbose {
                    let n = completed.fetch_add(1, Ordering::Relaxed) + 1;
                    match result.status {
                        MatchupStatus::Pass => {
                            eprintln!(
                                "[parity] [{}/{}] seed={} ... PASS ({} snapshots)",
                                n, total, seed, result.snapshots_compared
                            );
                        }
                        MatchupStatus::Skipped => {
                            eprintln!(
                                "[parity] [{}/{}] seed={} ... SKIPPED: {}",
                                n,
                                total,
                                seed,
                                result.skip_reason.as_deref().unwrap_or("ignored")
                            );
                        }
                        MatchupStatus::Fail => {
                            eprintln!(
                                "[parity] [{}/{}] seed={} ... FAIL ({} divergences)",
                                n, total, seed, result.divergence_count
                            );
                        }
                        MatchupStatus::Error => {
                            eprintln!(
                                "[parity] [{}/{}] seed={} ... ERROR: {}",
                                n,
                                total,
                                seed,
                                result.error_message.as_deref().unwrap_or("unknown")
                            );
                        }
                    }
                }
                result
            })
            .collect()
    };

    let passed = results
        .iter()
        .filter(|r| r.status == MatchupStatus::Pass)
        .count();
    let skipped = results
        .iter()
        .filter(|r| r.status == MatchupStatus::Skipped)
        .count();
    let failed = results
        .iter()
        .filter(|r| r.status == MatchupStatus::Fail)
        .count();
    let errors = results
        .iter()
        .filter(|r| r.status == MatchupStatus::Error)
        .count();

    let report_data = MatrixReport {
        total_matchups: total,
        passed,
        skipped,
        failed,
        errors,
        seeds,
        decks: vec![cli.deck1.clone(), cli.deck2.clone()],
        max_turns: cli.max_turns,
        results,
    };

    let output = match cli.format.as_str() {
        "json" => report::format_matrix_json(&report_data),
        _ => {
            let mut out = String::new();
            let dd = deck_search_dirs(cli.decks_dir.as_deref());
            out.push_str(&build_coverage_report(
                &cli.deck1,
                &cli.deck2,
                &report_data.results,
                &dd,
            ));
            out.push_str(&report::format_matrix_text(&report_data));
            if cli.investigate {
                out.push_str(&format_investigation_for_results(&report_data.results));
            }
            if cli.full_log {
                out.push_str(&format_full_log_for_results(&report_data.results));
            }
            out
        }
    };
    write_output(cli, &output);

    if failed > 0 || errors > 0 {
        std::process::exit(1);
    }
}

fn game_seeds(start_seed: u64, games: usize) -> Vec<u64> {
    (0..games)
        .map(|i| {
            start_seed.checked_add(i as u64).unwrap_or_else(|| {
                eprintln!(
                    "[parity] Seed overflow: start_seed={} games={}",
                    start_seed, games
                );
                std::process::exit(1);
            })
        })
        .collect()
}

fn run_rust_only_mode(cli: &Cli) {
    let config = build_config(cli, &cli.deck1, &cli.deck2, cli.seed);

    let data = match runner::load_data(config.cards_dir.as_deref(), cli.is_verbose()) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[parity] Load error: {}", e);
            std::process::exit(1);
        }
    };

    match runner::run_with_data(&config, &data) {
        Ok(trace) => {
            let mut output = match cli.format.as_str() {
                "json" => serde_json::to_string_pretty(&trace)
                    .unwrap_or_else(|e| format!("{{\"error\": \"{}\"}}", e)),
                _ => report::format_trace_text(&trace),
            };
            if cli.format != "json" {
                let dd = deck_search_dirs(cli.decks_dir.as_deref());
                output.push_str(&build_coverage_report_from_cards(
                    &collect_unique_deck_cards(&cli.deck1, &cli.deck2, &dd),
                    &trace.covered_cards,
                ));
            }

            if cli.is_verbose() {
                eprintln!(
                    "[parity] Done: {} snapshots collected",
                    trace.snapshot_vec().len()
                );
            }
            write_output(cli, &output);
        }
        Err(e) => {
            eprintln!("[parity] Error: {}", e);
            std::process::exit(1);
        }
    }
}

/// Run a single matchup using a JavaServer (server mode).
/// Rust engine runs on a background thread while Java runs on the current thread,
/// so both engines execute in parallel.
fn run_single_matchup_server(
    config: &RunConfig,
    data: &LoadedData,
    server: &mut JavaServer,
) -> MatchupResult {
    ParityRuntime::new(data).run_with_server(config, server)
}

/// Run a single matchup using a Java server pool entry.
/// Rust and Java run concurrently; Java work is dispatched to any available pool server.
fn run_single_matchup_pool(
    config: &RunConfig,
    data: &LoadedData,
    pool: &ServerPool,
) -> MatchupResult {
    ParityRuntime::new(data).run_with_pool(config, pool)
}

/// Serve-mode matchup result including timing and cache-hit marker.
#[cfg(feature = "serve")]
struct ServedMatchup {
    result: MatchupResult,
    duration_ms: u64,
    cache_hit: bool,
}

/// Run a matchup using a pool, consulting the Java cache first. On miss, runs
/// Rust and Java concurrently (like `run_single_matchup_pool`) and stores the
/// Java output so subsequent identical runs short-circuit.
#[cfg(feature = "serve")]
fn run_matchup_cached(
    config: &RunConfig,
    data: &LoadedData,
    pool: &ServerPool,
    cache: Option<&JavaCache>,
) -> ServedMatchup {
    let matchup = ParityRuntime::new(data).run_cached(config, pool, cache);
    ServedMatchup {
        result: matchup.result,
        duration_ms: matchup.duration_ms,
        cache_hit: matchup.cache_hit,
    }
}

/// Run a single matchup using one-shot JavaBridge (fallback mode).
/// Rust and Java engines run in parallel using scoped threads.
fn run_single_matchup_oneshot(
    config: &RunConfig,
    data: &LoadedData,
    jar_path: &Path,
) -> MatchupResult {
    ParityRuntime::new(data).run_oneshot(config, jar_path)
}

/// Run a single matchup: Rust only (no Java). Used when no JAR is provided.
fn run_single_matchup_rust_only(config: &RunConfig, data: &LoadedData) -> MatchupResult {
    ParityRuntime::new(data).run_rust_only(config)
}

fn run_matrix_mode(cli: &Cli) {
    let ignores = load_parity_ignores();
    let decks_dirs = deck_search_dirs(cli.decks_dir.as_deref());
    let seeds = cli.seeds.clone().unwrap_or_else(|| vec![42, 100, 999]);
    let deck_names: Vec<String> = filter_decks(
        cli.decks
            .clone()
            .unwrap_or_else(|| available_presets(&decks_dirs)),
        &cli.exclude_prefix,
    );

    // Validate deck names
    let valid = available_presets(&decks_dirs);
    for d in &deck_names {
        if !valid.contains(d) {
            eprintln!("[parity] Unknown deck '{}'. Available: {:?}", d, valid);
            std::process::exit(1);
        }
    }

    // Build ordered pairs (d1, d2) where d1 != d2
    let mut pairs: Vec<(&str, &str)> = Vec::new();
    for d1 in &deck_names {
        for d2 in &deck_names {
            if d1 != d2 {
                pairs.push((d1, d2));
            }
        }
    }

    let total = pairs.len() * seeds.len();
    if cli.is_verbose() {
        eprintln!(
            "[parity] Matrix mode: {} decks × {} seeds = {} matchups",
            deck_names.len(),
            seeds.len(),
            total
        );
    }

    // Load data once
    let data = load_data_or_exit(cli);
    let matrix_pool = ThreadPoolBuilder::new()
        .thread_name(|idx| format!("parity-matrix-{idx}"))
        .stack_size(PARITY_THREAD_STACK_SIZE)
        .build()
        .expect("Failed to build matrix thread pool");

    // Build flat list of (d1, d2, seed) jobs for parallel execution
    let all_jobs: Vec<(&str, &str, u64)> = pairs
        .iter()
        .flat_map(|&(d1, d2)| seeds.iter().map(move |&s| (d1, d2, s)))
        .collect();
    let mut skipped_results = Vec::new();
    let mut jobs = Vec::new();
    for (d1, d2, seed) in all_jobs {
        let config = build_config(cli, d1, d2, seed);
        if let Some(entry) = ignored_matchup(&config, &ignores) {
            skipped_results.push(skipped_result(&config, &entry.reason));
        } else {
            jobs.push((d1, d2, seed));
        }
    }

    let completed = AtomicUsize::new(0);

    // Spawn server pool if Java JAR is provided.
    // Default worker count is memory-aware: caps to what fits in RAM at the given heap size.
    let num_workers = cli.java_workers.unwrap_or_else(|| {
        if cli.java_jar.is_some() {
            max_workers_for_memory(&cli.java_heap)
        } else {
            0
        }
    });

    let pool = if let Some(ref jar_path) = cli.java_jar {
        let server_config = JavaServerConfig {
            jar_path: jar_path.clone(),
            forge_home: None,
            decks_dir: cli.decks_dir.clone(),
            verbose: cli.is_verbose(),
            java_heap: cli.java_heap.clone(),
        };
        match ServerPool::spawn(num_workers.max(1), &server_config) {
            Ok(pool) => Some(pool),
            Err(e) => {
                eprintln!("[parity] Failed to spawn Java server pool: {}", e);
                eprintln!("[parity] Falling back to one-shot mode");
                None
            }
        }
    } else {
        None
    };

    // Open Java output cache (unless --no-cache).
    // Source hash covers all Java source + deck definitions — when any of
    // these change the entire cache is wiped automatically.
    let java_cache: Option<JavaCache> = if !cli.no_cache && cli.java_jar.is_some() {
        let project_root = std::env::current_dir().unwrap_or_default();
        let source_hash = if project_root.join("forge/forge-harness/src").exists() {
            java_cache::compute_source_hash(&project_root)
        } else if let Some(ref jar) = cli.java_jar {
            java_cache::compute_jar_hash(jar).unwrap_or_default()
        } else {
            String::new()
        };
        match JavaCache::open(std::path::Path::new(&cli.cache_dir), source_hash) {
            Ok(c) => {
                eprintln!(
                    "[parity] Java cache: {} (hash={})",
                    cli.cache_dir,
                    c.source_hash()
                );
                Some(c)
            }
            Err(e) => {
                eprintln!(
                    "[parity] Failed to open Java cache: {} (continuing without)",
                    e
                );
                None
            }
        }
    } else {
        None
    };

    // Run each matchup through the shared runtime so live Java comparisons have
    // the same side-by-side scheduling as single-game CLI and debugger compare.
    let cache_hits = AtomicUsize::new(0);
    let cache_misses = AtomicUsize::new(0);
    let mut results: Vec<MatchupResult> = matrix_pool.install(|| {
        jobs.par_iter()
            .map(|&(d1, d2, seed)| {
                let config = build_config(cli, d1, d2, seed);
                let result = if let Some(ref pool) = pool {
                    let matchup =
                        ParityRuntime::new(&data).run_cached(&config, pool, java_cache.as_ref());
                    if java_cache.is_some() {
                        if matchup.cache_hit {
                            cache_hits.fetch_add(1, Ordering::Relaxed);
                        } else {
                            cache_misses.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                    matchup.result
                } else if let Some(ref jar_path) = cli.java_jar {
                    run_single_matchup_oneshot(&config, &data, jar_path)
                } else {
                    let mut result = run_single_matchup_rust_only(&config, &data);
                    // Matrix JSON historically reports summaries only; keep full
                    // Rust traces in rust-only mode and debugger/runtime callers.
                    result.rust_log.clear();
                    result
                };

                if cli.is_verbose() {
                    let n = completed.fetch_add(1, Ordering::Relaxed) + 1;
                    match result.status {
                        MatchupStatus::Pass => {
                            eprintln!(
                                "[parity] [{}/{}] {} vs {} seed={} ... PASS ({} snapshots)",
                                n,
                                total,
                                config.deck1,
                                config.deck2,
                                config.seed,
                                result.snapshots_compared
                            );
                        }
                        MatchupStatus::Skipped => {
                            eprintln!(
                                "[parity] [{}/{}] {} vs {} seed={} ... SKIPPED: {}",
                                n,
                                total,
                                config.deck1,
                                config.deck2,
                                config.seed,
                                result.skip_reason.as_deref().unwrap_or("ignored")
                            );
                        }
                        MatchupStatus::Fail => {
                            eprintln!(
                                "[parity] [{}/{}] {} vs {} seed={} ... FAIL ({} divergences)",
                                n,
                                total,
                                config.deck1,
                                config.deck2,
                                config.seed,
                                result.divergence_count
                            );
                        }
                        MatchupStatus::Error => {
                            eprintln!(
                                "[parity] [{}/{}] {} vs {} seed={} ... ERROR: {}",
                                n,
                                total,
                                config.deck1,
                                config.deck2,
                                config.seed,
                                result.error_message.as_deref().unwrap_or("unknown")
                            );
                        }
                    }
                }

                result
            })
            .collect()
    });
    results.extend(skipped_results);
    results.sort_by(|a, b| {
        a.deck1
            .cmp(&b.deck1)
            .then_with(|| a.deck2.cmp(&b.deck2))
            .then_with(|| a.seed.cmp(&b.seed))
    });

    // Shutdown pool
    if let Some(pool) = pool {
        pool.shutdown();
    }

    // Log cache stats
    let hits = cache_hits.load(Ordering::Relaxed);
    let misses = cache_misses.load(Ordering::Relaxed);
    if hits + misses > 0 {
        eprintln!(
            "[parity] Java cache: {} hits, {} misses ({:.0}% hit rate)",
            hits,
            misses,
            if hits + misses > 0 {
                (hits as f64 / (hits + misses) as f64) * 100.0
            } else {
                0.0
            }
        );
    }

    let passed = results
        .iter()
        .filter(|r| r.status == MatchupStatus::Pass)
        .count();
    let skipped = results
        .iter()
        .filter(|r| r.status == MatchupStatus::Skipped)
        .count();
    let failed = results
        .iter()
        .filter(|r| r.status == MatchupStatus::Fail)
        .count();
    let errors = results
        .iter()
        .filter(|r| r.status == MatchupStatus::Error)
        .count();

    let matrix_report = MatrixReport {
        total_matchups: total,
        passed,
        skipped,
        failed,
        errors,
        seeds: seeds.clone(),
        decks: deck_names.clone(),
        max_turns: cli.max_turns,
        results,
    };

    let output = match cli.format.as_str() {
        "json" => report::format_matrix_json(&matrix_report),
        _ => report::format_matrix_text(&matrix_report),
    };
    write_output(cli, &output);

    if failed > 0 || errors > 0 {
        std::process::exit(1);
    }
}

/// Wrap text to `width` visible characters, respecting ANSI escape sequences.
fn wrap_cell(text: &str, width: usize) -> Vec<String> {
    if text.is_empty() {
        return vec![String::new()];
    }
    let mut lines = Vec::new();
    for raw_line in text.split('\n') {
        let indent_len = visible_width(raw_line) - visible_width(raw_line.trim_start());
        let indent: &str = &raw_line[..raw_line.len() - raw_line.trim_start().len()];
        let content = &raw_line[raw_line.len() - raw_line.trim_start().len()..];
        let effective_width = width.saturating_sub(indent_len);
        if effective_width == 0 || content.is_empty() {
            if !raw_line.is_empty() {
                lines.push(raw_line.to_string());
            }
            continue;
        }
        let mut current = String::new();
        let mut current_vis = 0usize;
        for word in content.split_whitespace() {
            let word_vis = visible_width(word);
            if word_vis > effective_width {
                if !current.is_empty() {
                    lines.push(format!("{indent}{current}"));
                    current = String::new();
                    current_vis = 0;
                }
                // Long word — just push as-is (don't break mid-ANSI)
                lines.push(format!("{indent}{word}"));
                continue;
            }
            let sep = if current.is_empty() { 0 } else { 1 };
            if current_vis + sep + word_vis > effective_width {
                lines.push(format!("{indent}{current}"));
                current = word.to_string();
                current_vis = word_vis;
            } else {
                if !current.is_empty() {
                    current.push(' ');
                }
                current.push_str(word);
                current_vis += sep + word_vis;
            }
        }
        if !current.is_empty() {
            lines.push(format!("{indent}{current}"));
        }
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

fn pad_visible(s: &str, width: usize) -> String {
    let visible_len = visible_width(s);
    if visible_len >= width {
        s.to_string()
    } else {
        format!("{}{}", s, " ".repeat(width - visible_len))
    }
}

fn visible_width(s: &str) -> usize {
    let mut width = 0;
    let mut in_escape = false;
    for c in s.chars() {
        if in_escape {
            if c == 'm' {
                in_escape = false;
            }
        } else if c == '\x1b' {
            in_escape = true;
        } else {
            width += 1;
        }
    }
    width
}

fn colorize_rendered_log_entry(entry: &ParityLogEntry, text: String) -> String {
    use forge_parity::protocol::ParityLog;

    if entry.kind() == "$ACTION_SPACE" {
        text.replace(
            "\x1b[94m$ACTION_SPACE\x1b[0m",
            "\x1b[36m$ACTION_SPACE\x1b[0m",
        )
    } else {
        text
    }
}

const COL_WIDTH_DEFAULT: usize = 64;
const ROW_LABEL_WIDTH: usize = 0;
const SEPARATOR_WIDTH: usize = 3; // " | "

fn col_widths() -> (usize, usize) {
    let term_w = terminal_size::terminal_size()
        .map(|(w, _)| w.0 as usize)
        .unwrap_or(COL_WIDTH_DEFAULT * 2 + SEPARATOR_WIDTH);
    let left = (term_w.saturating_sub(SEPARATOR_WIDTH)) / 2;
    let left = left.max(20);
    let right = term_w.saturating_sub(left + SEPARATOR_WIDTH).max(20);
    (left, right)
}

/// A callback entry's matching key: (turn, phase, player, callback_name).
#[derive(Clone, PartialEq, Eq, Hash)]
struct CallbackKey {
    turn: u32,
    phase: String,
    player: u32,
    name: String,
}

impl CallbackKey {
    fn from_entry(entry: &ParityLogEntry) -> Option<Self> {
        use forge_parity::protocol::ParityLog;
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

/// Segment a unified log into buckets separated by snapshots.
/// Returns (buckets, snapshot_count) where buckets[i] contains the entries
/// between snapshot i-1 and snapshot i.
fn bucket_log_entries(log: &[ParityLogEntry]) -> (Vec<Vec<&ParityLogEntry>>, usize) {
    let mut buckets: Vec<Vec<&ParityLogEntry>> = vec![vec![]];
    let mut snap_count = 0usize;
    for entry in log {
        if entry.as_snapshot().is_some() {
            snap_count += 1;
            buckets.push(vec![]);
        } else {
            buckets.last_mut().unwrap().push(entry);
        }
    }
    (buckets, snap_count)
}

/// Pair entries from two buckets by matching (turn, phase, player, callback_name).
/// Returns a list of (Option<left_text>, Option<right_text>) pairs.
/// Matched entries appear side by side; unmatched entries appear with None on the other side.
fn pair_bucket_entries(
    rust_entries: &[&ParityLogEntry],
    java_entries: &[&ParityLogEntry],
) -> Vec<(Option<String>, Option<String>)> {
    use forge_parity::protocol::ParityLog;

    // Build a list of (key, formatted_text) for each side, tracking which
    // occurrence of a key this is (to handle duplicate keys correctly).
    let rust_keyed: Vec<(Option<CallbackKey>, String)> = rust_entries
        .iter()
        .map(|e| {
            (
                CallbackKey::from_entry(e),
                colorize_rendered_log_entry(e, e.format())
                    .trim_start()
                    .to_string(),
            )
        })
        .collect();
    let java_keyed: Vec<(Option<CallbackKey>, String)> = java_entries
        .iter()
        .map(|e| {
            (
                CallbackKey::from_entry(e),
                colorize_rendered_log_entry(e, e.format())
                    .trim_start()
                    .to_string(),
            )
        })
        .collect();

    // For each key on the Java side, track how many times it appears and
    // which ones have been consumed by a match. We use a Vec to preserve
    // ordering of duplicates.
    let mut java_available: Vec<(Option<CallbackKey>, String, bool)> = java_keyed
        .into_iter()
        .map(|(k, text)| (k, text, false))
        .collect();

    let mut rows: Vec<(Option<String>, Option<String>)> = Vec::new();

    // Walk the Rust side in order.  For each entry, try to find the first
    // unmatched Java entry with the same key.
    for (rkey, rtext) in &rust_keyed {
        let mut matched = false;

        // First, emit any unmatched Java entries that appear *before* the
        // matching Java entry (so we preserve Java-side ordering).
        if let Some(rk) = rkey {
            if let Some(match_pos) = java_available
                .iter()
                .position(|(jk, _, used)| !used && jk.as_ref() == Some(rk))
            {
                // Emit all unmatched Java entries before this match position.
                for entry in java_available.iter_mut().take(match_pos) {
                    if !entry.2 {
                        entry.2 = true;
                        rows.push((None, Some(entry.1.clone())));
                    }
                }
                // Emit the matched pair.
                java_available[match_pos].2 = true;
                rows.push((
                    Some(rtext.clone()),
                    Some(java_available[match_pos].1.clone()),
                ));
                matched = true;
            }
        }

        if !matched {
            rows.push((Some(rtext.clone()), None));
        }
    }

    // Emit any remaining unmatched Java entries.
    for (_, jtext, used) in &java_available {
        if !*used {
            rows.push((None, Some(jtext.clone())));
        }
    }

    rows
}

/// Render a side-by-side parity log table.
///
/// `snapshot_offset` is added to bucket indices for display (e.g. 0 for full log,
/// `divergent - 1` for investigation windows).
fn render_side_by_side(
    rust_log: &[ParityLogEntry],
    java_log: &[ParityLogEntry],
    divergent_snapshot: usize,
    snapshot_offset: usize,
    out: &mut String,
) {
    let (lw, rw) = col_widths();
    let (rust_buckets, rust_snap_count) = bucket_log_entries(rust_log);
    let (java_buckets, java_snap_count) = bucket_log_entries(java_log);
    let max_snapshots = rust_snap_count.max(java_snap_count);

    out.push_str(&format!("{:<lw$} | {:<rw$}\n", "Rust", "Java"));
    out.push_str(&format!("{}+{}\n", "-".repeat(lw + 1), "-".repeat(rw + 1)));

    for snap_idx in 0..=max_snapshots {
        let rust_entries = rust_buckets
            .get(snap_idx)
            .map(|v| v.as_slice())
            .unwrap_or(&[]);
        let java_entries = java_buckets
            .get(snap_idx)
            .map(|v| v.as_slice())
            .unwrap_or(&[]);

        let paired = pair_bucket_entries(rust_entries, java_entries);

        for (left_opt, right_opt) in &paired {
            let left_text = left_opt.as_deref().unwrap_or("-");
            let right_text = right_opt.as_deref().unwrap_or("-");
            let left_lines = wrap_cell(left_text, lw);
            let right_lines = wrap_cell(right_text, rw);
            let height = left_lines.len().max(right_lines.len());
            for line_idx in 0..height {
                let left = left_lines.get(line_idx).map(String::as_str).unwrap_or("");
                let right = right_lines.get(line_idx).map(String::as_str).unwrap_or("");
                out.push_str(&format!(
                    "{} | {}\n",
                    pad_visible(left, lw),
                    pad_visible(right, rw)
                ));
            }
        }

        if snap_idx < max_snapshots {
            let abs_snap = snapshot_offset + snap_idx;
            let passed = abs_snap < divergent_snapshot;
            let color = if passed { "\x1b[32m" } else { "\x1b[31m" };
            let status_label = if passed { "✅" } else { "❌" };
            let label = format!(" snapshot {} {} ", abs_snap, status_label);
            let total = lw + rw + ROW_LABEL_WIDTH + SEPARATOR_WIDTH;
            let pad = total.saturating_sub(label.chars().count());
            let left = pad / 2;
            let right = pad - left;
            out.push_str(&format!(
                "{color}{}{}{}\x1b[0m\n",
                "─".repeat(left),
                label,
                "─".repeat(right),
            ));
        }
    }
}

fn format_investigation_for_results(results: &[MatchupResult]) -> String {
    let mut out = String::new();
    for result in results {
        if result.status != MatchupStatus::Fail {
            continue;
        }

        let divergent_snapshot = result
            .first_divergence
            .as_ref()
            .map(|d| d.snapshot_index)
            .unwrap_or(0);

        let (rust_window, java_window) =
            extract_investigation_window(&result.rust_log, &result.java_log, divergent_snapshot);

        out.push_str(&format!(
            "\n=== Investigation: {} vs {} seed={} (snapshot {}) ===\n",
            result.deck1, result.deck2, result.seed, divergent_snapshot,
        ));

        if rust_window.is_empty() && java_window.is_empty() {
            out.push_str("(No log entries in window)\n");
            continue;
        }

        let snapshot_offset = if divergent_snapshot > 0 {
            divergent_snapshot - 1
        } else {
            0
        };
        render_side_by_side(
            rust_window,
            java_window,
            divergent_snapshot,
            snapshot_offset,
            &mut out,
        );
    }
    out
}

fn format_full_log_for_results(results: &[MatchupResult]) -> String {
    let mut out = String::new();
    for result in results {
        out.push_str(&format!(
            "\n=== Full Log: {} vs {} seed={} ({}) ===\n",
            result.deck1,
            result.deck2,
            result.seed,
            match result.status {
                MatchupStatus::Pass => "PASS",
                MatchupStatus::Fail => "FAIL",
                MatchupStatus::Skipped => "SKIPPED",
                MatchupStatus::Error => "ERROR",
            }
        ));

        let divergent_snapshot = result
            .first_divergence
            .as_ref()
            .map(|d| d.snapshot_index)
            .unwrap_or(usize::MAX);

        render_side_by_side(
            &result.rust_log,
            &result.java_log,
            divergent_snapshot,
            0,
            &mut out,
        );
    }
    out
}

fn run_fuzz_mode(cli: &Cli) {
    if cli.is_verbose() {
        eprintln!(
            "[parity] Fuzz mode: {} iterations, master_seed={}",
            cli.iterations, cli.master_seed
        );
    }

    // Load data once
    let data = load_data_or_exit(cli);

    // Discover card pool
    let (pool, pool_stats) = CardPool::discover(&data.db);
    if cli.is_verbose() {
        eprintln!("[parity] {}", pool_stats);
        for example in pool_stats.example_lines() {
            eprintln!("[parity] pool diagnostic example: {}", example);
        }
    }

    if pool.cards.iter().filter(|c| !c.is_land).count() == 0 {
        eprintln!("[parity] No spells in pool — nothing to test");
        std::process::exit(1);
    }

    let total_cards = pool_stats.total_scanned;
    let pool_size = pool_stats.included;

    // Spawn a single Java server for all iterations (if Java JAR provided)
    let mut server = if let Some(ref jar_path) = cli.java_jar {
        let server_config = JavaServerConfig {
            jar_path: jar_path.clone(),
            forge_home: None,
            decks_dir: cli.decks_dir.clone(),
            verbose: cli.is_verbose(),
            java_heap: cli.java_heap.clone(),
        };
        match JavaServer::spawn(&server_config) {
            Ok(s) => Some(s),
            Err(e) => {
                eprintln!("[parity] Failed to spawn Java server: {}", e);
                eprintln!("[parity] Falling back to one-shot mode");
                None
            }
        }
    } else {
        None
    };

    // Derive per-iteration seeds from master seed
    let mut master_rng = JavaRandom::new(cli.master_seed as i64);

    let mut results: Vec<FuzzResult> = Vec::new();
    let total = cli.iterations;

    for iteration in 0..total {
        let deck1_seed = master_rng.next_int(i32::MAX) as u64;
        let deck2_seed = master_rng.next_int(i32::MAX) as u64;
        let game_seed = master_rng.next_int(i32::MAX) as u64;

        // Generate random decks
        let mut deck1_rng = JavaRandom::new(deck1_seed as i64);
        let mut deck2_rng = JavaRandom::new(deck2_seed as i64);
        let deck1_spec = deck_generator::generate_deck(&mut deck1_rng, &pool);
        let deck2_spec = deck_generator::generate_deck(&mut deck2_rng, &pool);

        let deck1_inline = deck_generator::format_inline(&deck1_spec);
        let deck2_inline = deck_generator::format_inline(&deck2_spec);

        let config = RunConfig {
            deck1: format!("inline:{}", deck1_inline),
            deck2: format!("inline:{}", deck2_inline),
            seed: game_seed,
            max_turns: cli.max_turns,
            cards_dir: cli.cards_dir.clone(),
            decks_dir: cli.decks_dir.clone(),
            verbose: cli.verbose_mode(),
            prefer_actions: cli.prefer_actions,
            deep: cli.deep,
            loose_parity: cli.loose_parity,
            log_snapshots: cli.log_snapshots,
            java_heap: cli.java_heap.clone(),
            variant: "Constructed".to_string(),
            commanders: vec![],
            full_log: false,
            live_log: None,
        };

        let matchup_result = if let Some(ref mut srv) = server {
            if srv.is_alive() {
                run_single_matchup_server(&config, &data, srv)
            } else {
                // Server crashed — try to respawn
                if cli.is_verbose() {
                    eprintln!("[parity] Java server crashed, attempting respawn...");
                }
                match JavaServer::spawn(&JavaServerConfig {
                    jar_path: cli.java_jar.as_ref().unwrap().clone(),
                    forge_home: None,
                    decks_dir: cli.decks_dir.clone(),
                    verbose: cli.is_verbose(),
                    java_heap: cli.java_heap.clone(),
                }) {
                    Ok(new_srv) => {
                        *srv = new_srv;
                        run_single_matchup_server(&config, &data, srv)
                    }
                    Err(e) => {
                        eprintln!("[parity] Failed to respawn Java server: {}", e);
                        // Fall back to one-shot for this iteration
                        if let Some(ref jar_path) = cli.java_jar {
                            run_single_matchup_oneshot(&config, &data, jar_path)
                        } else {
                            run_single_matchup_rust_only(&config, &data)
                        }
                    }
                }
            }
        } else if let Some(ref jar_path) = cli.java_jar {
            run_single_matchup_oneshot(&config, &data, jar_path)
        } else {
            run_single_matchup_rust_only(&config, &data)
        };

        if cli.is_verbose() {
            let n = iteration + 1;
            match matchup_result.status {
                MatchupStatus::Pass => {
                    eprintln!(
                        "[parity] [{}/{}] iteration={} seed={} ... PASS ({} snapshots)",
                        n, total, iteration, game_seed, matchup_result.snapshots_compared
                    );
                }
                MatchupStatus::Skipped => {
                    eprintln!(
                        "[parity] [{}/{}] iteration={} seed={} ... SKIPPED: {}",
                        n,
                        total,
                        iteration,
                        game_seed,
                        matchup_result.skip_reason.as_deref().unwrap_or("ignored")
                    );
                }
                MatchupStatus::Fail => {
                    eprintln!(
                        "[parity] [{}/{}] iteration={} seed={} ... FAIL ({} divergences)",
                        n, total, iteration, game_seed, matchup_result.divergence_count
                    );
                }
                MatchupStatus::Error => {
                    eprintln!(
                        "[parity] [{}/{}] iteration={} seed={} ... ERROR: {}",
                        n,
                        total,
                        iteration,
                        game_seed,
                        matchup_result.error_message.as_deref().unwrap_or("unknown")
                    );
                }
            }
        }

        results.push(FuzzResult {
            iteration,
            game_seed,
            deck1_spec: deck1_inline,
            deck2_spec: deck2_inline,
            result: matchup_result,
        });
    }

    // Shutdown server
    if let Some(srv) = server {
        srv.shutdown();
    }

    let passed = results
        .iter()
        .filter(|r| r.result.status == MatchupStatus::Pass)
        .count();
    let failed = results
        .iter()
        .filter(|r| r.result.status == MatchupStatus::Fail)
        .count();
    let errors = results
        .iter()
        .filter(|r| r.result.status == MatchupStatus::Error)
        .count();

    let fuzz_report = FuzzReport {
        master_seed: cli.master_seed,
        iterations: total,
        max_turns: cli.max_turns,
        pool_size,
        total_cards,
        passed,
        failed,
        errors,
        results,
    };

    let output = match cli.format.as_str() {
        "json" => report::format_fuzz_json(&fuzz_report),
        _ => report::format_fuzz_text(&fuzz_report),
    };
    write_output(cli, &output);

    if failed > 0 || errors > 0 {
        std::process::exit(1);
    }
}

fn write_output(cli: &Cli, output: &str) {
    if let Some(ref path) = cli.output {
        match std::fs::write(path, output) {
            Ok(_) => eprintln!("[parity] Report written to {:?}", path),
            Err(e) => {
                eprintln!("[parity] Failed to write report: {}", e);
                std::process::exit(1);
            }
        }
    } else {
        println!("{}", output);
    }
}

fn collect_unique_deck_cards(deck1: &str, deck2: &str, decks_dirs: &[&str]) -> Vec<String> {
    let mut cards: BTreeSet<String> = BTreeSet::new();
    for deck in [deck1, deck2] {
        match forge_parity::utils::decks::resolve_deck_spec(deck, decks_dirs) {
            Ok(spec) => {
                for (name, _) in spec {
                    cards.insert(name);
                }
            }
            Err(e) => {
                eprintln!(
                    "[parity] Coverage warning: failed to parse deck '{}': {}",
                    deck, e
                );
            }
        }
    }
    cards.into_iter().collect()
}

fn build_coverage_report(
    deck1: &str,
    deck2: &str,
    results: &[MatchupResult],
    decks_dirs: &[&str],
) -> String {
    let deck_cards = collect_unique_deck_cards(deck1, deck2, decks_dirs);
    let mut covered: BTreeSet<String> = BTreeSet::new();
    for r in results {
        for c in &r.covered_cards {
            covered.insert(c.clone());
        }
    }
    let covered_cards: Vec<String> = covered.into_iter().collect();
    build_coverage_report_from_cards(&deck_cards, &covered_cards)
}

fn build_coverage_report_from_cards(deck_cards: &[String], covered_cards: &[String]) -> String {
    let deck_set: BTreeSet<&str> = deck_cards.iter().map(|s| s.as_str()).collect();
    let covered_set: BTreeSet<&str> = covered_cards
        .iter()
        .map(|s| s.as_str())
        .filter(|name| deck_set.contains(name))
        .collect();

    let total = deck_set.len();
    let covered = covered_set.len();
    let pct = if total == 0 {
        0.0
    } else {
        (covered as f64 / total as f64) * 100.0
    };

    let uncovered: Vec<&str> = deck_set
        .iter()
        .copied()
        .filter(|name| !covered_set.contains(name))
        .collect();

    let mut out = String::new();
    out.push_str("\n=== Coverage Report ===\n\n");
    out.push_str(&format!(
        "Covered cards: {}/{} ({:.1}%)\n",
        covered, total, pct
    ));
    if uncovered.is_empty() {
        out.push_str("Uncovered cards: none\n");
    } else {
        out.push_str("Uncovered cards:\n");
        for name in uncovered {
            out.push_str(&format!("  - {}\n", name));
        }
    }
    out
}

/// Get the number of available CPUs (capped at a reasonable number).
fn num_cpus() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(8)
}

/// Parse a JVM heap size string (e.g. "512m", "1g") into bytes.
fn parse_heap_bytes(heap: &str) -> u64 {
    let heap = heap.trim().to_lowercase();
    if let Some(n) = heap.strip_suffix('g') {
        n.parse::<u64>().unwrap_or(1) * 1024 * 1024 * 1024
    } else if let Some(n) = heap.strip_suffix('m') {
        n.parse::<u64>().unwrap_or(512) * 1024 * 1024
    } else if let Some(n) = heap.strip_suffix('k') {
        n.parse::<u64>().unwrap_or(512_000) * 1024
    } else {
        heap.parse::<u64>().unwrap_or(512 * 1024 * 1024)
    }
}

/// Compute max Java workers that fit in available system memory.
/// Reserves 512MB for OS + Rust process, then divides remaining by per-worker heap.
fn max_workers_for_memory(java_heap: &str) -> usize {
    let heap_per_worker = parse_heap_bytes(java_heap);
    if heap_per_worker == 0 {
        return 1;
    }
    // Read total system memory from /proc/meminfo (Linux) or sysctl (macOS)
    let total_mem = get_total_memory_bytes();
    if total_mem == 0 {
        return num_cpus(); // can't detect, fall back to CPU count
    }
    let reserved = 512 * 1024 * 1024u64; // 512MB for OS + Rust
    let available = total_mem.saturating_sub(reserved);
    let max = (available / heap_per_worker) as usize;
    max.max(1).min(num_cpus()) // at least 1, at most num_cpus
}

fn get_total_memory_bytes() -> u64 {
    // Try /proc/meminfo first (Linux / Docker)
    if let Ok(contents) = std::fs::read_to_string("/proc/meminfo") {
        for line in contents.lines() {
            if let Some(rest) = line.strip_prefix("MemTotal:") {
                let rest = rest.trim();
                if let Some(kb_str) = rest.strip_suffix("kB").or(rest.strip_suffix("KB")) {
                    if let Ok(kb) = kb_str.trim().parse::<u64>() {
                        return kb * 1024;
                    }
                }
            }
        }
    }
    // macOS: sysctl hw.memsize
    if let Ok(output) = std::process::Command::new("sysctl")
        .arg("-n")
        .arg("hw.memsize")
        .output()
    {
        if let Ok(s) = std::str::from_utf8(&output.stdout) {
            if let Ok(bytes) = s.trim().parse::<u64>() {
                return bytes;
            }
        }
    }
    0 // unknown
}

// ── Continuous Parity Mode ──────────────────────────────────────────

#[cfg(feature = "storage")]
fn run_continuous_mode(cli: &Cli) {
    use forge_parity::infra::storage::Storage;
    use forge_parity::scheduler::Scheduler;
    use std::time::Instant;

    let jar_path = match &cli.java_jar {
        Some(p) => p.clone(),
        None => {
            eprintln!("[parity] --continuous requires --java-jar");
            std::process::exit(1);
        }
    };

    let max_games = cli.max_games.unwrap_or(100);
    if cli.is_verbose() {
        eprintln!(
            "[parity] Continuous mode: max_games={}, threshold={:.1}%, db={}",
            max_games,
            cli.threshold * 100.0,
            cli.db_path
        );
    }

    // Open database
    let db = match Storage::open(&cli.db_path) {
        Ok(db) => db,
        Err(e) => {
            eprintln!("[parity] Failed to open database: {}", e);
            std::process::exit(1);
        }
    };

    // Load card database
    let data = load_data_or_exit(cli);

    // Discover preset decks
    let dd = deck_search_dirs(cli.decks_dir.as_deref());
    let deck_names: Vec<String> = filter_decks(
        match &cli.decks {
            Some(d) => d.clone(),
            None => available_presets(&dd),
        },
        &cli.exclude_prefix,
    );

    if deck_names.is_empty() {
        eprintln!("[parity] No preset decks found in {}", dd.join(", "));
        std::process::exit(1);
    }
    if cli.is_verbose() {
        eprintln!(
            "[parity] Using {} preset decks: {:?}",
            deck_names.len(),
            deck_names
        );
    }

    // Initialize scheduler
    let fuzz_db = if cli.fuzz_per_batch > 0 {
        Some(&data.db)
    } else {
        None
    };
    let mut scheduler =
        Scheduler::new(&deck_names, cli.seed, cli.fuzz_per_batch, fuzz_db, false, 1);

    // Resume from the last pair played so the matrix completes across restarts.
    // Seeds restart from cli.seed so the Java cache gives instant hits.
    if let Ok(Some((d1, d2))) = db.last_preset_pair() {
        if scheduler.resume_after(&d1, &d2) {
            eprintln!("[parity] Resuming after {} vs {}", d1, d2);
        }
    }

    // Spawn Java server
    let server_config = JavaServerConfig {
        jar_path: jar_path.clone(),
        forge_home: None,
        decks_dir: cli.decks_dir.clone(),
        verbose: cli.is_verbose(),
        java_heap: cli.java_heap.clone(),
    };
    let mut server = match JavaServer::spawn(&server_config) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[parity] Failed to spawn Java server: {}", e);
            std::process::exit(1);
        }
    };

    let start = Instant::now();
    let mut completed = 0usize;
    let mut passed = 0usize;
    let mut skipped = 0usize;
    let mut failed = 0usize;
    let mut errors = 0usize;

    // Main loop
    while completed < max_games {
        let job = scheduler.next_job();

        let config = build_config(cli, &job.deck1, &job.deck2, job.seed);

        let game_start = Instant::now();

        // Respawn server if dead
        if !server.is_alive() {
            eprintln!("[parity] Java server died, respawning...");
            server = match JavaServer::spawn(&server_config) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[parity] Failed to respawn Java server: {}", e);
                    break;
                }
            };
        }

        let result = run_single_matchup_server(&config, &data, &mut server);
        let duration_ms = game_start.elapsed().as_millis() as u64;

        match result.status {
            MatchupStatus::Pass => passed += 1,
            MatchupStatus::Skipped => skipped += 1,
            MatchupStatus::Fail => failed += 1,
            MatchupStatus::Error => errors += 1,
        }
        completed += 1;

        if let Err(e) = db.insert_run(job.batch_id, &result, duration_ms, job.is_fuzz, None) {
            eprintln!("[parity] DB insert error: {}", e);
        }

        // Progress logging
        if cli.is_verbose() {
            let status_char = match result.status {
                MatchupStatus::Pass => "\x1b[32mPASS\x1b[0m",
                MatchupStatus::Skipped => "\x1b[34mSKIP\x1b[0m",
                MatchupStatus::Fail => "\x1b[31mFAIL\x1b[0m",
                MatchupStatus::Error => "\x1b[33mERROR\x1b[0m",
            };
            let current_rate = if passed + failed > 0 {
                passed as f64 / (passed + failed) as f64
            } else {
                0.0
            };
            eprintln!(
                "[parity] [{}/{}] {} vs {} seed={} {} (rate={:.1}%, {}ms)",
                completed,
                max_games,
                short_deck(&job.deck1),
                short_deck(&job.deck2),
                job.seed,
                status_char,
                current_rate * 100.0,
                duration_ms
            );
        }
    }

    server.shutdown();

    let elapsed = start.elapsed();
    let pass_rate = if passed + failed > 0 {
        passed as f64 / (passed + failed) as f64
    } else {
        0.0
    };
    let gpm = if elapsed.as_secs() > 0 {
        completed as f64 / (elapsed.as_secs() as f64 / 60.0)
    } else {
        0.0
    };

    eprintln!();
    eprintln!("=== Continuous Parity Summary ===");
    eprintln!("  Total games:    {}", completed);
    eprintln!(
        "  Passed:         {} ({:.1}%)",
        passed,
        if completed > 0 {
            passed as f64 / completed as f64 * 100.0
        } else {
            0.0
        }
    );
    eprintln!("  Failed:         {}", failed);
    eprintln!("  Skipped:        {}", skipped);
    eprintln!("  Errors:         {}", errors);
    eprintln!(
        "  Pass rate:      {:.1}% (threshold: {:.1}%)",
        pass_rate * 100.0,
        cli.threshold * 100.0
    );
    eprintln!(
        "  Duration:       {:.1}s ({:.1} games/min)",
        elapsed.as_secs_f64(),
        gpm
    );
    eprintln!("  Database:       {}", cli.db_path);
    eprintln!();

    if pass_rate >= cli.threshold {
        eprintln!(
            "\x1b[32mPASSED\x1b[0m — pass rate {:.1}% >= threshold {:.1}%",
            pass_rate * 100.0,
            cli.threshold * 100.0
        );
        std::process::exit(0);
    } else {
        eprintln!(
            "\x1b[31mFAILED\x1b[0m — pass rate {:.1}% < threshold {:.1}%",
            pass_rate * 100.0,
            cli.threshold * 100.0
        );
        std::process::exit(1);
    }
}

/// Shorten an inline deck spec for display.
#[cfg(feature = "storage")]
fn short_deck(spec: &str) -> &str {
    if let Some(rest) = spec.strip_prefix("inline:") {
        let first_pipe = rest.find('|').unwrap_or(rest.len());
        &spec[..("inline:".len() + first_pipe).min(spec.len()).min(30)]
    } else if spec.len() > 20 {
        &spec[..20]
    } else {
        spec
    }
}

// ── Serve Mode ──────────────────────────────────────────────────────

#[cfg(feature = "serve")]
fn run_serve_mode(cli: &Cli) {
    use forge_parity::infra::storage::Storage;
    use forge_parity::infra::web::{self, DashboardConfig};
    use forge_parity::log_buffer::{BufferLayer, LogBuffer};
    use forge_parity::scheduler::Scheduler;
    use std::backtrace::Backtrace;
    use std::sync::atomic::Ordering;
    use std::sync::Arc;
    use std::time::Instant;
    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::util::SubscriberInitExt;

    // Init tracing with ring-buffer layer + stderr output
    let log_buffer = LogBuffer::new();
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .with_target(true)
                .with_writer(std::io::stderr),
        )
        .with(BufferLayer::new(log_buffer.clone()))
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(&cli.log_level)),
        )
        .init();

    std::panic::set_hook(Box::new(|panic_info| {
        let location = panic_info
            .location()
            .map(|loc| format!("{}:{}", loc.file(), loc.line()))
            .unwrap_or_else(|| "unknown location".to_string());
        let payload = panic_info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_string())
            .or_else(|| panic_info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "non-string panic payload".to_string());
        let backtrace = Backtrace::force_capture();
        tracing::error!(
            location = %location,
            payload = %payload,
            backtrace = %backtrace,
            "forge-parity panicked"
        );
    }));

    let jar_path = match &cli.java_jar {
        Some(p) => p.clone(),
        None => {
            tracing::error!("--serve requires --java-jar");
            std::process::exit(1);
        }
    };

    let max_games = cli.max_games; // None = unlimited
    let port = cli.port;

    tracing::info!(
        port,
        max_games = max_games.map(|n| n as i64).unwrap_or(-1),
        threshold = cli.threshold * 100.0,
        db = %cli.db_path,
        "Serve mode starting"
    );

    // Open database
    let db = match Storage::open(&cli.db_path) {
        Ok(db) => db,
        Err(e) => {
            tracing::error!(%e, "Failed to open database");
            std::process::exit(1);
        }
    };

    // Load card database
    let data = load_data_or_exit(cli);

    // Discover preset decks
    let dd = deck_search_dirs(cli.decks_dir.as_deref());
    let deck_names: Vec<String> = filter_decks(
        match &cli.decks {
            Some(d) => d.clone(),
            None => available_presets(&dd),
        },
        &cli.exclude_prefix,
    );

    if deck_names.is_empty() {
        tracing::error!(dirs = ?dd, "No preset decks found");
        std::process::exit(1);
    }
    tracing::info!(count = deck_names.len(), decks = ?deck_names, "Preset decks loaded");

    // Create shared dashboard config
    let dashboard_config = Arc::new(DashboardConfig::new());
    dashboard_config
        .fuzz_enabled
        .store(cli.fuzz_per_batch > 0, Ordering::Relaxed);
    if cli.analyze {
        dashboard_config
            .analysis_running
            .store(true, Ordering::Relaxed);
    }

    let initial_fuzz = cli.fuzz_per_batch > 0;
    let fuzz_db = if initial_fuzz { Some(&data.db) } else { None };
    let initial_fuzz_per_batch = if initial_fuzz { cli.fuzz_per_batch } else { 0 };
    let mut scheduler = Scheduler::new(
        &deck_names,
        cli.seed,
        initial_fuzz_per_batch,
        fuzz_db,
        dashboard_config.self_matchups.load(Ordering::Relaxed),
        dashboard_config.games_per_matchup.load(Ordering::Relaxed),
    );

    // Resume from the last pair played so the matrix completes across restarts.
    // Seeds restart from cli.seed so the Java cache gives instant hits.
    if let Ok(Some((d1, d2))) = db.last_preset_pair() {
        if scheduler.resume_after(&d1, &d2) {
            tracing::info!(
                last_deck1 = %d1,
                last_deck2 = %d2,
                "Resuming matrix after last played pair"
            );
        }
    }

    // Spawn Java server pool so jobs can run in parallel. Falls back to 1
    // worker if memory is tight; matches the --matrix path's defaults.
    let server_config = JavaServerConfig {
        jar_path: jar_path.clone(),
        forge_home: None,
        decks_dir: cli.decks_dir.clone(),
        verbose: cli.is_verbose(),
        java_heap: cli.java_heap.clone(),
    };
    let num_workers = cli
        .java_workers
        .unwrap_or_else(|| max_workers_for_memory(&cli.java_heap))
        .max(1);
    let server_pool = match ServerPool::spawn(num_workers, &server_config) {
        Ok(p) => {
            tracing::info!(workers = num_workers, "Java server pool spawned");
            p
        }
        Err(e) => {
            tracing::error!(%e, "Failed to spawn Java server pool");
            std::process::exit(1);
        }
    };

    // Open Java output cache so unchanged Java source short-circuits the Java
    // run entirely. Keyed on a hash of Java source + deck definitions — when
    // that changes the cache is wiped automatically.
    let java_cache: Option<JavaCache> = if cli.no_cache {
        None
    } else {
        let project_root = std::env::current_dir().unwrap_or_default();
        let source_hash = if project_root.join("forge/forge-harness/src").exists() {
            java_cache::compute_source_hash(&project_root)
        } else {
            java_cache::compute_jar_hash(&jar_path).unwrap_or_default()
        };
        match JavaCache::open(std::path::Path::new(&cli.cache_dir), source_hash) {
            Ok(c) => {
                tracing::info!(
                    cache_dir = %cli.cache_dir,
                    source_hash = %c.source_hash(),
                    entries = c.len(),
                    "Java cache opened"
                );
                Some(c)
            }
            Err(e) => {
                tracing::warn!(%e, "Failed to open Java cache — continuing without");
                None
            }
        }
    };

    let job_queue = Arc::new(web::JobQueue::new());

    let now_iso = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let start = Instant::now();
    // Detect git commit SHA at startup
    let commit_sha = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        })
        .or_else(|| std::env::var("GIT_COMMIT_SHA").ok());

    let app_state = Arc::new(web::AppState {
        storage: std::sync::Mutex::new(db),
        start_time: start,
        start_time_iso: now_iso,
        config: Arc::clone(&dashboard_config),
        logs: log_buffer,
        job_queue: Arc::clone(&job_queue),
        commit_sha,
        exclude_prefixes: cli.exclude_prefix.clone(),
    });

    // Build tokio runtime
    let rt = tokio::runtime::Runtime::new().expect("failed to create tokio runtime");

    // Spawn web server in background
    let app_state_web = Arc::clone(&app_state);
    rt.spawn(async move {
        let router = web::build_router(app_state_web);
        let listener = match tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port)).await {
            Ok(listener) => listener,
            Err(e) => {
                tracing::error!(%e, port, "Failed to bind dashboard port");
                return;
            }
        };
        tracing::info!(port, "Dashboard available at http://localhost:{}", port);
        if let Err(e) = axum::serve(listener, router).await {
            tracing::error!(%e, port, "Dashboard server exited");
        }
    });

    // Always spawn analysis daemon (paused by default, toggle via dashboard)
    #[cfg(feature = "analyze")]
    {
        use forge_parity::infra::analyzer::{self, AnalyzerConfig};

        let analyzer_db = match Storage::open(&cli.db_path) {
            Ok(db) => db,
            Err(e) => {
                tracing::error!(%e, "Failed to open analyzer database");
                std::process::exit(1);
            }
        };
        let analyzer_storage = Arc::new(std::sync::Mutex::new(analyzer_db));
        let analysis_running = Arc::clone(&dashboard_config.analysis_running);
        let analyzer_config = AnalyzerConfig {
            poll_interval: std::time::Duration::from_secs(cli.poll_interval),
            summary_interval: std::time::Duration::from_secs(cli.summary_interval),
            issue_threshold: resolve_issue_threshold(cli.issue_threshold),
            github_repo: resolve_github_repo(cli.github_repo.clone()),
            dashboard_url: Some(format!("http://localhost:{}", port)),
            java_jar: cli
                .java_jar
                .as_ref()
                .map(|p| p.to_string_lossy().to_string()),
            cards_dir: cli.cards_dir.clone(),
            project_root: std::env::current_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| ".".to_string()),
        };

        rt.spawn(async move {
            analyzer::run(analyzer_storage, analyzer_config, analysis_running).await;
        });
        tracing::info!(running = cli.analyze, "Analysis daemon spawned");
    }

    // Run game loop on main thread (blocking)
    let ci_mode = cli.ci;
    let cli_max_turns = cli.max_turns;
    let cli_cards_dir = cli.cards_dir.clone();
    let cli_decks_dir = cli.decks_dir.clone();
    let cli_verbose = cli.verbose_mode();
    let cli_prefer_actions = cli.prefer_actions;
    let cli_java_heap = cli.java_heap.clone();
    let cfg = Arc::clone(&dashboard_config);

    let mut completed = 0usize;
    let cache_hits = AtomicUsize::new(0);
    let cache_misses = AtomicUsize::new(0);
    // Track config values to detect changes and rebuild scheduler
    let mut prev_games_per_matchup = cfg.games_per_matchup.load(Ordering::Relaxed);
    let mut prev_fuzz_enabled = cfg.fuzz_enabled.load(Ordering::Relaxed);
    let mut prev_self_matchups = cfg.self_matchups.load(Ordering::Relaxed);

    loop {
        // 1. Drain up to N queued jobs (API-submitted; takes priority over scheduler)
        let drained: Vec<web::QueuedJob> = {
            let mut queue = job_queue.queue.lock().unwrap();
            let mut batch_jobs = Vec::with_capacity(num_workers);
            while batch_jobs.len() < num_workers {
                match queue.pop_front() {
                    Some(j) => batch_jobs.push(j),
                    None => break,
                }
            }
            batch_jobs
        };

        if !drained.is_empty() {
            // Mark each as active for its batch (best-effort; last-write wins).
            {
                let mut batches = job_queue.batches.lock().unwrap();
                for queued_job in &drained {
                    if let Some(batch) = batches.get_mut(&queued_job.batch_id) {
                        batch.active_job = Some(web::ActiveJob {
                            regression_name: queued_job.regression_name.clone(),
                            deck1: queued_job.deck1.clone(),
                            deck2: queued_job.deck2.clone(),
                            seed: queued_job.seed,
                            max_turns: queued_job.max_turns,
                        });
                    }
                }
            }

            // Run all jobs concurrently via rayon. Each closure consults the
            // Java cache first; misses fall through to the shared server pool.
            let pool_ref = &server_pool;
            let cache_ref = java_cache.as_ref();
            let data_ref = &data;
            let cci = &cli_cards_dir;
            let ccd = &cli_decks_dir;
            let ccv = &cli_verbose;
            let cjh = &cli_java_heap;

            let served: Vec<(web::QueuedJob, ServedMatchup)> = drained
                .into_par_iter()
                .map(|queued_job| {
                    let config = RunConfig {
                        deck1: queued_job.deck1.clone(),
                        deck2: queued_job.deck2.clone(),
                        seed: queued_job.seed,
                        max_turns: queued_job.max_turns,
                        deep: queued_job.deep,
                        loose_parity: false,
                        log_snapshots: false,
                        cards_dir: cci.clone(),
                        decks_dir: ccd.clone(),
                        verbose: ccv.clone(),
                        prefer_actions: queued_job.prefer_actions,
                        java_heap: cjh.clone(),
                        variant: queued_job.variant.clone(),
                        commanders: queued_job.commanders.clone(),
                        full_log: false,
                        live_log: None,
                    };
                    let m = run_matchup_cached(&config, data_ref, pool_ref, cache_ref);
                    if m.cache_hit {
                        cache_hits.fetch_add(1, Ordering::Relaxed);
                    } else if !matches!(m.result.status, MatchupStatus::Error) {
                        cache_misses.fetch_add(1, Ordering::Relaxed);
                    }
                    (queued_job, m)
                })
                .collect();

            // Serialize bookkeeping per-result.
            for (queued_job, served) in served {
                let ServedMatchup {
                    result,
                    duration_ms,
                    cache_hit,
                } = served;
                let status_str = match result.status {
                    MatchupStatus::Pass => "pass",
                    MatchupStatus::Skipped => "skipped",
                    MatchupStatus::Fail => "fail",
                    MatchupStatus::Error => "error",
                };

                tracing::info!(
                    batch = queued_job.batch_id,
                    regression = %queued_job.regression_name,
                    deck1 = %short_deck(&queued_job.deck1),
                    deck2 = %short_deck(&queued_job.deck2),
                    seed = queued_job.seed,
                    ms = duration_ms,
                    cache = cache_hit,
                    status = status_str,
                    "CI job"
                );

                {
                    let mut batches = job_queue.batches.lock().unwrap();
                    if let Some(batch) = batches.get_mut(&queued_job.batch_id) {
                        batch.completed += 1;
                        batch.active_job = None;
                        match result.status {
                            MatchupStatus::Pass => batch.passed += 1,
                            MatchupStatus::Skipped => batch.skipped += 1,
                            MatchupStatus::Fail => batch.failed += 1,
                            MatchupStatus::Error => batch.errors += 1,
                        }
                        let (div_field, rust_val, java_val, div_loc) =
                            if let Some(ref div) = result.first_divergence {
                                (
                                    Some(div.field.clone()),
                                    Some(div.rust_value.clone()),
                                    Some(div.java_value.clone()),
                                    Some(format!("turn {} {}", div.turn, div.phase)),
                                )
                            } else {
                                (None, None, None, None)
                            };
                        batch.push_result(web::JobResult {
                            deck1: queued_job.deck1.clone(),
                            deck2: queued_job.deck2.clone(),
                            seed: queued_job.seed,
                            status: status_str.to_string(),
                            error: result.error_message.clone(),
                            divergence_field: div_field,
                            rust_value: rust_val,
                            java_value: java_val,
                            divergence_location: div_loc,
                            rust_trace: result
                                .rust_snapshot
                                .clone()
                                .map(|s| serde_json::to_string(&s).unwrap_or_default()),
                            java_trace: result
                                .java_snapshot
                                .clone()
                                .map(|s| serde_json::to_string(&s).unwrap_or_default()),
                        });
                        if batch.completed >= batch.total {
                            batch.done = true;
                        }
                    }
                }

                {
                    let storage = app_state.storage.lock().unwrap();
                    if let Err(e) = storage.insert_run(
                        0,
                        &result,
                        duration_ms,
                        false,
                        app_state.commit_sha.as_deref(),
                    ) {
                        tracing::error!(%e, "DB insert error");
                    }
                }

                completed += 1;
            }
            continue;
        }

        // 2. CI mode: if queue is empty, check if we should exit
        if ci_mode {
            let batches = job_queue.batches.lock().unwrap();
            if batches.is_empty() {
                // No batch submitted yet — idle-wait
                drop(batches);
                std::thread::sleep(std::time::Duration::from_millis(100));
                continue;
            }
            let all_done = batches.values().all(|b| b.done);
            if all_done {
                // Log summary but keep server alive for CI to poll results
                for (id, batch) in batches.iter() {
                    tracing::info!(
                        batch_id = id,
                        name = %batch.name,
                        total = batch.total,
                        passed = batch.passed,
                        failed = batch.failed,
                        errors = batch.errors,
                        "Batch complete — waiting for CI to poll results"
                    );
                }
            }
            drop(batches);
            // Keep server alive — CI will kill via server.pid after reading results
            std::thread::sleep(std::time::Duration::from_millis(100));
            continue;
        }

        // 3. Normal scheduler path (non-CI mode)

        // Pause check: if games are paused, sleep and retry
        if cfg.games_paused.load(Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_secs(1));
            continue;
        }

        if let Some(max) = max_games {
            if completed >= max {
                break;
            }
        }

        // Read live config from dashboard UI
        let games_per_matchup = cfg.games_per_matchup.load(Ordering::Relaxed);
        let fuzz_enabled = cfg.fuzz_enabled.load(Ordering::Relaxed);
        let self_matchups = cfg.self_matchups.load(Ordering::Relaxed);

        // Rebuild scheduler if config changed
        if games_per_matchup != prev_games_per_matchup
            || fuzz_enabled != prev_fuzz_enabled
            || self_matchups != prev_self_matchups
        {
            let fuzz_per = if fuzz_enabled {
                cli.fuzz_per_batch.max(5)
            } else {
                0
            };
            let fdb = if fuzz_enabled { Some(&data.db) } else { None };
            scheduler = Scheduler::new(
                &deck_names,
                cli.seed,
                fuzz_per,
                fdb,
                self_matchups,
                games_per_matchup,
            );
            // Resume from last pair played
            {
                let storage = app_state.storage.lock().unwrap();
                if let Ok(Some((d1, d2))) = storage.last_preset_pair() {
                    scheduler.resume_after(&d1, &d2);
                }
            }
            tracing::info!(
                games_per_matchup,
                fuzz_enabled,
                self_matchups,
                pairs = scheduler.preset_pairs_count(),
                "Config changed — scheduler rebuilt"
            );
            prev_games_per_matchup = games_per_matchup;
            prev_fuzz_enabled = fuzz_enabled;
            prev_self_matchups = self_matchups;
        }

        let job = scheduler.next_job();

        let config = RunConfig {
            deck1: job.deck1.clone(),
            deck2: job.deck2.clone(),
            seed: job.seed,
            max_turns: cli_max_turns,
            cards_dir: cli_cards_dir.clone(),
            decks_dir: cli_decks_dir.clone(),
            verbose: cli_verbose.clone(),
            prefer_actions: cli_prefer_actions,
            deep: cli.deep,
            loose_parity: cli.loose_parity,
            java_heap: cli_java_heap.clone(),
            variant: "Constructed".to_string(),
            commanders: vec![],
            full_log: false,
            log_snapshots: false,
            live_log: None,
        };

        let served = run_matchup_cached(&config, &data, &server_pool, java_cache.as_ref());
        if served.cache_hit {
            cache_hits.fetch_add(1, Ordering::Relaxed);
        } else if !matches!(served.result.status, MatchupStatus::Error) {
            cache_misses.fetch_add(1, Ordering::Relaxed);
        }
        let duration_ms = served.duration_ms;
        let result = served.result;

        completed += 1;

        match result.status {
            MatchupStatus::Pass => {
                tracing::info!(
                    game = completed,
                    deck1 = %short_deck(&job.deck1),
                    deck2 = %short_deck(&job.deck2),
                    seed = job.seed,
                    ms = duration_ms,
                    "PASS"
                );
            }
            MatchupStatus::Skipped => {
                tracing::info!(
                    game = completed,
                    deck1 = %short_deck(&job.deck1),
                    deck2 = %short_deck(&job.deck2),
                    seed = job.seed,
                    ms = duration_ms,
                    reason = result.skip_reason.as_deref().unwrap_or("-"),
                    "SKIPPED"
                );
            }
            MatchupStatus::Fail => {
                tracing::warn!(
                    game = completed,
                    deck1 = %short_deck(&job.deck1),
                    deck2 = %short_deck(&job.deck2),
                    seed = job.seed,
                    ms = duration_ms,
                    field = result.first_divergence.as_ref().map(|d| d.field.as_str()).unwrap_or("-"),
                    "FAIL"
                );
            }
            MatchupStatus::Error => {
                tracing::error!(
                    game = completed,
                    deck1 = %short_deck(&job.deck1),
                    deck2 = %short_deck(&job.deck2),
                    seed = job.seed,
                    ms = duration_ms,
                    "ERROR"
                );
            }
        }

        // Write to storage under lock
        {
            let storage = app_state.storage.lock().unwrap();
            if let Err(e) = storage.insert_run(
                job.batch_id,
                &result,
                duration_ms,
                job.is_fuzz,
                app_state.commit_sha.as_deref(),
            ) {
                tracing::error!(%e, "DB insert error");
            }
        }

        // Throttle: sleep between games to avoid pegging CPU
        let delay = cfg.game_delay_ms.load(Ordering::Relaxed);
        if delay > 0 {
            std::thread::sleep(std::time::Duration::from_millis(delay as u64));
        }
    }

    server_pool.shutdown();
    tracing::info!(
        games = completed,
        cache_hits = cache_hits.load(Ordering::Relaxed),
        cache_misses = cache_misses.load(Ordering::Relaxed),
        "Serve mode complete"
    );
}

// ── Analyze-only Mode ──────────────────────────────────────────────

#[cfg(feature = "analyze")]
fn run_analyze_only(cli: &Cli) {
    use forge_parity::infra::analyzer::{self, AnalyzerConfig};
    use forge_parity::infra::storage::Storage;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    if cli.is_verbose() {
        eprintln!(
            "[parity] Analyze-only mode: db={}, poll={}s, summary={}s, threshold={}",
            cli.db_path, cli.poll_interval, cli.summary_interval, cli.issue_threshold
        );
    }

    let db = match Storage::open(&cli.db_path) {
        Ok(db) => db,
        Err(e) => {
            eprintln!("[parity] Failed to open database: {}", e);
            std::process::exit(1);
        }
    };

    let storage = Arc::new(std::sync::Mutex::new(db));
    // In analyze-only mode, always running
    let running = Arc::new(AtomicBool::new(true));
    let config = AnalyzerConfig {
        poll_interval: std::time::Duration::from_secs(cli.poll_interval),
        summary_interval: std::time::Duration::from_secs(cli.summary_interval),
        issue_threshold: cli.issue_threshold,
        github_repo: cli.github_repo.clone(),
        dashboard_url: Some(format!("http://localhost:{}", cli.port)),
        java_jar: cli
            .java_jar
            .as_ref()
            .map(|p| p.to_string_lossy().to_string()),
        cards_dir: cli.cards_dir.clone(),
        project_root: std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string()),
    };

    let rt = tokio::runtime::Runtime::new().expect("failed to create tokio runtime");
    rt.block_on(async {
        analyzer::run(storage, config, running).await;
    });
}
