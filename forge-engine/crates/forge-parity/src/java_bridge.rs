//! Java subprocess bridge for cross-engine parity testing.
//!
//! Provides two modes:
//! - **`JavaBridge`**: One-shot subprocess per matchup (original, backward-compatible).
//! - **`JavaServer`**: Long-lived server process that reuses the JVM across games.
//!
//! The server mode avoids repeated `FModel.initialize()` calls (~2-3s each),
//! giving 50-100x speedup for batch operations (fuzz, matrix).

use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use serde::{Deserialize, Serialize};

use crate::protocol::{
    CallbackRecord, ChoiceLogEntry, DecisionRecord, ParityLogEntry, StateSnapshot,
};

/// Build the value passed to the Java harness via `-Dpreset.decks.dir=...`.
///
/// The Java harness splits this on `,` and tries each path in order, mirroring
/// the Rust multi-dir search. When `override_dir` is `Some`, only that path is
/// used (preserves explicit `--decks-dir` semantics for tests/debugging). When
/// `None`, falls back to the canonical default list (`parity_decks`,
/// `public/preset_decks`), each canonicalised so the JAR can be invoked from any cwd.
pub fn decks_dir_property(override_dir: Option<&str>) -> String {
    let parts: Vec<String> = match override_dir {
        Some(d) => vec![d.to_string()],
        None => crate::runner::DEFAULT_DECKS_DIRS
            .iter()
            .map(|s| s.to_string())
            .collect(),
    };
    parts
        .into_iter()
        .map(|d| {
            std::path::Path::new(&d)
                .canonicalize()
                .map(|p| p.display().to_string())
                .unwrap_or(d)
        })
        .collect::<Vec<_>>()
        .join(",")
}

/// Configuration for a Java bridge subprocess.
pub struct JavaBridgeConfig {
    pub jar_path: PathBuf,
    pub seed: u64,
    pub max_turns: u32,
    pub deck1: String,
    pub deck2: String,
    pub forge_home: Option<String>,
    pub decks_dir: Option<String>,
    pub verbose: bool,
    pub prefer_actions: bool,
    pub deep: bool,
    pub java_heap: String,
    pub verbose_turns: Option<String>,
}

pub struct JavaBridge {
    pub config: JavaBridgeConfig,
}

pub struct JavaMatchupData {
    pub log: Vec<ParityLogEntry>,
}

impl JavaBridge {
    pub fn new(config: JavaBridgeConfig) -> Self {
        Self { config }
    }

