//! Trace-worker thread: drives Rust / Java / side-by-side parity runs and streams
//! results back to the egui frontend over a `mpsc` channel pair.
//!
//! The frontend (`App`) talks to the worker via a [`TraceWorkerHandle`]; the worker
//! owns the long-lived `LoadedData` cache and the `JavaServer` subprocess so that
//! repeated runs reuse them. Run commands are dispatched through [`spawn`].

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;

use parity::java_bridge::{JavaBridgeError, JavaMatchupData, JavaServer, JavaServerConfig};
use parity::parity_compare::{compare_matchup, compare_matchup_partial_logs};
use parity::protocol::{GameTrace, MatchupResult, ParityLogEntry};
use parity::runner::{load_data, run_with_data_streaming, LoadedData, RunConfig};
use parity::runtime::ParityRuntime;

use crate::{
    discover_java_jar, repo_relative_path, repo_root, TraceMode, TracePaneKind,
    DEFAULT_JAVA_JAR_PATH,
};

const HARNESS_SCRIPT_PATH: &str = "scripts/harness.mjs";
const TRACE_THREAD_STACK_SIZE: usize = 64 * 1024 * 1024;

/// Handle returned by [`spawn`]; the egui side keeps one of these to talk to
/// the worker thread.
pub(crate) struct TraceWorkerHandle {
    pub(crate) command_tx: Sender<TraceWorkerCommand>,
    pub(crate) event_rx: Receiver<TraceWorkerEvent>,
}

pub(crate) enum TraceWorkerCommand {
    Preload,
    PrewarmJava(PathBuf),
    BuildJavaHarness,
    Abort,
    RunTrace(TraceRunRequest),
}

pub(crate) enum TraceWorkerEvent {
    Status(String),
    Debug(String),
    Entry {
        pane: TracePaneKind,
        entry: ParityLogEntry,
    },
    CompareUpdate(MatchupResult),
    Preloaded(Result<(), String>),
    JavaPrewarmed(Result<(), String>),
    JavaHarnessBuilt(Result<PathBuf, String>),
    Finished(Result<TraceFinished, String>),
}

pub(crate) struct TraceRunRequest {
    pub(crate) mode: TraceMode,
    pub(crate) config: RunConfig,
    pub(crate) java_jar_path: PathBuf,
}

pub(crate) struct TraceFinished {
    pub(crate) rust: Option<GameTrace>,
    pub(crate) java: Option<JavaMatchupData>,
    pub(crate) compare_result: Option<MatchupResult>,
}

/// Poison-tolerant `lock()` helper.
///
/// A panic in any earlier holder of these mutexes shouldn't cascade-panic every
/// subsequent compare pass. The contents (logs, simple values) are still safe
/// to read after a poisoning event, so we'd rather continue best-effort than
/// take down the whole worker.
fn lock_pt<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Spawn the trace-worker thread.
///
/// Returns a [`TraceWorkerHandle`] that the caller uses to send commands and
/// receive events. The thread loops on `command_rx.recv()` until the channel
/// closes (i.e. the handle is dropped), so the worker terminates cleanly when
/// the egui frontend goes away.
pub(crate) fn spawn() -> std::io::Result<TraceWorkerHandle> {
    let (command_tx, command_rx) = mpsc::channel::<TraceWorkerCommand>();
    let (event_tx, event_rx) = mpsc::channel::<TraceWorkerEvent>();
    thread::Builder::new()
        .name("debugger-trace-worker".to_string())
        .stack_size(TRACE_THREAD_STACK_SIZE)
        .spawn(move || worker_loop(command_rx, event_tx))?;
    Ok(TraceWorkerHandle {
        command_tx,
        event_rx,
    })
}

