#![allow(dead_code)]

#[cfg(feature = "java-forge")]
use std::collections::HashMap;
use std::env;
#[cfg(feature = "java-forge")]
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
#[cfg(feature = "java-forge")]
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::AtomicBool;
use std::sync::mpsc as std_mpsc;
#[cfg(feature = "java-forge")]
use std::sync::mpsc::{RecvTimeoutError, TryRecvError};
use std::sync::Arc;
#[cfg(feature = "java-forge")]
use std::sync::Mutex;
#[cfg(feature = "java-forge")]
use std::time::{Duration, Instant};

use forge_agent_interface::deck_dto::{CardIdentity, Deck};

use crate::config::DeckSelection;
#[cfg(feature = "java-forge")]
use forge_agent_interface::java_prompt_normalizer::{
    make_java_game_over_prompt, normalize_java_prompt, translate_java_player_action,
};
#[cfg(feature = "java-forge")]
use forge_agent_interface::java_raw::{
    JavaAction, JavaRawPrompt, JavaRawPromptBody, JavaRawSnapshot,
};
use forge_agent_interface::prompt::{AgentPrompt, PlayerAction};
#[cfg(feature = "java-forge")]
use forge_bot::{BotAgent, SimpleAi};
use serde::Serialize;
#[cfg(feature = "java-forge")]
use serde_json::json;
#[cfg(feature = "java-forge")]
use serde_json::Value;
use tracing::warn;
#[cfg(feature = "java-forge")]
use tracing::{debug, info};

use crate::config::workspace_root;

pub fn unsupported_message() -> &'static str {
    "hosted java-forge backend is unavailable; rebuild self-hosted-node with --features java-forge"
}

#[cfg(feature = "java-forge")]
pub fn run_smoke_game(max_prompts: usize) -> Result<(), String> {
    let config = JavaRuntimeConfig::from_env();
    let assets_dir = config.assets_dir.to_string_lossy().to_string();
    let bridge = SubprocessBridge::spawn(&config)?;
    let mut session = JavaForgeSession::new(bridge);
    session.initialize(&assets_dir)?;

    let deck_a = smoke_deck("Mountain", "Lightning Bolt");
    let deck_b = smoke_deck("Forest", "Grizzly Bears");
    let request = StartGameRequest::new(
        "self-hosted-java-smoke".to_string(),
        20,
        42,
        vec![
            PlayerConfig::new("Smoke A".to_string(), &deck_a, None),
            PlayerConfig::new("Smoke B".to_string(), &deck_b, None),
        ],
    );
    let session_id = session.start_game(&request)?;
    info!(session_id, "java-forge smoke session started");

    let mut prompts_seen = 0usize;
    while prompts_seen < max_prompts {
        let Some(prompt_json) = wait_for_prompt(&mut session, 600)? else {
            session.end_game()?;
            return Err("timed out waiting for java-forge smoke prompt".to_string());
        };
        let prompt: Value = serde_json::from_str(&prompt_json)
            .map_err(|err| format!("failed to parse java-forge smoke prompt: {err}"))?;
        let player = prompt
            .get("player")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        let action_count = prompt
            .get("actions")
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or_default();
        info!(
            prompts_seen,
            player, action_count, "java-forge smoke prompt"
        );
        session.submit_action(&json!({ "kind": "pass" }).to_string())?;
        prompts_seen += 1;
    }

    let snapshot_json = session.get_snapshot()?;
    let snapshot: Value = serde_json::from_str(&snapshot_json)
        .map_err(|err| format!("failed to parse java-forge smoke snapshot: {err}"))?;
    info!(
        turn = snapshot
            .get("turn")
            .and_then(|value| value.as_i64())
            .unwrap_or_default(),
        phase = snapshot
            .get("phase")
            .and_then(|value| value.as_str())
            .unwrap_or("<missing>"),
        "java-forge smoke snapshot"
    );
    session.end_game()?;
    Ok(())
}

#[cfg(not(feature = "java-forge"))]
pub fn run_smoke_game(_max_prompts: usize) -> Result<(), String> {
    Err(
        "java-forge smoke requires building self-hosted-node with --features java-forge"
            .to_string(),
    )
}

#[cfg(feature = "java-forge")]
pub fn run_scenario(name: &str, max_prompts: usize) -> Result<(), String> {
    let scenario = JavaScenario::from_name(name)?;
    let config = JavaRuntimeConfig::from_env();
    let assets_dir = config.assets_dir.to_string_lossy().to_string();
    let bridge = SubprocessBridge::spawn(&config)?;
    let mut session = JavaForgeSession::new(bridge);
    session.initialize(&assets_dir)?;

    let request = StartGameRequest::new(
        format!("self-hosted-java-scenario-{}", scenario.name()),
        20,
        42,
        vec![
            PlayerConfig::new("Scenario A".to_string(), &scenario_deck("Swamp"), None),
            PlayerConfig::new("Scenario B".to_string(), &scenario_deck("Forest"), None),
        ],
    );
    let session_id = session.start_game(&request)?;
    info!(
        session_id,
        scenario = scenario.name(),
        "java-forge scenario started"
    );

    let result = run_scenario_loop(&mut session, scenario, max_prompts);
    let end_result = session.end_game();
    result.and(end_result)
}

#[cfg(not(feature = "java-forge"))]
pub fn run_scenario(_name: &str, _max_prompts: usize) -> Result<(), String> {
    Err(
        "java-forge scenarios require building self-hosted-node with --features java-forge"
            .to_string(),
    )
}

#[cfg(feature = "java-forge")]
pub fn run_self_play(
    seats: &[DeckSelection],
    starting_life: i32,
    seed: u64,
    max_prompts: usize,
    games: usize,
) -> Result<(), String> {
    let config = JavaRuntimeConfig::from_env();
    let assets_dir = config.assets_dir.to_string_lossy().to_string();
    let bridge = SubprocessBridge::spawn(&config)?;
    let mut session = JavaForgeSession::new(bridge);
    session.initialize(&assets_dir)?;

    let mut players = Vec::with_capacity(seats.len());
    for (i, seat) in seats.iter().enumerate() {
        let identities = deck_card_identities(&seat.deck);
        players.push(PlayerConfig::new(
            format!("Self-Play {}", i + 1),
            &identities,
            seat.commander_name.clone(),
        ));
    }

    for game_index in 0..games.max(1) {
        let request = StartGameRequest::new(
            format!("self-hosted-java-self-play-{game_index}"),
            starting_life,
            seed.wrapping_add(game_index as u64),
            players.clone(),
        );
        let session_id = session.start_game(&request)?;
        info!(
            session_id,
            game_index,
            games,
            players = seats.len(),
            starting_life,
            max_prompts,
            "java-forge self-play game started"
        );
        let result = run_self_play_loop(&mut session, max_prompts);
        let end_result = session.end_game();
        result.and(end_result)?;
    }
    Ok(())
}

#[cfg(not(feature = "java-forge"))]
pub fn run_self_play(
    _seats: &[DeckSelection],
    _starting_life: i32,
    _seed: u64,
    _max_prompts: usize,
    _games: usize,
) -> Result<(), String> {
    Err(
        "java-forge self-play requires building self-hosted-node with --features java-forge"
            .to_string(),
    )
}