    pub fn run(&self) -> Result<JavaMatchupData, JavaBridgeError> {
        let jar = &self.config.jar_path;
        let verbose = self.config.verbose;

        if !jar.exists() {
            return Err(JavaBridgeError::SpawnError(format!(
                "JAR file not found: {}",
                jar.display()
            )));
        }

        if verbose {
            eprintln!("[parity] Launching Java harness: {}", jar.display());
            eprintln!(
                "[parity]   args: --deck1 {} --deck2 {} --seed {} --max-turns {}",
                self.config.deck1, self.config.deck2, self.config.seed, self.config.max_turns
            );
        }

        let java_bin = resolve_java_bin(verbose);

        let mut cmd = Command::new(&java_bin);

        // Cap JVM heap to prevent unbounded memory consumption on VMs.
        cmd.arg(format!("-Xmx{}", self.config.java_heap));
        cmd.arg(format!("-Xms{}", self.config.java_heap));
        cmd.arg("-Dfile.encoding=UTF-8");
        cmd.arg("-Dsun.stdout.encoding=UTF-8");
        cmd.arg("-Dsun.stderr.encoding=UTF-8");

        // Pass preset decks directory list as JVM system property (must come before -jar).
        // Java side splits on `,` and tries each path in order; mirrors the Rust
        // multi-dir search so both engines find decks in `parity_decks/` and
        // `public/preset_decks/` without requiring a CLI override.
        cmd.arg(format!(
            "-Dpreset.decks.dir={}",
            decks_dir_property(self.config.decks_dir.as_deref())
        ));

        // Forward RNG trace flag to Java engine
        if std::env::var("FORGE_RNG_TRACE").is_ok() {
            cmd.arg("-Dforge.parity.rng.trace=true");
        }
        if let Ok(bounds) = std::env::var("FORGE_RNG_BT_BOUNDS") {
            cmd.arg(format!("-Dforge.parity.rng.bt.bounds={}", bounds));
        }
        if std::env::var("FORGE_RNG_BT_UNBOUNDED").is_ok() {
            cmd.arg("-Dforge.parity.rng.bt.unbounded=true");
        }
        if std::env::var("FORGE_SORT_TRACE").is_ok() {
            cmd.arg("-Dforge.parity.sort.trace=true");
        }
        if std::env::var("FORGE_LIB_DUMP").is_ok() {
            cmd.env("FORGE_LIB_DUMP", "1");
        }
        if std::env::var("FORGE_TOKEN_DEBUG").is_ok() {
            cmd.env("FORGE_TOKEN_DEBUG", "1");
        }

        cmd.arg("-jar")
            .arg(jar)
            .arg("--deck1")
            .arg(&self.config.deck1)
            .arg("--deck2")
            .arg(&self.config.deck2)
            .arg("--seed")
            .arg(self.config.seed.to_string())
            .arg("--max-turns")
            .arg(self.config.max_turns.to_string());
        if self.config.prefer_actions {
            cmd.arg("--prefer-actions");
        }
        if self.config.deep {
            cmd.arg("--deep");
        }
        if let Some(ref vt) = self.config.verbose_turns {
            cmd.arg("--verbose-turns").arg(vt);
        }

        // Add --forge-home if specified, otherwise auto-detect from JAR path
        if let Some(ref home) = self.config.forge_home {
            cmd.arg("--forge-home").arg(home);
        } else if let Some(jar_parent) = jar.parent() {
            // Auto-detect: JAR is at forge-harness/target/, and the engine
            // assets live in the forge/ submodule, so forge-gui/ is at
            // ../../forge/forge-gui/ relative to the JAR.
            let forge_gui = jar_parent
                .join("..")
                .join("..")
                .join("forge")
                .join("forge-gui");
            if forge_gui.join("res").join("cardsfolder").exists() {
                let forge_gui_str = format!("{}/", forge_gui.display());
                if verbose {
                    eprintln!("[parity]   auto-detected forge-home: {}", forge_gui_str);
                }
                cmd.arg("--forge-home").arg(forge_gui_str);
            }
        }

        let mut child = cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| JavaBridgeError::SpawnError(format!("Failed to spawn java: {}", e)))?;

        // Read stderr in a background thread for diagnostics
        let stderr = child.stderr.take();
        let stderr_handle = std::thread::spawn(move || {
            if let Some(stderr) = stderr {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    if verbose
                        || line.contains("Exception")
                        || line.contains("Error")
                        || line.contains("Failed")
                        || line.contains("WARNING")
                        || line.contains("[JAVA-STACK]")
                        || line.contains("[rng-java")
                        || line.contains("[java-target")
                        || line.contains("[det-java")
                        || line.contains("[parity-agent-java")
                        || line.contains("[LIB_DUMP_JAVA")
                        || line.contains("[TOKEN_DBG_JAVA")
                        || line.contains("[rng-java-bt")
                        || line.contains("  at ")
                    {
                        eprintln!("[java] {}", line);
                    }
                }
            }
        });

        // Read stdout line by line, parse each as a StateSnapshot
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| JavaBridgeError::ProtocolError("No stdout from Java process".into()))?;

        let reader = BufReader::new(stdout);
        let mut log = Vec::new();
        let mut snapshot_count = 0usize;

        for line_result in reader.lines() {
            let line = line_result.map_err(|e| {
                JavaBridgeError::ProtocolError(format!("Failed to read stdout: {}", e))
            })?;

            let line = line.trim().to_string();
            if line.is_empty() {
                continue;
            }

            if let Some(decision) = parse_decision_line(&line) {
                log.push(ParityLogEntry::Decision(decision));
                continue;
            }

            if let Some(callback) = parse_callback_line(&line, snapshot_count) {
                log.push(ParityLogEntry::Callback(callback));
                continue;
            }

            match serde_json::from_str::<StateSnapshot>(&line) {
                Ok(snapshot) => {
                    if verbose {
                        eprintln!(
                            "[parity] Java snapshot: turn={} phase={} game_over={}",
                            snapshot.turn, snapshot.phase, snapshot.game_over
                        );
                    }
                    log.push(ParityLogEntry::Snapshot(snapshot));
                    snapshot_count += 1;
                }
                Err(e) => {
                    if verbose {
                        eprintln!(
                            "[parity] Warning: failed to parse Java output as snapshot: {}",
                            e
                        );
                        eprintln!("[parity]   line: {}", line);
                    }
                }
            }
        }

        // Wait for process to finish
        let _ = stderr_handle.join();
        let status = child
            .wait()
            .map_err(|e| JavaBridgeError::SpawnError(format!("Failed to wait for java: {}", e)))?;

        if !status.success() {
            let code = status.code().unwrap_or(-1);
            if verbose {
                eprintln!("[parity] Java process exited with code {}", code);
            }
            return Err(JavaBridgeError::ProcessError(code));
        }

        if verbose {
            eprintln!(
                "[parity] Java harness completed: {} snapshot(s)",
                snapshot_count
            );
        }
        Ok(JavaMatchupData { log })
    }
}