fn worker_loop(command_rx: Receiver<TraceWorkerCommand>, event_tx: Sender<TraceWorkerEvent>) {
    let mut loaded_data: Option<LoadedData> = None;
    let mut java_server: Option<JavaServer> = None;
    let mut java_server_jar: Option<PathBuf> = None;
    let mut active_abort: Option<Arc<AtomicBool>> = None;
    while let Ok(command) = command_rx.recv() {
        match command {
            TraceWorkerCommand::Preload => {
                let result = ensure_loaded_data(&event_tx, &mut loaded_data).map(|_| ());
                let _ = event_tx.send(TraceWorkerEvent::Preloaded(result));
            }
            TraceWorkerCommand::PrewarmJava(jar_path) => {
                let result = ensure_java_server(
                    &event_tx,
                    &mut java_server,
                    &mut java_server_jar,
                    &jar_path,
                )
                .map(|_| ());
                let _ = event_tx.send(TraceWorkerEvent::JavaPrewarmed(result));
            }
            TraceWorkerCommand::BuildJavaHarness => {
                let result = build_java_harness(&event_tx);
                let _ = event_tx.send(TraceWorkerEvent::JavaHarnessBuilt(result));
            }
            TraceWorkerCommand::Abort => {
                if let Some(abort) = active_abort.as_ref() {
                    abort.store(true, Ordering::Relaxed);
                }
            }
            TraceWorkerCommand::RunTrace(request) => {
                let abort = Arc::new(AtomicBool::new(false));
                active_abort = Some(abort.clone());
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    run_trace_request(
                        &event_tx,
                        &mut loaded_data,
                        &mut java_server,
                        &mut java_server_jar,
                        abort,
                        request,
                    )
                }));
                active_abort = None;
                let finished = match result {
                    Ok(result) => TraceWorkerEvent::Finished(result),
                    Err(panic) => {
                        // The closure held mutable borrows on
                        // loaded_data / java_server / java_server_jar.
                        // After an unwind their contents may be mid-operation;
                        // force the next RunTrace to rebuild from scratch rather
                        // than reuse potentially corrupt state.
                        loaded_data = None;
                        java_server = None;
                        java_server_jar = None;
                        let message = if let Some(message) = panic.downcast_ref::<String>() {
                            message.clone()
                        } else if let Some(message) = panic.downcast_ref::<&str>() {
                            (*message).to_string()
                        } else {
                            "trace worker panicked".to_string()
                        };
                        TraceWorkerEvent::Finished(Err(message))
                    }
                };
                let _ = event_tx.send(finished);
            }
        }
    }
}

fn ensure_loaded_data<'a>(
    event_tx: &Sender<TraceWorkerEvent>,
    loaded_data: &'a mut Option<LoadedData>,
) -> Result<&'a LoadedData, String> {
    if loaded_data.is_none() {
        let _ = event_tx.send(TraceWorkerEvent::Status(
            "Loading card database…".to_string(),
        ));
        *loaded_data = Some(load_data(None, false)?);
    } else {
        let _ = event_tx.send(TraceWorkerEvent::Status(
            "Using cached card database…".to_string(),
        ));
    }
    Ok(loaded_data.as_ref().expect("loaded_data just initialized"))
}