#[cfg(feature = "java-forge")]
type SharedBridge = Arc<Mutex<SubprocessBridge>>;

#[cfg(feature = "java-forge")]
pub struct JavaEnginePool {
    config: JavaRuntimeConfig,
    max_size: usize,
    free: Mutex<Vec<SharedBridge>>,
    in_use: Mutex<HashMap<String, SharedBridge>>,
}

#[cfg(feature = "java-forge")]
#[derive(Clone)]
pub struct JavaEngineHandle {
    pool: Arc<JavaEnginePool>,
}

#[cfg(feature = "java-forge")]
impl JavaEnginePool {
    pub fn start(config: &JavaRuntimeConfig, max_size: usize) -> Result<Arc<Self>, String> {
        let max_size = max_size.max(1);
        let mut free = Vec::with_capacity(max_size);
        for slot in 0..max_size {
            info!(slot, max_size, "pre-warming java subprocess");
            let bridge = SubprocessBridge::spawn(config)?;
            free.push(Arc::new(Mutex::new(bridge)));
        }
        Ok(Arc::new(Self {
            config: config.clone(),
            max_size,
            free: Mutex::new(free),
            in_use: Mutex::new(HashMap::new()),
        }))
    }

    pub fn handle(self: &Arc<Self>) -> JavaEngineHandle {
        JavaEngineHandle {
            pool: Arc::clone(self),
        }
    }
}

#[cfg(feature = "java-forge")]
impl Drop for JavaEnginePool {
    fn drop(&mut self) {
        let free = self.free.get_mut().map(std::mem::take).unwrap_or_default();
        for bridge in free {
            if let Ok(mutex) = Arc::try_unwrap(bridge) {
                if let Ok(inner) = mutex.into_inner() {
                    inner.shutdown();
                }
            }
        }
    }
}