// ---------------------------------------------------------------------------
// JavaServer — long-lived server mode
// ---------------------------------------------------------------------------
pub struct JavaServerConfig {
    pub jar_path: PathBuf,
    pub forge_home: Option<String>,
    pub decks_dir: Option<String>,
    pub verbose: bool,
    pub java_heap: String,
}

/// Request sent to the Java server over stdin (JSONL).
#[derive(Serialize)]
pub struct MatchupRequest {
    pub command: String,
    pub deck1: String,
    pub deck2: String,
    pub seed: u64,
    pub max_turns: u32,
    pub prefer_actions: bool,
    pub deep: bool,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub variant: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub commanders: Vec<String>,
    /// Verbose callback logging for specific turns. Empty string = all, absent = off.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verbose_turns: Option<String>,
}

#[derive(Deserialize)]
struct DoneSentinel {
    done: bool,
    error: Option<String>,
}

/// Long-lived Java server process that accepts matchup requests over stdin/stdout.
///
/// Avoids the ~2-3s JVM + FModel.initialize() cost per game by keeping the
/// process alive and reusing the singleton across games.
pub struct JavaServer {
    child: Child,
    stdin: BufWriter<ChildStdin>,
    stdout: BufReader<ChildStdout>,
    #[allow(dead_code)]
    stderr_handle: Option<std::thread::JoinHandle<()>>,
    verbose: bool,
}

impl JavaServer {
    pub fn spawn(config: &JavaServerConfig) -> Result<Self, JavaBridgeError> {
        let jar = &config.jar_path;
        let verbose = config.verbose;

        if !jar.exists() {
            return Err(JavaBridgeError::SpawnError(format!(
                "JAR file not found: {}",
                jar.display()
            )));
        }

        if verbose {
            eprintln!("[parity] Spawning Java server: {}", jar.display());
        }

        let java_bin = resolve_java_bin(verbose);

        let mut cmd = Command::new(&java_bin);

        // Cap JVM heap to prevent unbounded memory consumption on VMs.
        cmd.arg(format!("-Xmx{}", config.java_heap));
        cmd.arg(format!("-Xms{}", config.java_heap));
        cmd.arg("-Dfile.encoding=UTF-8");
        cmd.arg("-Dsun.stdout.encoding=UTF-8");
        cmd.arg("-Dsun.stderr.encoding=UTF-8");

        // Pass preset decks directory list as JVM system property (must come before -jar).
        // See `decks_dir_property` for multi-dir semantics.
        let dd_prop = decks_dir_property(config.decks_dir.as_deref());
        cmd.arg(format!("-Dpreset.decks.dir={}", dd_prop));
        if verbose {
            eprintln!("[parity]   preset.decks.dir = {}", dd_prop);
        }

        // Forward RNG trace flag to Java engine
        if std::env::var("FORGE_RNG_TRACE").is_ok() {
            cmd.arg("-Dforge.parity.rng.trace=true");
        }
        if let Ok(bounds) = std::env::var("FORGE_RNG_BT_BOUNDS") {
            cmd.arg(format!("-Dforge.parity.rng.bt.bounds={}", bounds));
        }
        if std::env::var("FORGE_RNG_BT_UNBOUNDED").is_ok() {
            cmd.arg("-Dforge.parity.rng.bt.unbounded=true");
        }
        if std::env::var("FORGE_SORT_TRACE").is_ok() {
            cmd.arg("-Dforge.parity.sort.trace=true");
        }
        if std::env::var("FORGE_LIB_DUMP").is_ok() {
            cmd.env("FORGE_LIB_DUMP", "1");
        }
        if std::env::var("FORGE_TOKEN_DEBUG").is_ok() {
            cmd.env("FORGE_TOKEN_DEBUG", "1");
        }

        cmd.arg("-jar").arg(jar).arg("--server");

        // Add --forge-home if specified, otherwise auto-detect from JAR path
        if let Some(ref home) = config.forge_home {
            cmd.arg("--forge-home").arg(home);
        } else if let Some(jar_parent) = jar.parent() {
            // forge-gui/ lives in the forge/ submodule: ../../forge/forge-gui/
            let forge_gui = jar_parent
                .join("..")
                .join("..")
                .join("forge")
                .join("forge-gui");
            if forge_gui.join("res").join("cardsfolder").exists() {
                let forge_gui_str = format!("{}/", forge_gui.display());
                if verbose {
                    eprintln!("[parity]   auto-detected forge-home: {}", forge_gui_str);
                }
                cmd.arg("--forge-home").arg(forge_gui_str);
            }
        }

        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| JavaBridgeError::SpawnError(format!("Failed to spawn java: {}", e)))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| JavaBridgeError::SpawnError("No stdin for Java server".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| JavaBridgeError::SpawnError("No stdout for Java server".into()))?;