fn build_java_harness(event_tx: &Sender<TraceWorkerEvent>) -> Result<PathBuf, String> {
    let root = repo_root();
    let script_path = repo_relative_path(HARNESS_SCRIPT_PATH);
    let _ = event_tx.send(TraceWorkerEvent::Status(
        "Building Java harness…".to_string(),
    ));
    let mut child = Command::new("node")
        .arg(&script_path)
        .arg("ensure")
        .current_dir(&root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("failed to launch Node for Java harness build: {err}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_tx = event_tx.clone();
    let stderr_tx = event_tx.clone();
    let stdout_handle = thread::spawn(move || {
        let mut last_line = None;
        if let Some(stdout) = stdout {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                last_line = Some(trimmed.to_string());
                let _ = stdout_tx.send(TraceWorkerEvent::Status(format!("Java build: {trimmed}")));
            }
        }
        last_line
    });
    let stderr_handle = thread::spawn(move || {
        let mut last_line = None;
        if let Some(stderr) = stderr {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                last_line = Some(trimmed.to_string());
                let _ = stderr_tx.send(TraceWorkerEvent::Status(format!("Java build: {trimmed}")));
            }
        }
        last_line
    });

    let status = child
        .wait()
        .map_err(|err| format!("failed while waiting for Java harness build: {err}"))?;
    let last_stdout = stdout_handle.join().ok().flatten();
    let last_stderr = stderr_handle.join().ok().flatten();
    if !status.success() {
        let details = last_stderr
            .or(last_stdout)
            .unwrap_or_else(|| format!("exit code {}", status.code().unwrap_or(1)));
        return Err(format!("Java harness build failed: {details}"));
    }
    discover_java_jar(Some(&repo_relative_path(DEFAULT_JAVA_JAR_PATH)))
        .ok_or_else(|| "Java harness build completed but the JAR is still missing".to_string())
}

fn ensure_java_server<'a>(
    event_tx: &Sender<TraceWorkerEvent>,
    java_server: &'a mut Option<JavaServer>,
    java_server_jar: &'a mut Option<PathBuf>,
    jar_path: &Path,
) -> Result<&'a mut JavaServer, String> {
    let needs_respawn = java_server.is_none()
        || java_server_jar
            .as_ref()
            .is_none_or(|current| current.as_path() != jar_path);
    if needs_respawn {
        let _ = event_tx.send(TraceWorkerEvent::Status(
            "Starting Java server…".to_string(),
        ));
        let config = JavaServerConfig {
            jar_path: jar_path.to_path_buf(),
            forge_home: None,
            decks_dir: None,
            verbose: false,
            java_heap: "2g".to_string(),
        };
        *java_server = Some(JavaServer::spawn(&config).map_err(format_java_error)?);
        *java_server_jar = Some(jar_path.to_path_buf());
    }
    java_server
        .as_mut()
        .ok_or_else(|| "java server unavailable".to_string())
}

fn format_java_error(err: JavaBridgeError) -> String {
    format!("Java error: {err}")
}

fn send_stream_entry(
    event_tx: &Sender<TraceWorkerEvent>,
    pane: TracePaneKind,
    entry: ParityLogEntry,
) {
    let _ = event_tx.send(TraceWorkerEvent::Entry { pane, entry });
}

fn try_emit_partial_compare(
    event_tx: &Sender<TraceWorkerEvent>,
    config: &RunConfig,
    rust_log: &Arc<Mutex<Vec<ParityLogEntry>>>,
    java_log: &Arc<Mutex<Vec<ParityLogEntry>>>,
    compare_emitted: &Arc<AtomicBool>,
    stop_after_turn: &Arc<Mutex<Option<u32>>>,
    source: &str,
) -> bool {
    if compare_emitted.load(Ordering::Relaxed) {
        return false;
    }
    let rust_log = lock_pt(rust_log).clone();
    let java_log = lock_pt(java_log).clone();
    let rust_snapshots = rust_log
        .iter()
        .filter(|entry| entry.as_snapshot().is_some())
        .count();
    let java_snapshots = java_log
        .iter()
        .filter(|entry| entry.as_snapshot().is_some())
        .count();
    if rust_snapshots == 0 || java_snapshots == 0 {
        return false;
    }
    let Some(result) = compare_matchup_partial_logs(config, &rust_log, &java_log) else {
        return false;
    };
    if compare_emitted
        .compare_exchange(false, true, Ordering::Relaxed, Ordering::Relaxed)
        .is_err()
    {
        return false;
    }
    if let Some(divergence) = result.first_divergence.as_ref() {
        *lock_pt(stop_after_turn) = Some(divergence.turn);
    }
    let _ = event_tx.send(TraceWorkerEvent::Debug(format!(
        "partial divergence from {source}: rust={} java={} at #{}",
        rust_snapshots, java_snapshots, result.snapshots_compared
    )));
    let _ = event_tx.send(TraceWorkerEvent::CompareUpdate(result));
    true
}