#[cfg(feature = "java-forge")]
impl JavaEnginePool {
    fn acquire(&self) -> Result<SharedBridge, String> {
        let deadline = Instant::now() + Duration::from_secs(60);
        loop {
            let popped = {
                let mut free = self
                    .free
                    .lock()
                    .map_err(|_| "java engine free queue poisoned".to_string())?;
                free.pop()
            };
            if let Some(bridge) = popped {
                let alive = bridge
                    .lock()
                    .ok()
                    .map(|mut guard| guard.is_alive())
                    .unwrap_or(false);
                if alive {
                    return Ok(bridge);
                }
                warn!("discarding dead java subprocess from pool");
                drop(bridge);
                if let Ok(replacement) = SubprocessBridge::spawn(&self.config) {
                    if let Ok(mut free) = self.free.lock() {
                        free.push(Arc::new(Mutex::new(replacement)));
                    }
                }
                continue;
            }
            if Instant::now() >= deadline {
                return Err(format!(
                    "java engine pool exhausted (max_size={}); no free subprocess after 60s",
                    self.max_size
                ));
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    fn release(&self, bridge: SharedBridge) {
        let healthy = {
            let mut guard = match bridge.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            guard.is_alive() && guard.reset().is_ok()
        };
        if healthy {
            if let Ok(mut free) = self.free.lock() {
                free.push(bridge);
                return;
            }
        }
        drop(bridge);
        match SubprocessBridge::spawn(&self.config) {
            Ok(replacement) => {
                if let Ok(mut free) = self.free.lock() {
                    free.push(Arc::new(Mutex::new(replacement)));
                }
            }
            Err(error) => {
                warn!(%error, "failed to respawn java subprocess after release");
            }
        }
    }
}

#[cfg(feature = "java-forge")]
impl JavaEngineHandle {
    fn bridge_for(&self, session_id: &str) -> Result<SharedBridge, String> {
        let in_use = self
            .pool
            .in_use
            .lock()
            .map_err(|_| "java engine in_use map poisoned".to_string())?;
        in_use
            .get(session_id)
            .cloned()
            .ok_or_else(|| format!("unknown java session: {session_id}"))
    }

    pub fn start_game(&self, request_json: &str) -> Result<String, String> {
        let bridge = self.pool.acquire()?;
        let response = {
            let mut guard = bridge
                .lock()
                .map_err(|_| "java subprocess mutex poisoned".to_string())?;
            guard.start_game_json(request_json)
        };
        let response = match response {
            Ok(response) => response,
            Err(error) => {
                self.pool.release(bridge);
                return Err(error);
            }
        };
        let parsed: StartGameResponse = match serde_json::from_str(&response) {
            Ok(parsed) => parsed,
            Err(error) => {
                self.pool.release(bridge);
                return Err(format!("malformed startGame response: {error}"));
            }
        };
        let session_id = parsed.session_id.clone();
        let displaced = {
            let mut in_use = self
                .pool
                .in_use
                .lock()
                .map_err(|_| "java engine in_use map poisoned".to_string())?;
            in_use.insert(session_id.clone(), bridge)
        };
        if let Some(displaced) = displaced {
            warn!(
                session_id,
                "session_id collision; releasing displaced java subprocess"
            );
            self.pool.release(displaced);
        }
        Ok(session_id)
    }

    pub fn submit_action(&self, session_id: &str, action_json: &str) -> Result<String, String> {
        let bridge = self.bridge_for(session_id)?;
        let mut guard = bridge
            .lock()
            .map_err(|_| "java subprocess mutex poisoned".to_string())?;
        guard.submit_action(session_id, action_json)
    }

    pub fn get_prompt(
        &self,
        session_id: &str,
        player_index: usize,
    ) -> Result<Option<String>, String> {
        let bridge = self.bridge_for(session_id)?;
        let mut guard = bridge
            .lock()
            .map_err(|_| "java subprocess mutex poisoned".to_string())?;
        guard.get_prompt(session_id, player_index)
    }

    pub fn is_game_over(&self, session_id: &str) -> Result<bool, String> {
        let bridge = self.bridge_for(session_id)?;
        let mut guard = bridge
            .lock()
            .map_err(|_| "java subprocess mutex poisoned".to_string())?;
        guard.is_game_over(session_id)
    }

    pub fn get_snapshot(&self, session_id: &str) -> Result<String, String> {
        let bridge = self.bridge_for(session_id)?;
        let mut guard = bridge
            .lock()
            .map_err(|_| "java subprocess mutex poisoned".to_string())?;
        guard.get_snapshot(session_id)
    }

    pub fn end_game(&self, session_id: &str) -> Result<(), String> {
        let bridge = {
            let mut in_use = self
                .pool
                .in_use
                .lock()
                .map_err(|_| "java engine in_use map poisoned".to_string())?;
            in_use.remove(session_id)
        };
        let Some(bridge) = bridge else {
            return Ok(());
        };
        let result = {
            let mut guard = bridge
                .lock()
                .map_err(|_| "java subprocess mutex poisoned".to_string())?;
            guard.end_game(session_id)
        };
        self.pool.release(bridge);
        result
    }

    pub fn abort_game(&self, session_id: &str) -> Result<(), String> {
        let bridge = {
            let mut in_use = self
                .pool
                .in_use
                .lock()
                .map_err(|_| "java engine in_use map poisoned".to_string())?;
            in_use.remove(session_id)
        };
        let Some(bridge) = bridge else {
            return Ok(());
        };
        let result = {
            let mut guard = bridge
                .lock()
                .map_err(|_| "java subprocess mutex poisoned".to_string())?;
            guard.abort_game(session_id)
        };
        self.pool.release(bridge);
        result
    }
}

#[cfg(feature = "java-forge")]
static JAVA_ENGINE: std::sync::OnceLock<Arc<JavaEnginePool>> = std::sync::OnceLock::new();

#[cfg(feature = "java-forge")]
pub fn init_engine() -> Result<(), String> {
    if JAVA_ENGINE.get().is_some() {
        return Ok(());
    }
    let config = JavaRuntimeConfig::from_env();
    // SELF_HOSTED_NODE_MAX_GAMES doubles as the subprocess pool size: each room
    // checks out one java subprocess for its lifetime, so the pool ceiling is
    // also the concurrent-room ceiling for this node.
    let max_size = env::var("SELF_HOSTED_NODE_MAX_GAMES")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|n| *n >= 1)
        .unwrap_or(1);
    let pool = JavaEnginePool::start(&config, max_size)?;
    JAVA_ENGINE
        .set(pool)
        .map_err(|_| "java engine already initialized".to_string())
}

#[cfg(not(feature = "java-forge"))]
pub fn init_engine() -> Result<(), String> {
    Err("java engine requires building self-hosted-node with --features java-forge".to_string())
}

#[cfg(feature = "java-forge")]
fn engine_handle() -> Result<JavaEngineHandle, String> {
    JAVA_ENGINE
        .get()
        .map(JavaEnginePool::handle)
        .ok_or_else(|| "java engine is not initialized".to_string())
}

#[cfg(feature = "java-forge")]
pub fn run_concurrent_self_play(
    seats: &[DeckSelection],
    starting_life: i32,
    seed: u64,
    max_prompts: usize,
    concurrency: usize,
) -> Result<(), String> {
    let config = JavaRuntimeConfig::from_env();
    let pool = JavaEnginePool::start(&config, concurrency.max(1))?;
    info!(
        concurrency,
        "java-engine started; launching concurrent games"
    );

    let mut players = Vec::with_capacity(seats.len());
    for (i, seat) in seats.iter().enumerate() {
        let identities = deck_card_identities(&seat.deck);
        players.push(PlayerConfig::new(
            format!("Self-Play {}", i + 1),
            &identities,
            seat.commander_name.clone(),
        ));
    }

    let mut joins = Vec::with_capacity(concurrency.max(1));
    for game_index in 0..concurrency.max(1) {
        let handle = pool.handle();
        let request = StartGameRequest::new(
            format!("self-hosted-java-concurrent-{game_index}"),
            starting_life,
            seed.wrapping_add(game_index as u64),
            players.clone(),
        );
        joins.push(std::thread::spawn(move || -> Result<(), String> {
            let request_json = request.to_json().map_err(|error| error.to_string())?;
            let session_id = handle.start_game(&request_json)?;
            info!(session_id, game_index, "concurrent java game started");
            let result = drive_game_via_handle(&handle, &session_id, max_prompts);
            let _ = handle.end_game(&session_id);
            result
        }));
    }

    let mut outcome = Ok(());
    for join in joins {
        match join.join() {
            Ok(Ok(())) => {}
            Ok(Err(error)) => outcome = Err(error),
            Err(_) => outcome = Err("concurrent game thread panicked".to_string()),
        }
    }
    outcome
}

#[cfg(not(feature = "java-forge"))]
pub fn run_concurrent_self_play(
    _seats: &[DeckSelection],
    _starting_life: i32,
    _seed: u64,
    _max_prompts: usize,
    _concurrency: usize,
) -> Result<(), String> {
    Err(
        "java-forge concurrent self-play requires building self-hosted-node with --features java-forge"
            .to_string(),
    )
}

#[cfg(feature = "java-forge")]
fn drive_game_via_handle(
    handle: &JavaEngineHandle,
    session_id: &str,
    max_prompts: usize,
) -> Result<(), String> {
    let mut bots: HashMap<usize, SimpleAi> = HashMap::new();
    let mut last_prompt: Option<String> = None;
    let mut acted = 0usize;
    let mut seen_prompt = false;
    let max_iterations = max_prompts.saturating_mul(200).max(2_000);

    for _ in 0..max_iterations {
        if let Some(prompt_json) = handle.get_prompt(session_id, 0)? {
            seen_prompt = true;
            if last_prompt.as_deref() == Some(prompt_json.as_str()) {
                if handle.is_game_over(session_id)? {
                    return Ok(());
                }
                std::thread::sleep(Duration::from_millis(20));
                continue;
            }
            let raw: JavaRawPrompt = serde_json::from_str(&prompt_json)
                .map_err(|error| format!("failed to parse concurrent prompt: {error}"))?;
            let player = raw.player;
            let agent_prompt = normalize_java_prompt(raw);
            if let Some(action) = bots.entry(player).or_default().decide(agent_prompt) {
                let java_action =
                    translate_java_player_action(&action).map_err(|err| err.to_string())?;
                let action_json =
                    serde_json::to_string(&java_action).map_err(|err| err.to_string())?;
                handle.submit_action(session_id, &action_json)?;
                acted += 1;
                if acted >= max_prompts {
                    return Err(format!(
                        "concurrent game {session_id} did not finish within {max_prompts} decisions"
                    ));
                }
            }
            last_prompt = Some(prompt_json);
            continue;
        }
        if seen_prompt && handle.is_game_over(session_id)? {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    Err(format!(
        "concurrent game {session_id} exceeded its iteration cap"
    ))
}

#[derive(Debug, Clone)]
pub struct JavaRuntimeConfig {
    pub assets_dir: PathBuf,
    pub harness_jar: PathBuf,
    pub java_home: Option<PathBuf>,
    pub extra_classpath: Vec<PathBuf>,
}

impl JavaRuntimeConfig {
    pub fn from_env() -> Self {
        let root = workspace_root();
        Self {
            assets_dir: env_path("SELF_HOSTED_NODE_FORGE_ASSETS_DIR")
                .or_else(|| env_path("MANA_BREW_FORGE_ASSETS_DIR"))
                .unwrap_or_else(|| root.join("forge/forge-gui")),
            harness_jar: env_path("SELF_HOSTED_NODE_FORGE_HARNESS_JAR")
                .or_else(|| env_path("MANA_BREW_FORGE_HARNESS_JAR"))
                .unwrap_or_else(|| {
                    root.join("forge-harness/target/forge-harness-jar-with-dependencies.jar")
                }),
            java_home: env_path("SELF_HOSTED_NODE_JAVA_HOME")
                .or_else(|| env_path("MANA_BREW_JAVA_HOME"))
                .or_else(|| env_path("JAVA_HOME")),
            extra_classpath: env_classpath("SELF_HOSTED_NODE_FORGE_EXTRA_CLASSPATH")
                .into_iter()
                .chain(env_classpath("MANA_BREW_FORGE_EXTRA_CLASSPATH"))
                .collect(),
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        require_dir(&self.assets_dir, "Forge assets directory")?;
        require_file(&self.harness_jar, "Forge harness jar")?;
        if let Some(java_home) = &self.java_home {
            require_dir(java_home, "Java home")?;
        }
        for entry in &self.extra_classpath {
            if !entry.exists() {
                return Err(format!(
                    "Classpath entry does not exist: {}",
                    entry.display()
                ));
            }
        }
        Ok(())
    }

    pub fn classpath_entries(&self) -> Vec<PathBuf> {
        let mut entries = Vec::with_capacity(1 + self.extra_classpath.len());
        entries.push(self.harness_jar.clone());
        entries.extend(self.extra_classpath.iter().cloned());
        entries
    }
}

#[cfg(feature = "java-forge")]
pub fn run_hosted_engine_game(
    game_id: String,
    player_names: Vec<String>,
    decks: Vec<Deck>,
    commander_names: Vec<Option<String>>,
    local_player_index: Option<usize>,
    starting_life: i32,
    remote_prompt_tx: std_mpsc::Sender<(usize, AgentPrompt)>,
    remote_response_rxs: Vec<(usize, std_mpsc::Receiver<PlayerAction>)>,
    game_over_tx: std_mpsc::Sender<String>,
    cancel: Arc<AtomicBool>,
) {
    if let Err(error) = run_hosted_engine_game_inner(
        game_id,
        player_names,
        decks,
        commander_names,
        local_player_index,
        starting_life,
        remote_prompt_tx,
        remote_response_rxs,
        game_over_tx,
        cancel,
    ) {
        warn!(%error, "hosted java-forge engine exited with error");
    }
}

#[cfg(not(feature = "java-forge"))]
pub fn run_hosted_engine_game(
    _game_id: String,
    _player_names: Vec<String>,
    _decks: Vec<Deck>,
    _commander_names: Vec<Option<String>>,
    _local_player_index: Option<usize>,
    _starting_life: i32,
    _remote_prompt_tx: std_mpsc::Sender<(usize, AgentPrompt)>,
    _remote_response_rxs: Vec<(usize, std_mpsc::Receiver<PlayerAction>)>,
    _game_over_tx: std_mpsc::Sender<String>,
    _cancel: Arc<AtomicBool>,
) {
    warn!(
        message = unsupported_message(),
        "hosted java-forge engine unavailable"
    );
}

#[cfg(feature = "java-forge")]
fn run_hosted_engine_game_inner(
    game_id: String,
    player_names: Vec<String>,
    decks: Vec<Deck>,
    commander_names: Vec<Option<String>>,
    local_player_index: Option<usize>,
    starting_life: i32,
    remote_prompt_tx: std_mpsc::Sender<(usize, AgentPrompt)>,
    remote_response_rxs: Vec<(usize, std_mpsc::Receiver<PlayerAction>)>,
    game_over_tx: std_mpsc::Sender<String>,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let engine = engine_handle()?;

    let mut players = Vec::with_capacity(player_names.len());
    for (index, name) in player_names.iter().enumerate() {
        let identities = deck_card_identities(&decks[index]);
        players.push(PlayerConfig::new(
            name.clone(),
            &identities,
            commander_names[index].clone(),
        ));
    }
    let request = StartGameRequest::new(game_id.clone(), starting_life, rand::random(), players);
    let session_id = engine.start_game(&request.to_json().map_err(|err| err.to_string())?)?;
    info!(game_id, session_id, "hosted java-forge session started");

    struct SessionGuard {
        engine: JavaEngineHandle,
        session_id: String,
        armed: std::cell::Cell<bool>,
    }
    impl Drop for SessionGuard {
        fn drop(&mut self) {
            if self.armed.get() {
                if let Err(error) = self.engine.abort_game(&self.session_id) {
                    warn!(session_id = %self.session_id, %error, "failed to abort java session; context may leak");
                }
            }
        }
    }
    let guard = SessionGuard {
        engine: engine.clone(),
        session_id: session_id.clone(),
        armed: std::cell::Cell::new(true),
    };

    let mut remote_response_rxs: HashMap<usize, std_mpsc::Receiver<PlayerAction>> =
        remote_response_rxs.into_iter().collect();
    let mut last_prompt_json: Option<String> = None;
    let mut pending_roll_acks: usize = 0;

    loop {
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            info!(
                session_id,
                "hosted java-forge session cancelled; player left the game"
            );
            return Ok(());
        }
        for (player_index, rx) in &mut remote_response_rxs {
            loop {
                match rx.try_recv() {
                    Ok(PlayerAction::FirstPlayerRollAcknowledged) => {
                        if pending_roll_acks > 0 {
                            pending_roll_acks -= 1;
                            if pending_roll_acks == 0 {
                                let ack =
                                    serde_json::to_string(&JavaAction::FirstPlayerRollAcknowledged)
                                        .map_err(|err| {
                                            format!("failed to serialize java roll ack: {err}")
                                        })?;
                                engine.submit_action(&session_id, &ack)?;
                            }
                        }
                    }
                    Ok(action) => match translate_java_player_action(&action) {
                        Ok(java_action) => {
                            let action_json = serde_json::to_string(&java_action).map_err(|err| {
                                format!(
                                    "failed to serialize java action for player {player_index}: {err}"
                                )
                            })?;
                            debug!(player_index, %action_json, "submitting remote response to java");
                            engine.submit_action(&session_id, &action_json)?;
                        }
                        Err(error) => {
                            warn!(player_index, %error, "dropping untranslatable remote action");
                        }
                    },
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => {
                        debug!(player_index, "java-forge response channel disconnected");
                        break;
                    }
                }
            }
        }

        if let Some(prompt_json) = engine.get_prompt(&session_id, 0)? {
            if last_prompt_json.as_deref() != Some(prompt_json.as_str()) {
                let raw: JavaRawPrompt = serde_json::from_str(&prompt_json)
                    .map_err(|err| format!("failed to parse java prompt: {err}"))?;
                let player_index = raw.player;
                debug!(
                    player_index,
                    prompt_kind = raw.body.kind_label(),
                    "forwarding java prompt to remote"
                );
                if matches!(raw.body, JavaRawPromptBody::FirstPlayerRoll { .. }) {
                    let normalized = normalize_java_prompt(raw);
                    for &agent_index in remote_response_rxs.keys() {
                        let _ = remote_prompt_tx.send((agent_index, normalized.clone()));
                    }
                    pending_roll_acks = remote_response_rxs.len();
                    if pending_roll_acks == 0 {
                        let ack = serde_json::to_string(&JavaAction::FirstPlayerRollAcknowledged)
                            .map_err(|err| {
                            format!("failed to serialize java roll ack: {err}")
                        })?;
                        engine.submit_action(&session_id, &ack)?;
                    }
                } else if Some(player_index) == local_player_index {
                    let auto = auto_java_action(&raw);
                    let action_json = serde_json::to_string(&auto)
                        .map_err(|err| format!("failed to serialize java auto action: {err}"))?;
                    engine.submit_action(&session_id, &action_json)?;
                } else if remote_prompt_tx
                    .send((player_index, normalize_java_prompt(raw)))
                    .is_err()
                {
                    return Ok(());
                }
                last_prompt_json = Some(prompt_json);
            }
        }

        if engine.is_game_over(&session_id)? {
            info!("hosted java-forge session reached game over");
            if let Ok(snapshot_json) = engine.get_snapshot(&session_id) {
                if let Ok(raw_snapshot) = serde_json::from_str::<JavaRawSnapshot>(&snapshot_json) {
                    let prompt = make_java_game_over_prompt(&raw_snapshot, Some(&session_id));
                    for &agent_index in remote_response_rxs.keys() {
                        let _ = remote_prompt_tx.send((agent_index, prompt.clone()));
                    }
                }
            }
            let _ = game_over_tx.send(game_id.clone());
            engine.end_game(&session_id)?;
            guard.armed.set(false);
            return Ok(());
        }

        std::thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(feature = "java-forge")]
fn wait_for_prompt<B: JavaBridge>(
    session: &mut JavaForgeSession<B>,
    max_polls: usize,
) -> Result<Option<String>, String> {
    for _ in 0..max_polls {
        if let Some(prompt) = session.get_prompt(0)? {
            return Ok(Some(prompt));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Ok(None)
}

#[cfg(feature = "java-forge")]
fn auto_java_action(prompt: &JavaRawPrompt) -> JavaAction {
    if let JavaRawPromptBody::Priority { actions, .. } = &prompt.body {
        if let Some(index) = actions.iter().find_map(|action| action.index) {
            return JavaAction::ChooseAction { index };
        }
        return JavaAction::Pass {
            until_phase: bot_pass_until(prompt),
        };
    }
    JavaAction::Pass { until_phase: None }
}

#[cfg(feature = "java-forge")]
fn bot_pass_until(prompt: &JavaRawPrompt) -> Option<String> {
    if prompt.snapshot.active_player == Some(prompt.player) {
        None
    } else {
        Some("cleanup".to_string())
    }
}

#[cfg(feature = "java-forge")]
fn deck_card_identities(deck: &Deck) -> Vec<CardIdentity> {
    deck.cards
        .iter()
        .chain(deck.commanders.iter().flatten())
        .map(|card| card.identity.clone())
        .collect()
}

#[cfg(feature = "java-forge")]
fn smoke_deck(land_name: &str, spell_name: &str) -> Vec<CardIdentity> {
    (0..24)
        .map(|_| CardIdentity {
            name: land_name.to_string(),
            ..Default::default()
        })
        .chain((0..36).map(|_| CardIdentity {
            name: spell_name.to_string(),
            ..Default::default()
        }))
        .collect()
}

#[cfg(feature = "java-forge")]
fn scenario_deck(land_name: &str) -> Vec<CardIdentity> {
    (0..60)
        .map(|_| CardIdentity {
            name: land_name.to_string(),
            ..Default::default()
        })
        .collect()
}

#[cfg(feature = "java-forge")]
enum JavaScenario {
    KeepAndPlayLand {
        played_land: bool,
    },
    MulliganOncePlayLand {
        mulliganed: bool,
        kept_second_hand: bool,
        put_back_done: bool,
        played_land: bool,
    },
}

#[cfg(feature = "java-forge")]
impl JavaScenario {
    fn from_name(name: &str) -> Result<Self, String> {
        match name {
            "keep-and-play-land" => Ok(Self::KeepAndPlayLand { played_land: false }),
            "mulligan-once-play-land" => Ok(Self::MulliganOncePlayLand {
                mulliganed: false,
                kept_second_hand: false,
                put_back_done: false,
                played_land: false,
            }),
            _ => Err(format!(
                "unknown java-forge scenario '{name}'. Supported scenarios: keep-and-play-land, mulligan-once-play-land"
            )),
        }
    }

    fn name(&self) -> &'static str {
        match self {
            Self::KeepAndPlayLand { .. } => "keep-and-play-land",
            Self::MulliganOncePlayLand { .. } => "mulligan-once-play-land",
        }
    }

    fn next_action(&mut self, prompt: &Value) -> Result<Option<PlayerAction>, String> {
        match self {
            Self::KeepAndPlayLand { played_land } => {
                if *played_land && battlefield_contains(prompt, "Swamp") {
                    return Ok(None);
                }
                match prompt_type(prompt) {
                    Some("mulligan") => Ok(Some(PlayerAction::MulliganDecision { keep: true })),
                    Some("chooseAction") => {
                        if let Some(action) = play_first_card_action(prompt, "Swamp")? {
                            *played_land = true;
                            Ok(Some(action))
                        } else {
                            Ok(Some(PlayerAction::Pass { until_phase: None }))
                        }
                    }
                    other => Err(format!(
                        "scenario '{}' expected mulligan or chooseAction, got {:?}",
                        self.name(),
                        other
                    )),
                }
            }
            Self::MulliganOncePlayLand {
                mulliganed,
                kept_second_hand,
                put_back_done,
                played_land,
            } => {
                if *played_land && battlefield_contains(prompt, "Swamp") {
                    return Ok(None);
                }
                match prompt_type(prompt) {
                    Some("mulligan") if !*mulliganed => {
                        *mulliganed = true;
                        Ok(Some(PlayerAction::MulliganDecision { keep: false }))
                    }
                    Some("mulligan") if !*kept_second_hand => {
                        *kept_second_hand = true;
                        Ok(Some(PlayerAction::MulliganDecision { keep: true }))
                    }
                    Some("mulliganPutBack") if !*put_back_done => {
                        let count = prompt
                            .get("count")
                            .and_then(Value::as_u64)
                            .unwrap_or(1) as usize;
                        let card_ids = prompt_card_ids(prompt, "handCardIds", count)?;
                        *put_back_done = true;
                        Ok(Some(PlayerAction::MulliganPutBackDecision { card_ids }))
                    }
                    Some("chooseAction") => {
                        if let Some(action) = play_first_card_action(prompt, "Swamp")? {
                            *played_land = true;
                            Ok(Some(action))
                        } else {
                            Ok(Some(PlayerAction::Pass { until_phase: None }))
                        }
                    }
                    other => Err(format!(
                        "scenario '{}' expected mulligan, mulliganPutBack, or chooseAction, got {:?}",
                        self.name(),
                        other
                    )),
                }
            }
        }
    }
}

#[cfg(feature = "java-forge")]
fn run_scenario_loop<B: JavaBridge>(
    session: &mut JavaForgeSession<B>,
    mut scenario: JavaScenario,
    max_prompts: usize,
) -> Result<(), String> {
    let mut prompts_seen = 0usize;
    let mut last_prompt_json: Option<String> = None;
    while prompts_seen < max_prompts {
        let Some(prompt_json) = wait_for_prompt(session, 600)? else {
            return Err(format!(
                "timed out waiting for java-forge scenario '{}' prompt",
                scenario.name()
            ));
        };
        if last_prompt_json.as_deref() == Some(prompt_json.as_str()) {
            std::thread::sleep(Duration::from_millis(50));
            continue;
        }
        last_prompt_json = Some(prompt_json.clone());
        prompts_seen += 1;

        let raw: JavaRawPrompt = serde_json::from_str(&prompt_json)
            .map_err(|err| format!("failed to parse java scenario prompt: {err}"))?;
        let player = raw.player;
        if player != 0 {
            let auto = auto_java_action(&raw);
            session.submit_action(&serde_json::to_string(&auto).map_err(|err| err.to_string())?)?;
            continue;
        }

        let normalized_prompt =
            serde_json::to_value(normalize_java_prompt(raw)).map_err(|err| err.to_string())?;
        info!(
            scenario = scenario.name(),
            prompts_seen,
            prompt_type = prompt_type(&normalized_prompt).unwrap_or("<missing>"),
            "java-forge scenario prompt"
        );
        let Some(action) = scenario.next_action(&normalized_prompt)? else {
            info!(
                scenario = scenario.name(),
                prompts_seen, "java-forge scenario assertions satisfied"
            );
            return Ok(());
        };
        submit_player_action(session, &action)?;
    }
    Err(format!(
        "java-forge scenario '{}' did not complete within {max_prompts} prompts",
        scenario.name()
    ))
}

#[cfg(feature = "java-forge")]
fn run_self_play_loop<B: JavaBridge>(
    session: &mut JavaForgeSession<B>,
    max_prompts: usize,
) -> Result<(), String> {
    const STALL_REPEATS: usize = 100;

    let mut bots: HashMap<usize, SimpleAi> = HashMap::new();
    let mut last_prompt_json: Option<String> = None;
    let mut acted = 0usize;
    let mut repeat_count = 0usize;
    let mut seen_prompt = false;
    let max_iterations = max_prompts.saturating_mul(200).max(2_000);

    for _ in 0..max_iterations {
        if let Some(prompt_json) = session.get_prompt(0)? {
            seen_prompt = true;
            if last_prompt_json.as_deref() == Some(prompt_json.as_str()) {
                if session.is_game_over()? {
                    info!(acted, "java-forge self-play reached game over");
                    return Ok(());
                }
                repeat_count += 1;
                if repeat_count > STALL_REPEATS {
                    let raw_value: Value =
                        serde_json::from_str(&prompt_json).unwrap_or(Value::Null);
                    let normalized = normalized_value(&prompt_json);
                    dump_stuck(
                        "java re-emitted the same prompt after the bot acted (stall)",
                        &raw_value,
                        Some(&normalized),
                        session,
                    );
                    return Err(
                        "self-play stalled: java re-emitted the same prompt after the bot's action"
                            .to_string(),
                    );
                }
                std::thread::sleep(Duration::from_millis(20));
                continue;
            }
            repeat_count = 0;

            let raw: JavaRawPrompt = serde_json::from_str(&prompt_json)
                .map_err(|err| format!("failed to parse java self-play prompt: {err}"))?;
            let player = raw.player;
            let raw_value: Value = serde_json::from_str(&prompt_json).unwrap_or(Value::Null);
            let agent_prompt = normalize_java_prompt(raw);
            let normalized = serde_json::to_value(&agent_prompt).unwrap_or(Value::Null);

            match bots.entry(player).or_default().decide(agent_prompt) {
                Some(action) => {
                    if let Err(err) = submit_player_action(session, &action) {
                        dump_stuck(
                            "java rejected the bot action",
                            &raw_value,
                            Some(&normalized),
                            session,
                        );
                        return Err(format!(
                            "self-play: java rejected action for player {player}: {err}"
                        ));
                    }
                    acted += 1;
                    if acted >= max_prompts {
                        dump_stuck(
                            "did not reach game over within max prompts",
                            &raw_value,
                            Some(&normalized),
                            session,
                        );
                        return Err(format!(
                            "self-play did not reach game over within {max_prompts} decisions"
                        ));
                    }
                }
                None => debug!(
                    player,
                    prompt_type = prompt_type(&normalized).unwrap_or("<missing>"),
                    "self-play: no action for prompt (display-only)"
                ),
            }
            last_prompt_json = Some(prompt_json);
            continue;
        }

        if seen_prompt && session.is_game_over()? {
            info!(acted, "java-forge self-play reached game over");
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(20));
    }

    dump_stuck(
        "self-play exceeded its iteration cap without game over",
        &Value::Null,
        None,
        session,
    );
    Err("self-play exceeded its iteration cap without reaching game over".to_string())
}

#[cfg(feature = "java-forge")]
fn parse_snapshot<B: JavaBridge>(session: &mut JavaForgeSession<B>) -> Result<Value, String> {
    let snapshot_json = session.get_snapshot()?;
    serde_json::from_str(&snapshot_json)
        .map_err(|err| format!("failed to parse java self-play snapshot: {err}"))
}

#[cfg(feature = "java-forge")]
fn normalized_value(prompt_json: &str) -> Value {
    serde_json::from_str::<JavaRawPrompt>(prompt_json)
        .ok()
        .map(normalize_java_prompt)
        .and_then(|agent| serde_json::to_value(agent).ok())
        .unwrap_or(Value::Null)
}

#[cfg(feature = "java-forge")]
fn dump_stuck<B: JavaBridge>(
    reason: &str,
    prompt: &Value,
    normalized: Option<&Value>,
    session: &mut JavaForgeSession<B>,
) {
    let snapshot = parse_snapshot(session).unwrap_or(Value::Null);
    let artifact = json!({
        "reason": reason,
        "rawPrompt": prompt,
        "normalizedPrompt": normalized,
        "snapshot": snapshot,
    });
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = workspace_root().join(format!("target/self-play-stuck-{ts}.json"));
    match serde_json::to_string_pretty(&artifact) {
        Ok(body) => {
            if let Err(error) = std::fs::write(&path, body) {
                warn!(%error, reason, "self-play stuck; failed to write artifact");
            } else {
                warn!(path = %path.display(), reason, "self-play stuck; wrote artifact");
            }
        }
        Err(error) => warn!(%error, reason, "self-play stuck; failed to serialize artifact"),
    }
}

#[cfg(feature = "java-forge")]
fn submit_player_action<B: JavaBridge>(
    session: &mut JavaForgeSession<B>,
    action: &PlayerAction,
) -> Result<(), String> {
    let java_action = translate_java_player_action(action)
        .map_err(|err| format!("scenario player action has no java translation: {err}"))?;
    let action_json = serde_json::to_string(&java_action)
        .map_err(|err| format!("failed to serialize scenario java action: {err}"))?;
    session.submit_action(&action_json)?;
    Ok(())
}

#[cfg(feature = "java-forge")]
fn prompt_type(prompt: &Value) -> Option<&str> {
    prompt.get("type").and_then(Value::as_str)
}

#[cfg(feature = "java-forge")]
fn play_first_card_action(prompt: &Value, card_name: &str) -> Result<Option<PlayerAction>, String> {
    let Some(option) = prompt
        .get("playableOptions")
        .and_then(Value::as_array)
        .and_then(|options| {
            options.iter().find(|option| {
                option
                    .get("modeLabel")
                    .and_then(Value::as_str)
                    .is_some_and(|label| label.contains(card_name))
            })
        })
    else {
        return Ok(None);
    };
    let card_id = option
        .get("cardId")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("playable option for '{card_name}' is missing cardId"))?;
    let mode = option
        .get("mode")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("playable option for '{card_name}' is missing mode"))?;
    Ok(Some(PlayerAction::PlayCard {
        card_id: card_id.to_string(),
        mode: Some(mode.to_string()),
    }))
}

#[cfg(feature = "java-forge")]
fn prompt_card_ids(prompt: &Value, field: &str, count: usize) -> Result<Vec<String>, String> {
    let card_ids = prompt
        .get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("prompt is missing {field}"))?;
    if card_ids.len() < count {
        return Err(format!(
            "prompt field {field} has {} cards, need {count}",
            card_ids.len()
        ));
    }
    Ok(card_ids
        .iter()
        .take(count)
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect())
}

#[cfg(feature = "java-forge")]
fn battlefield_contains(prompt: &Value, card_name: &str) -> bool {
    prompt
        .get("gameView")
        .and_then(|game_view| game_view.get("battlefield"))
        .and_then(Value::as_array)
        .is_some_and(|cards| {
            cards.iter().any(|card| {
                card.get("name").and_then(Value::as_str) == Some(card_name)
                    && card.get("controllerId").and_then(Value::as_str) == Some("player-0")
            })
        })
}

pub trait JavaBridge {
    fn initialize(&mut self, assets_dir: &str) -> Result<(), String>;
    fn start_game_json(&mut self, request_json: &str) -> Result<String, String>;
    fn submit_action(&mut self, session_id: &str, action_json: &str) -> Result<String, String>;
    fn get_prompt(
        &mut self,
        session_id: &str,
        player_index: usize,
    ) -> Result<Option<String>, String>;
    fn get_snapshot(&mut self, session_id: &str) -> Result<String, String>;
    fn is_game_over(&mut self, session_id: &str) -> Result<bool, String>;
    fn end_game(&mut self, session_id: &str) -> Result<(), String>;
    fn abort_game(&mut self, session_id: &str) -> Result<(), String>;
}

pub struct JavaForgeSession<B> {
    bridge: B,
    session_id: Option<String>,
}

impl<B: JavaBridge> JavaForgeSession<B> {
    pub fn new(bridge: B) -> Self {
        Self {
            bridge,
            session_id: None,
        }
    }

    pub fn initialize(&mut self, assets_dir: &str) -> Result<(), String> {
        self.bridge.initialize(assets_dir)
    }

    pub fn start_game(&mut self, request: &StartGameRequest) -> Result<String, String> {
        let request_json = request.to_json().map_err(|err| err.to_string())?;
        let response_json = self.bridge.start_game_json(&request_json)?;
        let response: StartGameResponse =
            serde_json::from_str(&response_json).map_err(|err| err.to_string())?;
        self.session_id = Some(response.session_id.clone());
        Ok(response.session_id)
    }

    pub fn submit_action(&mut self, action_json: &str) -> Result<String, String> {
        let session_id = self.require_session_id()?.to_string();
        self.bridge.submit_action(&session_id, action_json)
    }

    pub fn get_prompt(&mut self, player_index: usize) -> Result<Option<String>, String> {
        let session_id = self.require_session_id()?.to_string();
        self.bridge.get_prompt(&session_id, player_index)
    }

    pub fn get_snapshot(&mut self) -> Result<String, String> {
        let session_id = self.require_session_id()?.to_string();
        self.bridge.get_snapshot(&session_id)
    }

    pub fn is_game_over(&mut self) -> Result<bool, String> {
        let session_id = self.require_session_id()?.to_string();
        self.bridge.is_game_over(&session_id)
    }

    pub fn end_game(&mut self) -> Result<(), String> {
        let Some(session_id) = self.session_id.take() else {
            return Ok(());
        };
        self.bridge.end_game(&session_id)
    }

    fn require_session_id(&self) -> Result<&str, String> {
        self.session_id
            .as_deref()
            .ok_or_else(|| "java-forge session has not started".to_string())
    }
}

pub struct UnavailableJavaBridge;

impl JavaBridge for UnavailableJavaBridge {
    fn initialize(&mut self, _assets_dir: &str) -> Result<(), String> {
        Err(unsupported_message().to_string())
    }

    fn start_game_json(&mut self, _request_json: &str) -> Result<String, String> {
        Err(unsupported_message().to_string())
    }

    fn submit_action(&mut self, _session_id: &str, _action_json: &str) -> Result<String, String> {
        Err(unsupported_message().to_string())
    }

    fn get_prompt(
        &mut self,
        _session_id: &str,
        _player_index: usize,
    ) -> Result<Option<String>, String> {
        Err(unsupported_message().to_string())
    }

    fn get_snapshot(&mut self, _session_id: &str) -> Result<String, String> {
        Err(unsupported_message().to_string())
    }

    fn is_game_over(&mut self, _session_id: &str) -> Result<bool, String> {
        Err(unsupported_message().to_string())
    }

    fn end_game(&mut self, _session_id: &str) -> Result<(), String> {
        Err(unsupported_message().to_string())
    }

    fn abort_game(&mut self, _session_id: &str) -> Result<(), String> {
        Err(unsupported_message().to_string())
    }
}

#[cfg(feature = "java-forge")]
#[derive(serde::Deserialize)]
struct SubprocessReply {
    ok: bool,
    #[serde(default)]
    result: String,
    #[serde(default)]
    error: Option<String>,
}

#[cfg(feature = "java-forge")]
const CALL_TIMEOUT: Duration = Duration::from_secs(60);
#[cfg(feature = "java-forge")]
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);

#[cfg(feature = "java-forge")]
pub struct SubprocessBridge {
    child: Child,
    stdin: BufWriter<ChildStdin>,
    stdout_rx: std_mpsc::Receiver<String>,
    stdout_handle: Option<std::thread::JoinHandle<()>>,
    stderr_handle: Option<std::thread::JoinHandle<()>>,
}

#[cfg(feature = "java-forge")]
impl SubprocessBridge {
    fn spawn(config: &JavaRuntimeConfig) -> Result<Self, String> {
        config.validate()?;

        let java_bin = resolve_java_bin(config);
        let mut cmd = Command::new(&java_bin);
        cmd.arg("-Dfile.encoding=UTF-8");
        cmd.arg("-Dsun.stdout.encoding=UTF-8");
        cmd.arg("-Dsun.stderr.encoding=UTF-8");
        cmd.arg("-Djava.awt.headless=true");
        cmd.arg("-jar").arg(&config.harness_jar);
        cmd.arg("--interactive-server");
        cmd.arg("--forge-home")
            .arg(format!("{}/", config.assets_dir.display()));

        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|err| format!("failed to spawn java subprocess: {err}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "java subprocess has no stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "java subprocess has no stdout".to_string())?;
        let stderr = child.stderr.take();

        // Bounded so a chatty Java side can't grow the queue without bound.
        // Cap is generous — protocol replies are one line per request.
        let (stdout_tx, stdout_rx) = std_mpsc::sync_channel::<String>(1024);
        let stdout_handle = std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if stdout_tx.send(line).is_err() {
                    break;
                }
            }
        });