        // Read stderr in a background thread for diagnostics
        let stderr = child.stderr.take();
        let stderr_handle = std::thread::spawn(move || {
            if let Some(stderr) = stderr {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    if verbose
                        || line.contains("Exception")
                        || line.contains("Error")
                        || line.contains("Failed")
                        || line.contains("WARNING")
                        || line.contains("[JAVA-STACK]")
                        || line.contains("[rng-java")
                        || line.contains("[java-target")
                        || line.contains("[det-java")
                        || line.contains("[parity-agent-java")
                        || line.contains("[LIB_DUMP_JAVA")
                        || line.contains("[TOKEN_DBG_JAVA")
                        || line.contains("[rng-java-bt")
                        || line.contains("  at ")
                    {
                        eprintln!("[java] {}", line);
                    }
                }
            }
        });

        if verbose {
            eprintln!("[parity] Java server spawned (pid={})", child.id());
        }

        Ok(Self {
            child,
            stdin: BufWriter::new(stdin),
            stdout: BufReader::new(stdout),
            stderr_handle: Some(stderr_handle),
            verbose,
        })
    }

    /// Send a matchup request and read snapshots until the done sentinel.
    pub fn run_matchup(
        &mut self,
        deck1: &str,
        deck2: &str,
        seed: u64,
        max_turns: u32,
        prefer_actions: bool,
        deep: bool,
        variant: &str,
        commanders: &[String],
        verbose_turns: Option<String>,
    ) -> Result<JavaMatchupData, JavaBridgeError> {
        let request = MatchupRequest {
            command: "run".to_string(),
            deck1: deck1.to_string(),
            deck2: deck2.to_string(),
            seed,
            max_turns,
            prefer_actions,
            deep,
            variant: variant.to_string(),
            commanders: commanders.to_vec(),
            verbose_turns,
        };

        // Write request as a single JSON line
        let request_json = serde_json::to_string(&request).map_err(|e| {
            JavaBridgeError::ProtocolError(format!("Failed to serialize request: {}", e))
        })?;

        self.stdin.write_all(request_json.as_bytes()).map_err(|e| {
            JavaBridgeError::ProtocolError(format!("Failed to write to stdin: {}", e))
        })?;
        self.stdin.write_all(b"\n").map_err(|e| {
            JavaBridgeError::ProtocolError(format!("Failed to write newline: {}", e))
        })?;
        self.stdin
            .flush()
            .map_err(|e| JavaBridgeError::ProtocolError(format!("Failed to flush stdin: {}", e)))?;

        let mut log = Vec::new();
        let mut snapshot_count = 0usize;
        let mut line_buf = String::new();

        loop {
            line_buf.clear();
            let bytes_read = self.stdout.read_line(&mut line_buf).map_err(|e| {
                JavaBridgeError::ProtocolError(format!("Failed to read stdout: {}", e))
            })?;

            if bytes_read == 0 {
                return Err(JavaBridgeError::ProtocolError(
                    "Java server closed stdout (crashed?)".into(),
                ));
            }

            let line = line_buf.trim();
            if line.is_empty() {
                continue;
            }

            if let Ok(sentinel) = serde_json::from_str::<DoneSentinel>(line) {
                if sentinel.done {
                    if let Some(err) = sentinel.error {
                        return Err(JavaBridgeError::ProtocolError(format!(
                            "Java game error: {}",
                            err
                        )));
                    }
                    break;
                }
            }

            if let Some(decision) = parse_decision_line(line) {
                log.push(ParityLogEntry::Decision(decision));
                continue;
            }

            if let Some(callback) = parse_callback_line(line, snapshot_count) {
                log.push(ParityLogEntry::Callback(callback));
                continue;
            }

            match serde_json::from_str::<StateSnapshot>(line) {
                Ok(snapshot) => {
                    if self.verbose {
                        eprintln!(
                            "[parity] Java snapshot: turn={} phase={} game_over={}",
                            snapshot.turn, snapshot.phase, snapshot.game_over
                        );
                    }
                    log.push(ParityLogEntry::Snapshot(snapshot));
                    snapshot_count += 1;
                }
                Err(e) => {
                    if self.verbose {
                        eprintln!(
                            "[parity] Warning: failed to parse Java output: {} (line: {})",
                            e, line
                        );
                    }
                }
            }
        }

        if self.verbose {
            eprintln!(
                "[parity] Java server matchup completed: {} snapshot(s)",
                snapshot_count
            );
        }
        Ok(JavaMatchupData { log })
    }

    /// Run a matchup with streaming log comparison.
    ///
    /// Like `run_matchup`, but calls `on_entry(index, &entry)` for each
    /// Java parity log entry as it arrives. `index` is the current snapshot
    /// count at the time of delivery. If the callback returns `false`,
    /// remaining entries are skipped (not parsed/stored) but output is drained to the
    /// done sentinel to keep the protocol in sync.
    ///
    /// This enables early divergence detection without waiting for the full
    /// Java game to be parsed, saving JSON deserialization time on long games.
    pub fn run_matchup_streaming<F>(
        &mut self,
        deck1: &str,
        deck2: &str,
        seed: u64,
        max_turns: u32,
        prefer_actions: bool,
        deep: bool,
        variant: &str,
        commanders: &[String],
        verbose_turns: Option<String>,
        mut on_entry: F,
    ) -> Result<JavaMatchupData, JavaBridgeError>
    where
        F: FnMut(usize, &ParityLogEntry) -> bool,
    {
        let request = MatchupRequest {
            command: "run".to_string(),
            deck1: deck1.to_string(),
            deck2: deck2.to_string(),
            seed,
            max_turns,
            prefer_actions,
            deep,
            variant: variant.to_string(),
            commanders: commanders.to_vec(),
            verbose_turns,
        };

        let request_json = serde_json::to_string(&request).map_err(|e| {
            JavaBridgeError::ProtocolError(format!("Failed to serialize request: {}", e))
        })?;

        self.stdin.write_all(request_json.as_bytes()).map_err(|e| {
            JavaBridgeError::ProtocolError(format!("Failed to write to stdin: {}", e))
        })?;
        self.stdin.write_all(b"\n").map_err(|e| {
            JavaBridgeError::ProtocolError(format!("Failed to write newline: {}", e))
        })?;
        self.stdin
            .flush()
            .map_err(|e| JavaBridgeError::ProtocolError(format!("Failed to flush stdin: {}", e)))?;

        let mut log = Vec::new();
        let mut snapshot_count = 0usize;
        let mut line_buf = String::new();
        let mut draining = false;

        loop {
            line_buf.clear();
            let bytes_read = self.stdout.read_line(&mut line_buf).map_err(|e| {
                JavaBridgeError::ProtocolError(format!("Failed to read stdout: {}", e))
            })?;

            if bytes_read == 0 {
                return Err(JavaBridgeError::ProtocolError(
                    "Java server closed stdout (crashed?)".into(),
                ));
            }

            let line = line_buf.trim();
            if line.is_empty() {
                continue;
            }

            if let Ok(sentinel) = serde_json::from_str::<DoneSentinel>(line) {
                if sentinel.done {
                    if let Some(err) = sentinel.error {
                        return Err(JavaBridgeError::ProtocolError(format!(
                            "Java game error: {}",
                            err
                        )));
                    }
                    break;
                }
            }

            if draining {
                continue;
            }

            if let Some(decision) = parse_decision_line(line) {
                let entry = ParityLogEntry::Decision(decision);
                let keep_going = on_entry(snapshot_count, &entry);
                log.push(entry);
                if !keep_going {
                    draining = true;
                }
                continue;
            }

            if let Some(callback) = parse_callback_line(line, snapshot_count) {
                let entry = ParityLogEntry::Callback(callback);
                let keep_going = on_entry(snapshot_count, &entry);
                log.push(entry);
                if !keep_going {
                    draining = true;
                }
                continue;
            }

            match serde_json::from_str::<StateSnapshot>(line) {
                Ok(snapshot) => {
                    if self.verbose {
                        eprintln!(
                            "[parity] Java snapshot: turn={} phase={} game_over={}",
                            snapshot.turn, snapshot.phase, snapshot.game_over
                        );
                    }
                    let entry = ParityLogEntry::Snapshot(snapshot);
                    let keep_going = on_entry(snapshot_count, &entry);
                    log.push(entry);
                    snapshot_count += 1;
                    if !keep_going {
                        draining = true;
                    }
                }
                Err(e) => {
                    if self.verbose {
                        eprintln!(
                            "[parity] Warning: failed to parse Java output: {} (line: {})",
                            e, line
                        );
                    }
                }
            }
        }

        if self.verbose {
            eprintln!(
                "[parity] Java server matchup completed: {} snapshot(s){}",
                snapshot_count,
                if draining { " (early divergence)" } else { "" }
            );
        }
        Ok(JavaMatchupData { log })
    }

    /// Check if the server process is still alive.
    pub fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    /// Send quit command and wait for the server to exit (with timeout).
    pub fn shutdown(mut self) {
        if self.verbose {
            eprintln!("[parity] Shutting down Java server...");
        }
        let quit = "{\"command\":\"quit\"}\n";
        let _ = self.stdin.write_all(quit.as_bytes());
        let _ = self.stdin.flush();

        // Wait with a 5-second timeout — kill if the process hangs
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            match self.child.try_wait() {
                Ok(Some(status)) => {
                    if self.verbose {
                        eprintln!("[parity] Java server exited: {}", status);
                    }
                    return;
                }
                Ok(None) => {
                    if std::time::Instant::now() >= deadline {
                        eprintln!("[parity] Java server did not exit in time, killing...");
                        let _ = self.child.kill();
                        let _ = self.child.wait();
                        return;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                Err(e) => {
                    if self.verbose {
                        eprintln!("[parity] Error waiting for Java server: {}", e);
                    }
                    return;
                }
            }
        }
    }
}