fn run_trace_request(
    event_tx: &Sender<TraceWorkerEvent>,
    loaded_data: &mut Option<LoadedData>,
    java_server: &mut Option<JavaServer>,
    java_server_jar: &mut Option<PathBuf>,
    abort: Arc<AtomicBool>,
    request: TraceRunRequest,
) -> Result<TraceFinished, String> {
    let mut rust = None;
    let mut java = None;
    let mut compare_result = None;
    match request.mode {
        TraceMode::Rust => {
            rust = Some(run_rust_trace(
                event_tx,
                loaded_data,
                &request.config,
                &abort,
            )?);
        }
        TraceMode::Java => {
            java = Some(run_java_trace(
                event_tx,
                java_server,
                java_server_jar,
                &request.java_jar_path,
                &request.config,
                &abort,
                |_| Ok(true),
            )?);
        }
        TraceMode::Compare => {
            let data = ensure_loaded_data(event_tx, loaded_data)?;
            let config = request.config.clone();
            let java_jar_path = request.java_jar_path.clone();
            let abort_for_rust = abort.clone();
            let rust_log = Arc::new(Mutex::new(Vec::<ParityLogEntry>::new()));
            let java_log = Arc::new(Mutex::new(Vec::<ParityLogEntry>::new()));
            let compare_emitted = Arc::new(AtomicBool::new(false));
            let stop_after_turn = Arc::new(Mutex::new(None::<u32>));
            let server =
                ensure_java_server(event_tx, java_server, java_server_jar, &java_jar_path)?;
            let _ = event_tx.send(TraceWorkerEvent::Status(
                "Running side-by-side trace…".to_string(),
            ));
            let rust_log_for_thread = rust_log.clone();
            let java_log_for_rust = java_log.clone();
            let compare_emitted_for_rust = compare_emitted.clone();
            let stop_after_turn_for_rust = stop_after_turn.clone();
            let event_tx_rust_stream = event_tx.clone();
            let config_for_rust_callback = config.clone();
            let abort_for_rust_callback = abort_for_rust.clone();
            let event_tx_java = event_tx.clone();
            let config_for_java = config.clone();
            let abort_for_java = abort.clone();
            let rust_log_for_java = rust_log.clone();
            let java_log_for_java = java_log.clone();
            let compare_emitted_for_java = compare_emitted.clone();
            let stop_after_turn_for_java = stop_after_turn.clone();
            let (rust_trace, java_data) = ParityRuntime::new(data).run_with_server_streaming(
                &config,
                server,
                "debugger-rust-trace",
                move |entry| {
                    if abort_for_rust.load(Ordering::Relaxed) {
                        return;
                    }
                    lock_pt(&rust_log_for_thread).push(entry.clone());
                    if let Some(snapshot) = entry.as_snapshot() {
                        if lock_pt(&stop_after_turn_for_rust)
                            .is_some_and(|limit| snapshot.turn > limit)
                        {
                            abort_for_rust_callback.store(true, Ordering::Relaxed);
                            return;
                        }
                    }
                    if entry.as_snapshot().is_some() {
                        let _ = try_emit_partial_compare(
                            &event_tx_rust_stream,
                            &config_for_rust_callback,
                            &rust_log_for_thread,
                            &java_log_for_rust,
                            &compare_emitted_for_rust,
                            &stop_after_turn_for_rust,
                            "rust",
                        );
                    }
                    if abort_for_rust.load(Ordering::Relaxed) {
                        return;
                    }
                    send_stream_entry(&event_tx_rust_stream, TracePaneKind::Rust, entry);
                },
                |entry| {
                    if abort_for_java.load(Ordering::Relaxed) {
                        return false;
                    }
                    lock_pt(&java_log_for_java).push(entry.clone());
                    if let Some(snapshot) = entry.as_snapshot() {
                        if lock_pt(&stop_after_turn_for_java)
                            .is_some_and(|limit| snapshot.turn > limit)
                        {
                            abort_for_java.store(true, Ordering::Relaxed);
                            return false;
                        }
                    }
                    if entry.as_snapshot().is_some()
                        && try_emit_partial_compare(
                            &event_tx_java,
                            &config_for_java,
                            &rust_log_for_java,
                            &java_log_for_java,
                            &compare_emitted_for_java,
                            &stop_after_turn_for_java,
                            "java",
                        )
                    {
                        send_stream_entry(&event_tx_java, TracePaneKind::Java, entry.clone());
                        return true;
                    }
                    send_stream_entry(&event_tx_java, TracePaneKind::Java, entry.clone());
                    true
                },
            )?;
            compare_result = Some(compare_matchup(&config, &rust_trace, &java_data));
            rust = Some(rust_trace);
            java = Some(java_data);
        }
    }
    Ok(TraceFinished {
        rust,
        java,
        compare_result,
    })
}