        let stderr_handle = std::thread::spawn(move || {
            if let Some(stderr) = stderr {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    debug!(target: "self_hosted_node::java", "[java] {line}");
                }
            }
        });

        Ok(Self {
            child,
            stdin: BufWriter::new(stdin),
            stdout_rx,
            stdout_handle: Some(stdout_handle),
            stderr_handle: Some(stderr_handle),
        })
    }

    fn call(&mut self, request_json: &str) -> Result<String, String> {
        // Drain anything still queued from a prior request — a previous call()
        // that timed out may have left its reply in the channel, and consuming
        // it now would shift every subsequent call off-by-one.
        loop {
            match self.stdout_rx.try_recv() {
                Ok(stale) => {
                    debug!(target: "self_hosted_node::java", line = %stale, "discarding stale stdout line");
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    return Err("java subprocess closed stdout (crashed?)".to_string());
                }
            }
        }

        self.stdin
            .write_all(request_json.as_bytes())
            .map_err(|err| format!("failed to write subprocess stdin: {err}"))?;
        self.stdin
            .write_all(b"\n")
            .map_err(|err| format!("failed to write subprocess newline: {err}"))?;
        self.stdin
            .flush()
            .map_err(|err| format!("failed to flush subprocess stdin: {err}"))?;

        let deadline = Instant::now() + CALL_TIMEOUT;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(format!(
                    "java subprocess timed out after {}s",
                    CALL_TIMEOUT.as_secs()
                ));
            }
            match self.stdout_rx.recv_timeout(remaining) {
                Ok(line) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    match serde_json::from_str::<SubprocessReply>(trimmed) {
                        Ok(reply) if reply.ok => return Ok(reply.result),
                        Ok(reply) => {
                            return Err(reply.error.unwrap_or_else(|| "unknown java error".into()));
                        }
                        Err(_) => {
                            debug!(target: "self_hosted_node::java", line = trimmed, "non-protocol stdout line");
                        }
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    return Err(format!(
                        "java subprocess timed out after {}s",
                        CALL_TIMEOUT.as_secs()
                    ));
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err("java subprocess closed stdout (crashed?)".to_string());
                }
            }
        }
    }

    fn reset(&mut self) -> Result<(), String> {
        self.call("{\"command\":\"reset\"}").map(|_| ())
    }

    fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    fn shutdown(mut self) {
        let _ = self.stdin.write_all(b"{\"command\":\"quit\"}\n");
        let _ = self.stdin.flush();
        let deadline = Instant::now() + SHUTDOWN_GRACE;
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if Instant::now() >= deadline => {
                    let _ = self.child.kill();
                    let _ = self.child.wait();
                    break;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(_) => break,
            }
        }
        if let Some(handle) = self.stdout_handle.take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.stderr_handle.take() {
            let _ = handle.join();
        }
    }
}