#[derive(Deserialize)]
struct DecisionEnvelope {
    event: String,
    turn: u32,
    phase: String,
    deciding_player: u32,
    kind: String,
    #[serde(default)]
    options: Vec<String>,
    choice: String,
    #[serde(default)]
    timestamp_ms: u64,
}

#[derive(Deserialize)]
struct CallbackEnvelope {
    event: String,
    turn: u32,
    phase: String,
    player: u32,
    name: String,
    outcome: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    callback_args: Vec<String>,
    #[serde(default)]
    timestamp_ms: u64,
}

fn parse_decision_line(line: &str) -> Option<DecisionRecord> {
    let env = serde_json::from_str::<DecisionEnvelope>(line).ok()?;
    if env.event != "decision" {
        return None;
    }
    Some(DecisionRecord {
        turn: env.turn,
        phase: env.phase,
        deciding_player: env.deciding_player,
        kind: env.kind,
        options: env
            .options
            .into_iter()
            .map(ChoiceLogEntry::from_json)
            .collect(),
        choice: env.choice,
        timestamp_ms: env.timestamp_ms,
    })
}

fn parse_callback_line(line: &str, snapshot_index: usize) -> Option<CallbackRecord> {
    let env = serde_json::from_str::<CallbackEnvelope>(line).ok()?;
    if env.event != "callback" {
        return None;
    }
    Some(CallbackRecord {
        snapshot_index,
        turn: env.turn,
        phase: env.phase,
        player: env.player,
        name: env.name,
        outcome: env.outcome,
        args: env
            .args
            .into_iter()
            .map(ChoiceLogEntry::from_json)
            .collect(),
        callback_args: env.callback_args,
        timestamp_ms: env.timestamp_ms,
    })
}