fn run_rust_trace(
    event_tx: &Sender<TraceWorkerEvent>,
    loaded_data: &mut Option<LoadedData>,
    config: &RunConfig,
    abort: &Arc<AtomicBool>,
) -> Result<GameTrace, String> {
    let data = ensure_loaded_data(event_tx, loaded_data)?;
    run_rust_trace_with_loaded_data(event_tx, data, config, abort, |_| {})
}

fn run_rust_trace_with_loaded_data<F>(
    event_tx: &Sender<TraceWorkerEvent>,
    data: &LoadedData,
    config: &RunConfig,
    abort: &Arc<AtomicBool>,
    mut on_entry: F,
) -> Result<GameTrace, String>
where
    F: FnMut(&ParityLogEntry) + Send + 'static,
{
    let _ = event_tx.send(TraceWorkerEvent::Status("Running Rust trace…".to_string()));
    let (entry_tx, entry_rx) = mpsc::channel::<ParityLogEntry>();
    let event_tx_forward = event_tx.clone();
    let abort_forward = abort.clone();
    let forwarder = thread::spawn(move || {
        while let Ok(entry) = entry_rx.recv() {
            if abort_forward.load(Ordering::Relaxed) {
                break;
            }
            on_entry(&entry);
            if abort_forward.load(Ordering::Relaxed) {
                break;
            }
            send_stream_entry(&event_tx_forward, TracePaneKind::Rust, entry);
        }
    });
    let result = run_with_data_streaming(config, data, Some(entry_tx));
    let _ = forwarder.join();
    result
}

fn run_java_trace(
    event_tx: &Sender<TraceWorkerEvent>,
    java_server: &mut Option<JavaServer>,
    java_server_jar: &mut Option<PathBuf>,
    jar_path: &Path,
    config: &RunConfig,
    abort: &Arc<AtomicBool>,
    mut on_entry: impl FnMut(&ParityLogEntry) -> Result<bool, String>,
) -> Result<JavaMatchupData, String> {
    let server = ensure_java_server(event_tx, java_server, java_server_jar, jar_path)?;
    let _ = event_tx.send(TraceWorkerEvent::Status("Running Java trace…".to_string()));
    server
        .run_matchup_streaming(
            &config.deck1,
            &config.deck2,
            config.seed,
            config.max_turns,
            config.prefer_actions,
            config.deep,
            &config.variant,
            &config.commanders,
            None,
            |_, entry| {
                if abort.load(Ordering::Relaxed) {
                    return false;
                }
                match on_entry(entry) {
                    Ok(true) => {
                        if abort.load(Ordering::Relaxed) {
                            return false;
                        }
                        send_stream_entry(event_tx, TracePaneKind::Java, entry.clone());
                        true
                    }
                    Ok(false) => false,
                    Err(_) => false,
                }
            },
        )
        .map_err(format_java_error)
}