#[cfg(feature = "java-forge")]
impl JavaBridge for SubprocessBridge {
    fn initialize(&mut self, _assets_dir: &str) -> Result<(), String> {
        Ok(())
    }

    fn start_game_json(&mut self, request_json: &str) -> Result<String, String> {
        let body = json!({ "command": "startGame", "payload": request_json });
        self.call(&body.to_string())
    }

    fn submit_action(&mut self, session_id: &str, action_json: &str) -> Result<String, String> {
        let body = json!({
            "command": "submitAction",
            "sessionId": session_id,
            "payload": action_json,
        });
        self.call(&body.to_string())
    }

    fn get_prompt(
        &mut self,
        session_id: &str,
        player_index: usize,
    ) -> Result<Option<String>, String> {
        let body = json!({
            "command": "getPrompt",
            "sessionId": session_id,
            "playerIndex": player_index,
        });
        let prompt = self.call(&body.to_string())?;
        Ok((!prompt.is_empty()).then_some(prompt))
    }

    fn get_snapshot(&mut self, session_id: &str) -> Result<String, String> {
        let body = json!({ "command": "getSnapshot", "sessionId": session_id });
        self.call(&body.to_string())
    }

    fn is_game_over(&mut self, session_id: &str) -> Result<bool, String> {
        let body = json!({ "command": "getGameOver", "sessionId": session_id });
        let value = self.call(&body.to_string())?;
        Ok(value.trim() == "true")
    }