/// Extract the major Java version from a JDK home directory name.
/// Handles names like "zulu-18.jdk", "temurin-21.jdk", "zulu-8.jdk".
fn extract_jdk_version(name: &str) -> Option<u32> {
    name.split('-')
        .flat_map(|s| s.split('.'))
        .find_map(|s| s.parse().ok())
}

/// Resolve the `java` binary path. Forge requires Java 17+.
/// If JAVA_HOME points to a JDK ≥17 use it; otherwise auto-detect the
/// highest-version JDK under /Library/Java/JavaVirtualMachines.
fn resolve_java_bin(verbose: bool) -> String {
    // Check JAVA_HOME first — only use it if ≥17 (Forge's minimum).
    if let Ok(home) = std::env::var("JAVA_HOME") {
        let home_path = PathBuf::from(&home);
        let bin = home_path.join("bin").join("java");
        // Try to infer version from the JDK directory name (e.g. "zulu-18.jdk").
        // JAVA_HOME is usually .../zulu-18.jdk/Contents/Home, so look for the
        // ancestor whose name ends with ".jdk".
        let dir_name = home_path
            .ancestors()
            .filter_map(|p| p.file_name())
            .find(|n| n.to_string_lossy().ends_with(".jdk"))
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let version = extract_jdk_version(&dir_name).unwrap_or(17); // assume OK if can't parse
        if version >= 17 && bin.exists() {
            if verbose {
                eprintln!("[parity]   using JAVA_HOME (Java {}): {}", version, home);
            }
            return bin.to_string_lossy().to_string();
        }
        if verbose {
            eprintln!(
                "[parity]   JAVA_HOME points to Java {} (<17), searching for newer JDK...",
                version
            );
        }
    }

    // Auto-detect: pick the highest-versioned JDK (≥17) on macOS.
    let jvms_dir = PathBuf::from("/Library/Java/JavaVirtualMachines");
    if jvms_dir.is_dir() {
        let mut best: Option<(u32, PathBuf)> = None;
        if let Ok(entries) = std::fs::read_dir(&jvms_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if let Some(v) = extract_jdk_version(&name) {
                    if v >= 17 {
                        let home = entry.path().join("Contents").join("Home");
                        if home.join("bin").join("java").exists()
                            && best.as_ref().is_none_or(|(bv, _)| v > *bv)
                        {
                            best = Some((v, home));
                        }
                    }
                }
            }
        }
        if let Some((v, home)) = best {
            if verbose {
                eprintln!("[parity]   auto-detected Java {}: {}", v, home.display());
            }
            return home.join("bin").join("java").to_string_lossy().to_string();
        }
    }

    "java".to_string()
}

impl JavaMatchupData {
    pub fn snapshots(&self) -> impl Iterator<Item = &StateSnapshot> {
        self.log.iter().filter_map(|e| e.as_snapshot())
    }
    pub fn snapshot_vec(&self) -> Vec<StateSnapshot> {
        self.snapshots().cloned().collect()
    }
    pub fn callbacks(&self) -> impl Iterator<Item = &CallbackRecord> {
        self.log.iter().filter_map(|e| e.as_callback())
    }
    pub fn callback_vec(&self) -> Vec<CallbackRecord> {
        self.callbacks().cloned().collect()
    }
}

/// Errors from the Java bridge.
#[derive(Debug)]
pub enum JavaBridgeError {
    /// Failed to start the Java subprocess.
    SpawnError(String),
    /// Communication error (timeout, malformed JSON, etc.).
    ProtocolError(String),
    /// Java process exited with non-zero status.
    ProcessError(i32),
}

impl std::fmt::Display for JavaBridgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            JavaBridgeError::SpawnError(msg) => write!(f, "Failed to spawn Java: {}", msg),
            JavaBridgeError::ProtocolError(msg) => write!(f, "Protocol error: {}", msg),
            JavaBridgeError::ProcessError(code) => {
                write!(f, "Java process exited with code {}", code)
            }
        }
    }
}

impl std::error::Error for JavaBridgeError {}