    fn end_game(&mut self, session_id: &str) -> Result<(), String> {
        let body = json!({ "command": "endGame", "sessionId": session_id });
        self.call(&body.to_string()).map(|_| ())
    }

    fn abort_game(&mut self, session_id: &str) -> Result<(), String> {
        let body = json!({ "command": "abortGame", "sessionId": session_id });
        self.call(&body.to_string()).map(|_| ())
    }
}

#[cfg(feature = "java-forge")]
impl Drop for SubprocessBridge {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(handle) = self.stdout_handle.take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.stderr_handle.take() {
            let _ = handle.join();
        }
    }
}

#[cfg(feature = "java-forge")]
fn resolve_java_bin(config: &JavaRuntimeConfig) -> String {
    if let Some(home) = &config.java_home {
        let bin = home.join("bin").join("java");
        if bin.is_file() {
            return bin.to_string_lossy().to_string();
        }
    }
    if let Ok(home) = env::var("JAVA_HOME") {
        let bin = PathBuf::from(home).join("bin").join("java");
        if bin.is_file() {
            return bin.to_string_lossy().to_string();
        }
    }
    "java".to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartGameRequest {
    game_id: String,
    starting_life: i32,
    seed: u64,
    players: Vec<PlayerConfig>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerConfig {
    name: String,
    deck: Vec<CardIdentityForJava>,
    commander_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardIdentityForJava {
    name: String,
    set_code: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartGameResponse {
    session_id: String,
    #[allow(dead_code)]
    player_indexes: Vec<usize>,
}

impl StartGameRequest {
    pub fn new(game_id: String, starting_life: i32, seed: u64, players: Vec<PlayerConfig>) -> Self {
        Self {
            game_id,
            starting_life,
            seed,
            players,
        }
    }

    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}

impl PlayerConfig {
    pub fn new(name: String, deck: &[CardIdentity], commander_name: Option<String>) -> Self {
        Self {
            name,
            deck: deck.iter().map(CardIdentityForJava::from).collect(),
            commander_name,
        }
    }
}

impl From<&CardIdentity> for CardIdentityForJava {
    fn from(identity: &CardIdentity) -> Self {
        Self {
            name: java_card_name(&identity.name),
            set_code: (!identity.set_code.is_empty()).then(|| identity.set_code.clone()),
        }
    }
}

fn java_card_name(name: &str) -> String {
    name.split_once(" // ")
        .map(|(front, _)| front.to_string())
        .unwrap_or_else(|| name.to_string())
}

fn env_path(key: &str) -> Option<PathBuf> {
    env::var_os(key)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn env_classpath(key: &str) -> Vec<PathBuf> {
    let Some(value) = env::var_os(key) else {
        return Vec::new();
    };
    env::split_paths(&value).collect()
}

fn require_dir(path: &Path, label: &str) -> Result<(), String> {
    if path.is_dir() {
        Ok(())
    } else {
        Err(format!("{label} does not exist: {}", path.display()))
    }
}

fn require_file(path: &Path, label: &str) -> Result<(), String> {
    if path.is_file() {
        Ok(())
    } else {
        Err(format!("{label} does not exist: {}", path.display()))
    }
}
