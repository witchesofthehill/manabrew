#![allow(dead_code)]

#[cfg(forge_backend)]
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
use std::sync::mpsc::RecvTimeoutError;
#[cfg(forge_backend)]
use std::sync::mpsc::TryRecvError;
use std::sync::Arc;
#[cfg(feature = "java-forge")]
use std::sync::Mutex;
#[cfg(forge_backend)]
use std::time::Duration;
#[cfg(feature = "java-forge")]
use std::time::Instant;

use manabrew_protocol::deck_dto::{Deck, DeckCardIdentity};

use crate::config::DeckSelection;
#[cfg(feature = "java-forge")]
use manabot::{BotAgent, SimpleAi};
#[cfg(forge_backend)]
use manabrew_agent_interface::game_view_dto::GameViewDto;
use manabrew_agent_interface::prompt::{AgentMessage, ClientToServerMessage};
#[cfg(forge_backend)]
use manabrew_agent_interface::prompt::{
    AgentPrompt, ChooseActionOutput, DiceRolledOutput, DirectiveInput, GameOverInput, PromptInput,
    PromptOutput, ProtocolError, ProtocolErrorCode, ResponseViolation, StateUpdate,
};
#[cfg(feature = "java-forge")]
use manabrew_agent_interface::prompt::{MulliganOutput, MulliganPutBackOutput};
use serde::Serialize;
#[cfg(feature = "java-forge")]
use serde_json::json;
#[cfg(feature = "java-forge")]
use serde_json::Value;
#[cfg(forge_backend)]
use tracing::warn;
#[cfg(forge_backend)]
use tracing::{debug, info};

use super::HostedGameOver;
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
        String::new(),
        20,
        42,
        vec![
            PlayerConfig::new("Smoke A".to_string(), &deck_a, Vec::new()),
            PlayerConfig::new("Smoke B".to_string(), &deck_b, Vec::new()),
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
        let prompt: AgentPrompt = serde_json::from_str(&prompt_json)
            .map_err(|err| format!("failed to parse java-forge smoke prompt: {err}"))?;
        let player = player_index(&prompt.deciding_player_id);
        info!(prompts_seen, player, "java-forge smoke prompt");
        let pass = PromptOutput::ChooseAction(ChooseActionOutput::Pass {
            until: None,
            exhaust_stack: false,
        });
        session.submit_action(&serde_json::to_string(&pass).map_err(|err| err.to_string())?)?;
        prompts_seen += 1;
    }

    let snapshot_json = session.get_snapshot(Some(0))?;
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

// Unlike run_smoke_game, which spawns the JAR in a subprocess, this drives the
// GraalVM native library in-process: isolate creation, forge_initialize (which
// loads the card database) and a real game start. CI runs it after restoring
// forge-harness/native/build from cache, where nothing else would notice a
// stale or broken libforgeharness.
#[cfg(feature = "graal-forge")]
pub fn run_graal_smoke() -> Result<(), String> {
    let config = JavaRuntimeConfig::from_env();
    let engine = GraalEngineHandle::create(&config.assets_dir)?;

    let deck_a = smoke_deck("Mountain", "Lightning Bolt");
    let deck_b = smoke_deck("Forest", "Grizzly Bears");
    let request = StartGameRequest::new(
        "self-hosted-graal-smoke".to_string(),
        String::new(),
        20,
        42,
        vec![
            PlayerConfig::new("Smoke A".to_string(), &deck_a, Vec::new()),
            PlayerConfig::new("Smoke B".to_string(), &deck_b, Vec::new()),
        ],
    );

    let session_id = engine.start_game(&request.to_json().map_err(|err| err.to_string())?)?;
    info!(session_id, "graal-forge smoke session started");
    engine.end_game(&session_id)?;
    Ok(())
}

#[cfg(not(feature = "graal-forge"))]
pub fn run_graal_smoke() -> Result<(), String> {
    Err(
        "graal-forge smoke requires building self-hosted-node with --features graal-forge"
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
        String::new(),
        20,
        42,
        vec![
            PlayerConfig::new(
                "Scenario A".to_string(),
                &scenario_deck("Swamp"),
                Vec::new(),
            ),
            PlayerConfig::new(
                "Scenario B".to_string(),
                &scenario_deck("Forest"),
                Vec::new(),
            ),
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
            commander_names_for_java(&seat.deck, seat.commander_name.as_deref()),
        ));
    }

    for game_index in 0..games.max(1) {
        let request = StartGameRequest::new(
            format!("self-hosted-java-self-play-{game_index}"),
            String::new(),
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
struct PoolSlot {
    bridge: SharedBridge,
    active: usize,
}

#[cfg(feature = "java-forge")]
pub struct JavaEnginePool {
    config: JavaRuntimeConfig,
    max_sessions: usize,
    sessions_per_process: usize,
    slots: Mutex<Vec<PoolSlot>>,
    in_use: Mutex<HashMap<String, SharedBridge>>,
}

#[cfg(feature = "java-forge")]
#[derive(Clone)]
pub struct JavaEngineHandle {
    pool: Arc<JavaEnginePool>,
}

#[cfg(feature = "java-forge")]
impl JavaEnginePool {
    pub fn start(
        config: &JavaRuntimeConfig,
        max_sessions: usize,
        sessions_per_process: usize,
    ) -> Result<Arc<Self>, String> {
        let max_sessions = max_sessions.max(1);
        let sessions_per_process = sessions_per_process.max(1);
        let processes = max_sessions.div_ceil(sessions_per_process);
        let mut slots = Vec::with_capacity(processes);
        for slot in 0..processes {
            info!(
                slot,
                processes, sessions_per_process, "pre-warming java subprocess"
            );
            let bridge = SubprocessBridge::spawn(config)?;
            slots.push(PoolSlot {
                bridge: Arc::new(Mutex::new(bridge)),
                active: 0,
            });
        }
        Ok(Arc::new(Self {
            config: config.clone(),
            max_sessions,
            sessions_per_process,
            slots: Mutex::new(slots),
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
        let slots = self.slots.get_mut().map(std::mem::take).unwrap_or_default();
        for slot in slots {
            if let Ok(mutex) = Arc::try_unwrap(slot.bridge) {
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
            let claimed = {
                let mut slots = self
                    .slots
                    .lock()
                    .map_err(|_| "java engine slots poisoned".to_string())?;
                let mut claimed = None;
                for slot in slots.iter_mut() {
                    if slot.active < self.sessions_per_process {
                        slot.active += 1;
                        claimed = Some(Arc::clone(&slot.bridge));
                        break;
                    }
                }
                claimed
            };
            if let Some(bridge) = claimed {
                let alive = bridge
                    .lock()
                    .ok()
                    .map(|mut guard| guard.is_alive())
                    .unwrap_or(false);
                if alive {
                    return Ok(bridge);
                }
                warn!("discarding dead java subprocess from pool");
                self.replace_slot(&bridge);
                continue;
            }
            if Instant::now() >= deadline {
                return Err(format!(
                    "java engine pool exhausted (max_sessions={}); no free session slot after 60s",
                    self.max_sessions
                ));
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    fn release(&self, bridge: SharedBridge) {
        let now_idle = {
            let mut slots = match self.slots.lock() {
                Ok(slots) => slots,
                Err(_) => return,
            };
            match slots.iter_mut().find(|s| Arc::ptr_eq(&s.bridge, &bridge)) {
                Some(slot) => {
                    slot.active = slot.active.saturating_sub(1);
                    slot.active == 0
                }
                None => return,
            }
        };
        if !now_idle {
            return;
        }
        let healthy = {
            let mut guard = match bridge.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            guard.is_alive() && guard.reset().is_ok()
        };
        if !healthy {
            warn!("java subprocess unhealthy at idle; respawning");
            self.replace_slot(&bridge);
        }
    }

    fn replace_slot(&self, dead: &SharedBridge) {
        let Ok(mut slots) = self.slots.lock() else {
            return;
        };
        let Some(index) = slots.iter().position(|s| Arc::ptr_eq(&s.bridge, dead)) else {
            return;
        };
        match SubprocessBridge::spawn(&self.config) {
            Ok(replacement) => {
                slots[index] = PoolSlot {
                    bridge: Arc::new(Mutex::new(replacement)),
                    active: 0,
                };
            }
            Err(error) => {
                warn!(%error, "failed to respawn java subprocess; retiring pool slot");
                slots.remove(index);
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
        let mutex_started = Instant::now();
        let mut guard = bridge
            .lock()
            .map_err(|_| "java subprocess mutex poisoned".to_string())?;
        crate::metrics::record_forge_decision_stage("bridge_mutex", mutex_started.elapsed());
        let call_started = Instant::now();
        let result = guard.submit_action(session_id, action_json);
        crate::metrics::record_forge_decision_stage("submit_action", call_started.elapsed());
        result
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

    pub fn get_snapshot(&self, session_id: &str, viewer: Option<usize>) -> Result<String, String> {
        let bridge = self.bridge_for(session_id)?;
        let mut guard = bridge
            .lock()
            .map_err(|_| "java subprocess mutex poisoned".to_string())?;
        guard.get_snapshot(session_id, viewer)
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
    // SELF_HOSTED_NODE_MAX_GAMES is the concurrent-session ceiling for this node.
    // SELF_HOSTED_NODE_GAMES_PER_JVM multiplexes that many sessions into each
    // subprocess (the engine is concurrency-safe since the endstep patches), so
    // the pool spawns ceil(max_games / games_per_jvm) processes. Default 1 keeps
    // the historical one-subprocess-per-game shape.
    let max_sessions = env::var("SELF_HOSTED_NODE_MAX_GAMES")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|n| *n >= 1)
        .unwrap_or(1);
    let sessions_per_process = env::var("SELF_HOSTED_NODE_GAMES_PER_JVM")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|n| *n >= 1)
        .unwrap_or(1);
    let pool = JavaEnginePool::start(&config, max_sessions, sessions_per_process)?;
    JAVA_ENGINE
        .set(pool)
        .map_err(|_| "java engine already initialized".to_string())
}

#[cfg(all(feature = "graal-forge", not(feature = "java-forge")))]
pub fn init_engine() -> Result<(), String> {
    // Loading the card database into the isolate takes tens of seconds on a
    // small box. Pay it here, before any room is advertised, rather than
    // leaving it for whoever starts the first game.
    if shared_isolate_enabled() {
        drop(GraalEngineHandle::create(
            &JavaRuntimeConfig::from_env().assets_dir,
        )?);
    }
    Ok(())
}

#[cfg(not(forge_backend))]
pub fn init_engine() -> Result<(), String> {
    Err(
        "forge engine requires building self-hosted-node with --features java-forge or graal-forge"
            .to_string(),
    )
}

#[cfg(feature = "java-forge")]
fn engine_handle() -> Result<JavaEngineHandle, String> {
    JAVA_ENGINE
        .get()
        .map(JavaEnginePool::handle)
        .ok_or_else(|| "java engine is not initialized".to_string())
}

#[cfg(feature = "java-forge")]
type ForgeEngine = JavaEngineHandle;

#[cfg(feature = "java-forge")]
fn obtain_engine() -> Result<ForgeEngine, String> {
    engine_handle()
}

#[cfg(all(feature = "graal-forge", not(feature = "java-forge")))]
type ForgeEngine = GraalEngineHandle;

#[cfg(all(feature = "graal-forge", not(feature = "java-forge")))]
fn obtain_engine() -> Result<ForgeEngine, String> {
    GraalEngineHandle::create(&JavaRuntimeConfig::from_env().assets_dir)
}

#[cfg(feature = "graal-forge")]
mod graal_ffi {
    use std::os::raw::{c_char, c_int};

    #[allow(non_camel_case_types)]
    pub type graal_isolate_t = std::ffi::c_void;
    #[allow(non_camel_case_types)]
    pub type graal_isolatethread_t = std::ffi::c_void;

    extern "C" {
        pub fn graal_create_isolate(
            params: *mut std::ffi::c_void,
            isolate: *mut *mut graal_isolate_t,
            thread: *mut *mut graal_isolatethread_t,
        ) -> c_int;
        pub fn graal_tear_down_isolate(thread: *mut graal_isolatethread_t) -> c_int;
        pub fn graal_attach_thread(
            isolate: *mut graal_isolate_t,
            thread: *mut *mut graal_isolatethread_t,
        ) -> c_int;
        pub fn graal_detach_thread(thread: *mut graal_isolatethread_t) -> c_int;
        pub fn forge_initialize(
            thread: *mut graal_isolatethread_t,
            assets_dir: *const c_char,
        ) -> *mut c_char;
        pub fn forge_start_game(
            thread: *mut graal_isolatethread_t,
            request_json: *const c_char,
        ) -> *mut c_char;
        pub fn forge_submit_action(
            thread: *mut graal_isolatethread_t,
            session_id: *const c_char,
            action_json: *const c_char,
        ) -> *mut c_char;
        pub fn forge_get_prompt(
            thread: *mut graal_isolatethread_t,
            session_id: *const c_char,
            player_index: c_int,
        ) -> *mut c_char;
        pub fn forge_get_snapshot(
            thread: *mut graal_isolatethread_t,
            session_id: *const c_char,
            viewer: c_int,
        ) -> *mut c_char;
        pub fn forge_get_game_over(
            thread: *mut graal_isolatethread_t,
            session_id: *const c_char,
        ) -> *mut c_char;
        pub fn forge_end_game(
            thread: *mut graal_isolatethread_t,
            session_id: *const c_char,
        ) -> *mut c_char;
        pub fn forge_abort_game(
            thread: *mut graal_isolatethread_t,
            session_id: *const c_char,
        ) -> *mut c_char;
        pub fn forge_free_string(thread: *mut graal_isolatethread_t, ptr: *mut c_char);
    }
}

#[cfg(feature = "graal-forge")]
#[derive(serde::Deserialize)]
struct ForgeReply {
    ok: bool,
    #[serde(default)]
    result: String,
    #[serde(default)]
    error: Option<String>,
}

// A GraalVM isolate hosts the in-process Forge engine. The `thread` handle is
// bound to the hosted-engine thread that created or attached it (isolate
// threads are not portable), so the handle is Rc/!Send by design. In shared
// mode one isolate serves all rooms: the first creator initializes Forge, later
// rooms attach their own thread to it and sessions coexist in the adapter.
#[cfg(feature = "graal-forge")]
struct GraalBridge {
    thread: *mut graal_ffi::graal_isolatethread_t,
    attached: bool,
}

#[cfg(feature = "graal-forge")]
struct SharedIsolate(*mut graal_ffi::graal_isolate_t);
#[cfg(feature = "graal-forge")]
unsafe impl Send for SharedIsolate {}

#[cfg(feature = "graal-forge")]
static SHARED_GRAAL_ISOLATE: std::sync::Mutex<Option<SharedIsolate>> = std::sync::Mutex::new(None);

// One isolate hosts every room's game (safe since the endstep concurrency
// patches), so the card database loads once per node. Off keeps the historical
// isolate-per-game shape.
#[cfg(feature = "graal-forge")]
fn shared_isolate_enabled() -> bool {
    env::var("SELF_HOSTED_NODE_SHARED_ISOLATE")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

#[cfg(feature = "graal-forge")]
impl GraalBridge {
    fn create() -> Result<Self, String> {
        let mut isolate: *mut graal_ffi::graal_isolate_t = std::ptr::null_mut();
        let mut thread: *mut graal_ffi::graal_isolatethread_t = std::ptr::null_mut();
        let rc = unsafe {
            graal_ffi::graal_create_isolate(std::ptr::null_mut(), &mut isolate, &mut thread)
        };
        if rc != 0 {
            return Err(format!("graal_create_isolate failed with code {rc}"));
        }
        Ok(Self {
            thread,
            attached: false,
        })
    }

    fn create_in_shared_isolate(assets_dir: &Path) -> Result<Self, String> {
        let mut guard = SHARED_GRAAL_ISOLATE
            .lock()
            .map_err(|_| "shared graal isolate poisoned".to_string())?;
        if let Some(shared) = guard.as_ref() {
            let mut thread: *mut graal_ffi::graal_isolatethread_t = std::ptr::null_mut();
            let rc = unsafe { graal_ffi::graal_attach_thread(shared.0, &mut thread) };
            if rc != 0 {
                return Err(format!("graal_attach_thread failed with code {rc}"));
            }
            return Ok(Self {
                thread,
                attached: true,
            });
        }
        let mut isolate: *mut graal_ffi::graal_isolate_t = std::ptr::null_mut();
        let mut thread: *mut graal_ffi::graal_isolatethread_t = std::ptr::null_mut();
        let rc = unsafe {
            graal_ffi::graal_create_isolate(std::ptr::null_mut(), &mut isolate, &mut thread)
        };
        if rc != 0 {
            return Err(format!("graal_create_isolate failed with code {rc}"));
        }
        let mut bridge = Self {
            thread,
            attached: false,
        };
        let assets = cstring(&assets_dir.to_string_lossy())?;
        bridge.decode(unsafe { graal_ffi::forge_initialize(bridge.thread, assets.as_ptr()) })?;
        bridge.attached = true;
        *guard = Some(SharedIsolate(isolate));
        info!("shared graal isolate initialized");
        Ok(bridge)
    }

    fn decode(&self, raw: *mut std::os::raw::c_char) -> Result<String, String> {
        if raw.is_null() {
            return Err("forge native lib returned null".to_string());
        }
        let envelope = unsafe { std::ffi::CStr::from_ptr(raw) }
            .to_string_lossy()
            .into_owned();
        unsafe { graal_ffi::forge_free_string(self.thread, raw) };
        let reply: ForgeReply = serde_json::from_str(&envelope)
            .map_err(|err| format!("malformed forge envelope: {err}"))?;
        if reply.ok {
            Ok(reply.result)
        } else {
            Err(reply
                .error
                .unwrap_or_else(|| "unknown forge error".to_string()))
        }
    }
}

#[cfg(feature = "graal-forge")]
impl Drop for GraalBridge {
    fn drop(&mut self) {
        if self.attached {
            unsafe { graal_ffi::graal_detach_thread(self.thread) };
        } else {
            unsafe { graal_ffi::graal_tear_down_isolate(self.thread) };
        }
    }
}

#[cfg(feature = "graal-forge")]
#[derive(Clone)]
struct GraalEngineHandle {
    bridge: std::rc::Rc<GraalBridge>,
}

#[cfg(feature = "graal-forge")]
impl GraalEngineHandle {
    fn create(assets_dir: &Path) -> Result<Self, String> {
        let bridge = if shared_isolate_enabled() {
            GraalBridge::create_in_shared_isolate(assets_dir)?
        } else {
            let bridge = GraalBridge::create()?;
            let assets = cstring(&assets_dir.to_string_lossy())?;
            bridge
                .decode(unsafe { graal_ffi::forge_initialize(bridge.thread, assets.as_ptr()) })?;
            bridge
        };
        Ok(Self {
            bridge: std::rc::Rc::new(bridge),
        })
    }

    fn start_game(&self, request_json: &str) -> Result<String, String> {
        let request = cstring(request_json)?;
        let response = self
            .bridge
            .decode(unsafe { graal_ffi::forge_start_game(self.bridge.thread, request.as_ptr()) })?;
        let parsed: StartGameResponse = serde_json::from_str(&response)
            .map_err(|err| format!("malformed startGame response: {err}"))?;
        Ok(parsed.session_id)
    }

    fn submit_action(&self, session_id: &str, action_json: &str) -> Result<String, String> {
        let session = cstring(session_id)?;
        let action = cstring(action_json)?;
        self.bridge.decode(unsafe {
            graal_ffi::forge_submit_action(self.bridge.thread, session.as_ptr(), action.as_ptr())
        })
    }

    fn get_prompt(&self, session_id: &str, player_index: usize) -> Result<Option<String>, String> {
        let session = cstring(session_id)?;
        let prompt = self.bridge.decode(unsafe {
            graal_ffi::forge_get_prompt(
                self.bridge.thread,
                session.as_ptr(),
                player_index as std::os::raw::c_int,
            )
        })?;
        Ok((!prompt.is_empty()).then_some(prompt))
    }

    fn is_game_over(&self, session_id: &str) -> Result<bool, String> {
        let session = cstring(session_id)?;
        let value = self.bridge.decode(unsafe {
            graal_ffi::forge_get_game_over(self.bridge.thread, session.as_ptr())
        })?;
        Ok(value.trim() == "true")
    }

    fn get_snapshot(&self, session_id: &str, viewer: Option<usize>) -> Result<String, String> {
        let session = cstring(session_id)?;
        let viewer = viewer.map_or(-1, |v| v as std::os::raw::c_int);
        self.bridge.decode(unsafe {
            graal_ffi::forge_get_snapshot(self.bridge.thread, session.as_ptr(), viewer)
        })
    }

    fn end_game(&self, session_id: &str) -> Result<(), String> {
        let session = cstring(session_id)?;
        self.bridge
            .decode(unsafe { graal_ffi::forge_end_game(self.bridge.thread, session.as_ptr()) })
            .map(|_| ())
    }

    fn abort_game(&self, session_id: &str) -> Result<(), String> {
        let session = cstring(session_id)?;
        self.bridge
            .decode(unsafe { graal_ffi::forge_abort_game(self.bridge.thread, session.as_ptr()) })
            .map(|_| ())
    }
}

#[cfg(feature = "graal-forge")]
fn cstring(value: &str) -> Result<std::ffi::CString, String> {
    std::ffi::CString::new(value).map_err(|_| "string contained interior NUL".to_string())
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
    let games_per_process = env::var("SELF_HOSTED_NODE_GAMES_PER_JVM")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|n| *n >= 1)
        .unwrap_or(1);
    let pool = JavaEnginePool::start(&config, concurrency.max(1), games_per_process)?;
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
            commander_names_for_java(&seat.deck, seat.commander_name.as_deref()),
        ));
    }

    let mut joins = Vec::with_capacity(concurrency.max(1));
    for game_index in 0..concurrency.max(1) {
        let handle = pool.handle();
        let request = StartGameRequest::new(
            format!("self-hosted-java-concurrent-{game_index}"),
            String::new(),
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
            let prompt: AgentPrompt = serde_json::from_str(&prompt_json)
                .map_err(|error| format!("failed to parse concurrent prompt: {error}"))?;
            let player = player_index(&prompt.deciding_player_id);
            if let Some(action) = bots.entry(player).or_default().decide(prompt) {
                let action_json = serde_json::to_string(&action).map_err(|err| err.to_string())?;
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

/// G1 keeps pauses roughly bounded as the live set grows; Serial does not.
const DEFAULT_JAVA_COLLECTOR: &str = "G1";
const DEFAULT_JAVA_GC_LOG: &str = "stderr";
const DEFAULT_JAVA_HEAP_MB: u64 = 1024;
const DEFAULT_JAVA_ACTIVE_PROCESSORS: u64 = 2;

#[derive(Debug, Clone)]
pub struct JavaRuntimeConfig {
    pub assets_dir: PathBuf,
    pub harness_jar: PathBuf,
    pub java_home: Option<PathBuf>,
    pub extra_classpath: Vec<PathBuf>,
    pub heap_mb: Option<u64>,
    pub active_processor_count: Option<u64>,
    pub gc_log: Option<String>,
    pub collector: Option<String>,
    pub extra_jvm_args: Vec<String>,
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
            heap_mb: env_sizing("SELF_HOSTED_NODE_JAVA_HEAP_MB", DEFAULT_JAVA_HEAP_MB),
            active_processor_count: env_sizing(
                "SELF_HOSTED_NODE_JAVA_ACTIVE_PROCESSORS",
                DEFAULT_JAVA_ACTIVE_PROCESSORS,
            ),
            collector: env::var("SELF_HOSTED_NODE_JAVA_COLLECTOR")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .or_else(|| Some(DEFAULT_JAVA_COLLECTOR.to_string())),
            // Defaults on: the fleet ships no logs, so this log exists to be
            // turned into metrics by the stderr pump (see metrics.rs).
            gc_log: env::var("SELF_HOSTED_NODE_JAVA_GC_LOG")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .or_else(|| Some(DEFAULT_JAVA_GC_LOG.to_string())),
            extra_jvm_args: env::var("SELF_HOSTED_NODE_JAVA_OPTS")
                .unwrap_or_default()
                .split_whitespace()
                .map(str::to_string)
                .collect(),
        }
    }

    #[cfg(feature = "java-forge")]
    fn jvm_args(&self) -> Vec<String> {
        let mut args = vec![
            "-Dfile.encoding=UTF-8".to_string(),
            "-Dsun.stdout.encoding=UTF-8".to_string(),
            "-Dsun.stderr.encoding=UTF-8".to_string(),
            "-Djava.awt.headless=true".to_string(),
            // Forge's endstep concurrency patches assume a heap exhaustion kills the process
            // instead of thrashing; a supervised node is restarted, a thrashing one is not.
            "-XX:+ExitOnOutOfMemoryError".to_string(),
            // Forge calls System.gc() on match boundaries (Match.java,
            // HostedMatch.java) and so does the harness. Each one is a full
            // collection, and a full collection costs about 1.3ms per MB of
            // live set, so on a large board they are seconds of stop-the-world
            // for no benefit the collector would not have reached anyway.
            "-XX:+DisableExplicitGC".to_string(),
        ];
        // Pause time is linear in the live set and Serial collects on one
        // thread, so a bigger heap under Serial means longer freezes, not
        // shorter ones. Name the collector rather than inheriting whatever the
        // host's environment happens to set.
        if let Some(collector) = &self.collector {
            args.push(format!("-XX:+Use{collector}GC"));
        }
        // A fleet runs many of these side by side, and every JVM sizes its heap and its GC
        // thread count from the whole machine unless told otherwise.
        if let Some(heap_mb) = self.heap_mb {
            args.push(format!("-Xmx{heap_mb}m"));
        }
        if let Some(processors) = self.active_processor_count {
            args.push(format!("-XX:ActiveProcessorCount={processors}"));
        }
        // In a container the only log that reaches Loki is the node's own, and the
        // subprocess owns stdout for the protocol, so "stderr" routes GC through the
        // stderr pump instead of a file nothing ships.
        match self.gc_log.as_deref() {
            None => {}
            Some("stderr") => args.push("-Xlog:gc*:stderr:time,uptime,level,tags".to_string()),
            Some(dir) => args.push(format!(
                "-Xlog:gc*:file={}:time,uptime,level,tags:filecount=5,filesize=20M",
                Path::new(dir).join("engine-gc-%p.log").display()
            )),
        }
        args.extend(self.extra_jvm_args.iter().cloned());
        args
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

#[cfg(forge_backend)]
#[allow(clippy::too_many_arguments)]
pub fn run_hosted_engine_game(
    game_id: String,
    player_names: Vec<String>,
    decks: Vec<Deck>,
    commander_names: Vec<Option<String>>,
    commander_variant: bool,
    game_variant: String,
    local_player_index: Option<usize>,
    ai_player_indices: Vec<usize>,
    starting_life: i32,
    remote_prompt_tx: std_mpsc::Sender<(usize, AgentMessage)>,
    remote_response_rxs: Vec<(usize, std_mpsc::Receiver<ClientToServerMessage>)>,
    game_over_tx: std_mpsc::Sender<HostedGameOver>,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    run_hosted_engine_game_inner(
        game_id,
        player_names,
        decks,
        commander_names,
        commander_variant,
        game_variant,
        local_player_index,
        ai_player_indices,
        starting_life,
        remote_prompt_tx,
        remote_response_rxs,
        game_over_tx,
        cancel,
    )
}

#[cfg(not(forge_backend))]
#[allow(clippy::too_many_arguments)]
pub fn run_hosted_engine_game(
    _game_id: String,
    _player_names: Vec<String>,
    _decks: Vec<Deck>,
    _commander_names: Vec<Option<String>>,
    _commander_variant: bool,
    _game_variant: String,
    _local_player_index: Option<usize>,
    _ai_player_indices: Vec<usize>,
    _starting_life: i32,
    _remote_prompt_tx: std_mpsc::Sender<(usize, AgentMessage)>,
    _remote_response_rxs: Vec<(usize, std_mpsc::Receiver<ClientToServerMessage>)>,
    _game_over_tx: std_mpsc::Sender<HostedGameOver>,
    _cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    Err(unsupported_message().to_string())
}

#[cfg(forge_backend)]
#[allow(clippy::too_many_arguments)]
fn run_hosted_engine_game_inner(
    game_id: String,
    player_names: Vec<String>,
    decks: Vec<Deck>,
    commander_names: Vec<Option<String>>,
    commander_variant: bool,
    game_variant: String,
    local_player_index: Option<usize>,
    ai_player_indices: Vec<usize>,
    starting_life: i32,
    remote_prompt_tx: std_mpsc::Sender<(usize, AgentMessage)>,
    remote_response_rxs: Vec<(usize, std_mpsc::Receiver<ClientToServerMessage>)>,
    game_over_tx: std_mpsc::Sender<HostedGameOver>,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let engine = obtain_engine()?;

    let mut players = Vec::with_capacity(player_names.len());
    for (index, name) in player_names.iter().enumerate() {
        let identities = deck_card_identities(&decks[index]);
        let seat_commander_names = if commander_variant {
            commander_names_for_java(&decks[index], commander_names[index].as_deref())
        } else {
            Vec::new()
        };
        players.push(PlayerConfig::new(
            name.clone(),
            &identities,
            seat_commander_names,
        ));
    }
    for &idx in &ai_player_indices {
        if let Some(player) = players.get_mut(idx) {
            player.ai = true;
        }
    }
    let request = StartGameRequest::new(
        game_id.clone(),
        game_variant,
        starting_life,
        rand::random(),
        players,
    );
    let session_id = engine.start_game(&request.to_json().map_err(|err| err.to_string())?)?;
    info!(game_id, session_id, "hosted java-forge session started");

    struct SessionGuard {
        engine: ForgeEngine,
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

    let mut remote_response_rxs: HashMap<usize, std_mpsc::Receiver<ClientToServerMessage>> =
        remote_response_rxs.into_iter().collect();
    let mut last_prompt: Option<AgentPrompt> = None;
    let mut pending_roll_acks: usize = 0;
    let mut decision_received: Option<Instant> = None;
    let mut decision_submitted: Option<Instant> = None;

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
                    Ok(ClientToServerMessage::Response {
                        action: PromptOutput::DiceRolled(DiceRolledOutput::DiceRolledAcknowledged),
                        ..
                    }) => {
                        if pending_roll_acks > 0 {
                            pending_roll_acks -= 1;
                            if pending_roll_acks == 0 {
                                let ack = serde_json::to_string(&PromptOutput::DiceRolled(
                                    DiceRolledOutput::DiceRolledAcknowledged,
                                ))
                                .map_err(|err| format!("failed to serialize roll ack: {err}"))?;
                                engine.submit_action(&session_id, &ack)?;
                            }
                        }
                    }
                    Ok(ClientToServerMessage::Response { prompt_id, action }) => {
                        // prompt_id 0 is transport-synthesized: the
                        // absent-player default, exempt from validation.
                        if prompt_id != 0 {
                            let Some(prompt) =
                                last_prompt.as_ref().filter(|p| p.prompt_id == prompt_id)
                            else {
                                reject_response(
                                    &remote_prompt_tx,
                                    *player_index,
                                    last_prompt.as_ref().filter(|p| {
                                        self::player_index(&p.deciding_player_id) == *player_index
                                    }),
                                    ProtocolErrorCode::StalePrompt,
                                    format!("response for prompt {prompt_id} is not open"),
                                );
                                continue;
                            };
                            if self::player_index(&prompt.deciding_player_id) != *player_index {
                                reject_response(
                                    &remote_prompt_tx,
                                    *player_index,
                                    None,
                                    ProtocolErrorCode::WrongPlayer,
                                    format!(
                                        "prompt {prompt_id} is for {}",
                                        prompt.deciding_player_id
                                    ),
                                );
                                continue;
                            }
                            match prompt.input.validate_response(&action) {
                                Ok(()) => {}
                                Err(ResponseViolation::WrongPromptType) => {
                                    reject_response(
                                        &remote_prompt_tx,
                                        *player_index,
                                        Some(prompt),
                                        ProtocolErrorCode::WrongPromptType,
                                        "response output does not match the prompt type"
                                            .to_string(),
                                    );
                                    continue;
                                }
                                Err(ResponseViolation::UnknownActionId(id)) => {
                                    reject_response(
                                        &remote_prompt_tx,
                                        *player_index,
                                        Some(prompt),
                                        ProtocolErrorCode::UnknownActionId,
                                        format!(
                                            "action id {id:?} was not advertised by the prompt"
                                        ),
                                    );
                                    continue;
                                }
                                Err(ResponseViolation::CancelNotAllowed) => {
                                    reject_response(
                                        &remote_prompt_tx,
                                        *player_index,
                                        Some(prompt),
                                        ProtocolErrorCode::CancelNotAllowed,
                                        "this prompt is not cancellable".to_string(),
                                    );
                                    continue;
                                }
                            }
                        }
                        decision_received = Some(Instant::now());
                        let action_json = serde_json::to_string(&action).map_err(|err| {
                            format!(
                                "failed to serialize prompt output for player {player_index}: {err}"
                            )
                        })?;
                        debug!(player_index, %action_json, "submitting remote response to java");
                        engine.submit_action(&session_id, &action_json)?;
                        decision_submitted = Some(Instant::now());
                    }
                    Ok(ClientToServerMessage::Directive {
                        directive: DirectiveInput::Concede,
                    }) => {
                        // A directive can arrive while another player's prompt
                        // is open (this loop drains every seat), so it names
                        // its seat.
                        let directive_json = directive_concede_json(*player_index);
                        debug!(player_index, %directive_json, "submitting concede directive to java");
                        engine.submit_action(&session_id, &directive_json)?;
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => {
                        debug!(player_index, "java-forge response channel disconnected");
                        break;
                    }
                }
            }
        }

        if let Some(prompt_json) = engine.get_prompt(&session_id, 0)? {
            let prompt: AgentPrompt = serde_json::from_str(&prompt_json)
                .map_err(|err| format!("failed to parse java prompt: {err}"))?;
            if last_prompt.as_ref().map(|p| p.prompt_id) != Some(prompt.prompt_id) {
                if let Some(started) = decision_submitted.take() {
                    crate::metrics::record_forge_decision_stage("next_prompt", started.elapsed());
                }
                if let Some(started) = decision_received.take() {
                    crate::metrics::record_forge_decision_stage(
                        "decision_total",
                        started.elapsed(),
                    );
                }
                last_prompt = Some(prompt.clone());
                let player = player_index(&prompt.deciding_player_id);
                debug!(player, "forwarding java prompt to remote");
                if matches!(prompt.input, PromptInput::DiceRolled(_)) {
                    let snapshots_started = Instant::now();
                    let prompt_msg = AgentMessage::Prompt(prompt);
                    for &agent_index in remote_response_rxs.keys() {
                        let state = AgentMessage::State(state_via_handle(
                            &engine,
                            &session_id,
                            Some(agent_index),
                        )?);
                        let _ = remote_prompt_tx.send((agent_index, state));
                        let _ = remote_prompt_tx.send((agent_index, prompt_msg.clone()));
                    }
                    send_observer_state(&engine, &session_id, &remote_prompt_tx);
                    pending_roll_acks = remote_response_rxs.len();
                    if pending_roll_acks == 0 {
                        let ack = serde_json::to_string(&PromptOutput::DiceRolled(
                            DiceRolledOutput::DiceRolledAcknowledged,
                        ))
                        .map_err(|err| format!("failed to serialize roll ack: {err}"))?;
                        engine.submit_action(&session_id, &ack)?;
                    }
                    crate::metrics::record_forge_decision_stage(
                        "snapshots",
                        snapshots_started.elapsed(),
                    );
                } else if Some(player) == local_player_index {
                    if let Some(output) = auto_action(&prompt) {
                        let action_json = serde_json::to_string(&output)
                            .map_err(|err| format!("failed to serialize auto action: {err}"))?;
                        engine.submit_action(&session_id, &action_json)?;
                    }
                } else {
                    let snapshots_started = Instant::now();
                    for &agent_index in remote_response_rxs.keys() {
                        let state = AgentMessage::State(state_via_handle(
                            &engine,
                            &session_id,
                            Some(agent_index),
                        )?);
                        if remote_prompt_tx.send((agent_index, state)).is_err() {
                            return Ok(());
                        }
                    }
                    send_observer_state(&engine, &session_id, &remote_prompt_tx);
                    let prompt_msg = AgentMessage::Prompt(prompt);
                    if remote_prompt_tx.send((player, prompt_msg)).is_err() {
                        return Ok(());
                    }
                    crate::metrics::record_forge_decision_stage(
                        "snapshots",
                        snapshots_started.elapsed(),
                    );
                }
            }
        }

        if engine.is_game_over(&session_id)? {
            info!("hosted java-forge session reached game over");
            let mut final_messages = Vec::new();
            for &agent_index in remote_response_rxs.keys() {
                match state_via_handle(&engine, &session_id, Some(agent_index)) {
                    Ok(state_update) => {
                        final_messages.push((agent_index, AgentMessage::State(state_update)));
                    }
                    Err(error) => {
                        warn!(%error, agent_index, "game over: final snapshot unavailable; sending game-over prompt only");
                    }
                }
            }
            if let Ok(state_update) = state_via_handle(&engine, &session_id, None) {
                final_messages.push((
                    crate::host::OBSERVER_SEAT,
                    AgentMessage::State(state_update),
                ));
            }
            let game_over = AgentMessage::Prompt(game_over_prompt());
            for &agent_index in remote_response_rxs.keys() {
                final_messages.push((agent_index, game_over.clone()));
            }
            let _ = game_over_tx.send(HostedGameOver {
                game_id: game_id.clone(),
                messages: final_messages,
            });
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

#[cfg(forge_backend)]
fn send_observer_state(
    engine: &ForgeEngine,
    session_id: &str,
    remote_prompt_tx: &std_mpsc::Sender<(usize, AgentMessage)>,
) {
    match state_via_handle(engine, session_id, None) {
        Ok(state_update) => {
            let _ = remote_prompt_tx.send((
                crate::host::OBSERVER_SEAT,
                AgentMessage::State(state_update),
            ));
        }
        Err(error) => warn!(%error, "observer snapshot unavailable"),
    }
}

#[cfg(forge_backend)]
fn player_index(deciding_player_id: &str) -> usize {
    deciding_player_id
        .strip_prefix("player-")
        .and_then(|n| n.parse().ok())
        .unwrap_or(0)
}

#[cfg(forge_backend)]
fn reject_response(
    remote_prompt_tx: &std_mpsc::Sender<(usize, AgentMessage)>,
    seat: usize,
    reopen_prompt: Option<&AgentPrompt>,
    code: ProtocolErrorCode,
    message: String,
) {
    let _ = remote_prompt_tx.send((
        seat,
        AgentMessage::Error(ProtocolError {
            code,
            message,
            prompt_id: reopen_prompt.map(|p| p.prompt_id),
        }),
    ));
    if let Some(prompt) = reopen_prompt {
        let _ = remote_prompt_tx.send((seat, AgentMessage::Prompt(prompt.clone())));
    }
}

#[cfg(forge_backend)]
fn auto_action(prompt: &AgentPrompt) -> Option<PromptOutput> {
    match prompt.input {
        PromptInput::ChooseAction(_) => {
            Some(PromptOutput::ChooseAction(ChooseActionOutput::Pass {
                until: None,
                exhaust_stack: false,
            }))
        }
        _ => None,
    }
}

#[cfg(forge_backend)]
fn game_over_prompt() -> AgentPrompt {
    AgentPrompt {
        prompt_id: u32::MAX,
        deciding_player_id: "player-0".to_string(),
        source_card: None,
        input: PromptInput::GameOver(GameOverInput {}),
    }
}

#[cfg(forge_backend)]
fn state_via_handle(
    engine: &ForgeEngine,
    session_id: &str,
    viewer: Option<usize>,
) -> Result<StateUpdate, String> {
    let game_view: GameViewDto = serde_json::from_str(&engine.get_snapshot(session_id, viewer)?)
        .map_err(|err| format!("failed to parse java snapshot: {err}"))?;
    Ok(StateUpdate { game_view })
}

#[cfg(forge_backend)]
fn deck_card_identities(deck: &Deck) -> Vec<DeckCardIdentity> {
    deck.cards
        .iter()
        .chain(deck.commanders.iter().flatten())
        .map(|card| card.identity.clone())
        .collect()
}

#[cfg(forge_backend)]
fn commander_names_for_java(deck: &Deck, fallback: Option<&str>) -> Vec<String> {
    let names: Vec<String> = deck
        .commanders
        .iter()
        .flatten()
        .map(|card| java_card_name(&card.identity.name))
        .collect();
    if !names.is_empty() {
        return names;
    }
    fallback
        .filter(|name| !name.is_empty())
        .map(|name| vec![java_card_name(name)])
        .unwrap_or_default()
}

#[cfg(forge_backend)]
fn smoke_deck(land_name: &str, spell_name: &str) -> Vec<DeckCardIdentity> {
    (0..24)
        .map(|_| DeckCardIdentity {
            name: land_name.to_string(),
            ..Default::default()
        })
        .chain((0..36).map(|_| DeckCardIdentity {
            name: spell_name.to_string(),
            ..Default::default()
        }))
        .collect()
}

#[cfg(feature = "java-forge")]
fn scenario_deck(land_name: &str) -> Vec<DeckCardIdentity> {
    (0..60)
        .map(|_| DeckCardIdentity {
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

    fn next_action(
        &mut self,
        prompt: &Value,
        game_view: &GameViewDto,
    ) -> Result<Option<PromptOutput>, String> {
        match self {
            Self::KeepAndPlayLand { played_land } => {
                if *played_land && battlefield_contains(game_view, "Swamp") {
                    return Ok(None);
                }
                match prompt_type(prompt) {
                    Some("mulligan") => Ok(Some(PromptOutput::Mulligan(
                        MulliganOutput::MulliganDecision { keep: true },
                    ))),
                    Some("chooseAction") => {
                        if let Some(action) = play_first_card_action(prompt, "Swamp")? {
                            *played_land = true;
                            Ok(Some(action))
                        } else {
                            Ok(Some(PromptOutput::ChooseAction(ChooseActionOutput::Pass {
                                until: None,
                                exhaust_stack: false,
                            })))
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
                if *played_land && battlefield_contains(game_view, "Swamp") {
                    return Ok(None);
                }
                match prompt_type(prompt) {
                    Some("mulligan") if !*mulliganed => {
                        *mulliganed = true;
                        Ok(Some(PromptOutput::Mulligan(MulliganOutput::MulliganDecision { keep: false })))
                    }
                    Some("mulligan") if !*kept_second_hand => {
                        *kept_second_hand = true;
                        Ok(Some(PromptOutput::Mulligan(MulliganOutput::MulliganDecision { keep: true })))
                    }
                    Some("mulliganPutBack") if !*put_back_done => {
                        let count = prompt
                            .get("input")
                            .and_then(|input| input.get("count"))
                            .and_then(Value::as_u64)
                            .unwrap_or(1) as usize;
                        let card_ids = prompt_card_ids(prompt, "handCardIds", count)?;
                        *put_back_done = true;
                        Ok(Some(PromptOutput::MulliganPutBack(MulliganPutBackOutput::MulliganPutBackDecision { card_ids })))
                    }
                    Some("chooseAction") => {
                        if let Some(action) = play_first_card_action(prompt, "Swamp")? {
                            *played_land = true;
                            Ok(Some(action))
                        } else {
                            Ok(Some(PromptOutput::ChooseAction(ChooseActionOutput::Pass { until: None, exhaust_stack: false })))
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

        let prompt: AgentPrompt = serde_json::from_str(&prompt_json)
            .map_err(|err| format!("failed to parse java scenario prompt: {err}"))?;
        let player = player_index(&prompt.deciding_player_id);
        if player != 0 {
            if let Some(output) = auto_action(&prompt) {
                session.submit_action(
                    &serde_json::to_string(&output).map_err(|err| err.to_string())?,
                )?;
            }
            continue;
        }

        let game_view: GameViewDto = serde_json::from_str(&session.get_snapshot(Some(0))?)
            .map_err(|err| format!("failed to parse java scenario snapshot: {err}"))?;
        let normalized_prompt = serde_json::to_value(&prompt).map_err(|err| err.to_string())?;
        info!(
            scenario = scenario.name(),
            prompts_seen,
            prompt_type = prompt_type(&normalized_prompt).unwrap_or("<missing>"),
            "java-forge scenario prompt"
        );
        let Some(action) = scenario.next_action(&normalized_prompt, &game_view)? else {
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
pub fn run_concede_smoke() -> Result<(), String> {
    let config = JavaRuntimeConfig::from_env();
    let assets_dir = config.assets_dir.to_string_lossy().to_string();
    let bridge = SubprocessBridge::spawn(&config)?;
    let mut session = JavaForgeSession::new(bridge);
    session.initialize(&assets_dir)?;
    run_concede_game(&mut session, 3, 2, 12)?;
    run_concede_game(&mut session, 2, 1, 8)?;
    Ok(())
}

#[cfg(not(feature = "java-forge"))]
pub fn run_concede_smoke() -> Result<(), String> {
    Err(unsupported_message().to_string())
}

#[cfg(forge_backend)]
fn directive_concede_json(player: usize) -> String {
    format!(r#"{{"type":"directive","directive":{{"type":"concede"}},"player":{player}}}"#)
}

#[cfg(feature = "java-forge")]
fn run_concede_game<B: JavaBridge>(
    session: &mut JavaForgeSession<B>,
    seats: usize,
    conceder: usize,
    concede_after: usize,
) -> Result<(), String> {
    const POST_CONCEDE_DECISIONS: usize = 12;
    const STALL_REPEATS: usize = 300;

    let cards: Vec<manabrew_protocol::deck_dto::DeckCard> = (0..60)
        .map(|_| manabrew_protocol::deck_dto::DeckCard {
            identity: DeckCardIdentity {
                name: "Mountain".to_string(),
                set_code: "M20".to_string(),
                ..Default::default()
            },
            ..Default::default()
        })
        .collect();
    let deck = Deck {
        name: "concede-smoke".to_string(),
        cards,
        ..Default::default()
    };
    let identities = deck_card_identities(&deck);
    let players: Vec<PlayerConfig> = (0..seats)
        .map(|i| PlayerConfig::new(format!("Concede {}", i + 1), &identities, Vec::new()))
        .collect();
    let request = StartGameRequest::new(
        format!("concede-smoke-{seats}p"),
        String::new(),
        20,
        7,
        players,
    );
    let session_id = session.start_game(&request)?;
    info!(
        session_id,
        seats, conceder, concede_after, "concede smoke game started"
    );

    let mut bots: HashMap<usize, SimpleAi> = HashMap::new();
    let mut last_prompt_json: Option<String> = None;
    let mut acted = 0usize;
    let mut acted_after_concede = 0usize;
    let mut conceded = false;
    let mut repeat_count = 0usize;

    for _ in 0..40_000 {
        if session.is_game_over()? {
            if !conceded {
                return Err("concede smoke: game ended before the concede fired".to_string());
            }
            break;
        }
        let Some(prompt_json) = session.get_prompt(0)? else {
            std::thread::sleep(Duration::from_millis(10));
            continue;
        };
        if last_prompt_json.as_deref() == Some(prompt_json.as_str()) {
            repeat_count += 1;
            if repeat_count > STALL_REPEATS {
                return Err(format!(
                    "concede smoke stalled on the same prompt (seats={seats} acted={acted} conceded={conceded} after={acted_after_concede}): {prompt_json}"
                ));
            }
            std::thread::sleep(Duration::from_millis(10));
            continue;
        }
        repeat_count = 0;

        let prompt: AgentPrompt = serde_json::from_str(&prompt_json)
            .map_err(|err| format!("concede smoke: bad prompt: {err}"))?;
        let player = player_index(&prompt.deciding_player_id);

        if !conceded && acted >= concede_after {
            info!(conceder, acted, "concede smoke: injecting concede");
            session.submit_action(&directive_concede_json(conceder))?;
            conceded = true;
            last_prompt_json = None;
            continue;
        }
        if conceded && player == conceder {
            session.submit_action(&directive_concede_json(conceder))?;
            last_prompt_json = Some(prompt_json);
            continue;
        }

        if let Some(action) = bots.entry(player).or_default().decide(prompt) {
            submit_player_action(session, &action)?;
            acted += 1;
            if conceded {
                acted_after_concede += 1;
            }
        }
        last_prompt_json = Some(prompt_json);
        if conceded && seats > 2 && acted_after_concede >= POST_CONCEDE_DECISIONS {
            break;
        }
    }

    if !conceded {
        return Err("concede smoke: never reached the injection point".to_string());
    }
    if seats == 2 {
        if !session.is_game_over()? {
            return Err("concede smoke: 2p concession did not end the game".to_string());
        }
        info!(acted, "concede smoke: 2p concession ended the game");
    } else {
        if acted_after_concede < POST_CONCEDE_DECISIONS && !session.is_game_over()? {
            return Err(format!(
                "concede smoke: game did not progress after the concession (only {acted_after_concede} decisions)"
            ));
        }
        let snapshot = parse_snapshot(session)?;
        let status = snapshot
            .pointer(&format!("/players/{conceder}/status"))
            .and_then(Value::as_str)
            .unwrap_or("");
        if status != "conceded" {
            return Err(format!(
                "concede smoke: seat {conceder} has status '{status}', expected 'conceded'"
            ));
        }
        info!(
            acted,
            acted_after_concede, "concede smoke: game continued past the concession"
        );
    }
    session.end_game()?;
    Ok(())
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
                    dump_stuck(
                        "java re-emitted the same prompt after the bot acted (stall)",
                        &raw_value,
                        None,
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

            let prompt: AgentPrompt = serde_json::from_str(&prompt_json)
                .map_err(|err| format!("failed to parse java self-play prompt: {err}"))?;
            let player = player_index(&prompt.deciding_player_id);
            let raw_value: Value = serde_json::from_str(&prompt_json).unwrap_or(Value::Null);
            let normalized = raw_value.clone();

            match bots.entry(player).or_default().decide(prompt) {
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
    let snapshot_json = session.get_snapshot(Some(0))?;
    serde_json::from_str(&snapshot_json)
        .map_err(|err| format!("failed to parse java self-play snapshot: {err}"))
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
    action: &PromptOutput,
) -> Result<(), String> {
    let action_json = serde_json::to_string(action)
        .map_err(|err| format!("failed to serialize scenario action: {err}"))?;
    session.submit_action(&action_json)?;
    Ok(())
}

#[cfg(feature = "java-forge")]
fn prompt_type(prompt: &Value) -> Option<&str> {
    prompt
        .get("input")
        .and_then(|input| input.get("type"))
        .and_then(Value::as_str)
}

#[cfg(feature = "java-forge")]
fn play_first_card_action(prompt: &Value, card_name: &str) -> Result<Option<PromptOutput>, String> {
    let Some(action) = prompt
        .get("input")
        .and_then(|input| input.get("actions"))
        .and_then(Value::as_array)
        .and_then(|actions| {
            actions.iter().find(|action| {
                action
                    .get("modeLabel")
                    .and_then(Value::as_str)
                    .is_some_and(|label| label.contains(card_name))
            })
        })
    else {
        return Ok(None);
    };
    let action_id = action
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("playable action for '{card_name}' is missing id"))?;
    Ok(Some(PromptOutput::ChooseAction(ChooseActionOutput::Act {
        action_id: action_id.to_string(),
    })))
}

#[cfg(feature = "java-forge")]
fn prompt_card_ids(prompt: &Value, field: &str, count: usize) -> Result<Vec<String>, String> {
    let card_ids = prompt
        .get("input")
        .and_then(|input| input.get(field))
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
fn battlefield_contains(game_view: &GameViewDto, card_name: &str) -> bool {
    use manabrew_agent_interface::game_view_dto::{CardView, ZoneKind};
    game_view.zones.iter().any(|zone| {
        zone.zone == ZoneKind::Battlefield
            && zone.owner_id == "player-0"
            && zone.cards.iter().any(|card| match card {
                CardView::Visible(dto) => dto.identity.name == card_name,
                CardView::Hidden { .. } => false,
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
    fn get_snapshot(&mut self, session_id: &str, viewer: Option<usize>) -> Result<String, String>;
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

    pub fn get_snapshot(&mut self, viewer: Option<usize>) -> Result<String, String> {
        let session_id = self.require_session_id()?.to_string();
        self.bridge.get_snapshot(&session_id, viewer)
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

    fn get_snapshot(
        &mut self,
        _session_id: &str,
        _viewer: Option<usize>,
    ) -> Result<String, String> {
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
        let jvm_args = config.jvm_args();
        info!(target: "self_hosted_node::java", args = %jvm_args.join(" "), "spawning java engine");
        let mut cmd = Command::new(&java_bin);
        // The JVM applies JAVA_TOOL_OPTIONS before anything on the command line,
        // so whatever is set on the host silently governs every flag we do not
        // name. Production ran -Xmx512m -XX:+UseSerialGC that way for months
        // with nothing in the repo to show it. Use SELF_HOSTED_NODE_JAVA_OPTS
        // instead: it is passed here, logged above, and lives in config.
        cmd.env_remove("JAVA_TOOL_OPTIONS");
        cmd.args(&jvm_args);
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
                    if let Some(pause) = parse_gc_pause(&line) {
                        crate::metrics::record_jvm_gc(
                            pause.kind,
                            Duration::from_secs_f64(pause.millis / 1000.0),
                            pause.heap_after_mb,
                        );
                    }
                    if line.contains("Exception") || line.contains("ERROR") {
                        warn!(target: "self_hosted_node::java", "[java] {line}");
                    } else if line.contains("][gc") {
                        // -Xlog:gc*:stderr is opt-in, and debug would drop it before Loki.
                        info!(target: "self_hosted_node::java", "[java] {line}");
                    } else {
                        debug!(target: "self_hosted_node::java", "[java] {line}");
                    }
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

    fn get_snapshot(&mut self, session_id: &str, viewer: Option<usize>) -> Result<String, String> {
        let mut body = json!({ "command": "getSnapshot", "sessionId": session_id });
        if let Some(viewer) = viewer {
            body["viewer"] = json!(viewer);
        }
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
    variant: String,
    starting_life: i32,
    seed: u64,
    players: Vec<PlayerConfig>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerConfig {
    name: String,
    deck: Vec<CardIdentityForJava>,
    commander_names: Vec<String>,
    ai: bool,
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
    pub fn new(
        game_id: String,
        variant: String,
        starting_life: i32,
        seed: u64,
        players: Vec<PlayerConfig>,
    ) -> Self {
        Self {
            game_id,
            variant,
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
    pub fn new(name: String, deck: &[DeckCardIdentity], commander_names: Vec<String>) -> Self {
        Self {
            name,
            deck: deck.iter().map(CardIdentityForJava::from).collect(),
            commander_names,
            ai: false,
        }
    }
}

impl From<&DeckCardIdentity> for CardIdentityForJava {
    fn from(identity: &DeckCardIdentity) -> Self {
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

fn env_sizing(key: &str, default: u64) -> Option<u64> {
    let value = match env::var(key) {
        Ok(raw) if !raw.trim().is_empty() => match raw.trim().parse::<u64>() {
            Ok(parsed) => parsed,
            Err(_) => {
                tracing::warn!(target: "self_hosted_node::java", key, raw, "ignoring unparseable jvm sizing");
                default
            }
        },
        _ => default,
    };
    (value > 0).then_some(value)
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

/// One `Pause` line from the JVM's unified GC log.
struct GcPause {
    kind: &'static str,
    millis: f64,
    heap_after_mb: Option<u64>,
}

/// Parse a unified-log GC pause, e.g.
/// `[12.3s][info][gc] GC(7) Pause Full (Allocation Failure) 240M->171M(247M) 226.856ms`
fn parse_gc_pause(line: &str) -> Option<GcPause> {
    let kind = if line.contains("Pause Full") {
        "full"
    } else if line.contains("Pause Young") {
        "young"
    } else {
        return None;
    };
    let millis = line
        .rsplit(' ')
        .find_map(|token| token.strip_suffix("ms")?.parse::<f64>().ok())?;
    // "240M->171M(247M)": the figure after the arrow is what survived.
    let heap_after_mb = line.split_once("->").and_then(|(_, rest)| {
        let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
        digits.parse::<u64>().ok()
    });
    Some(GcPause {
        kind,
        millis,
        heap_after_mb,
    })
}

#[cfg(test)]
mod gc_log_tests {
    use super::parse_gc_pause;

    #[test]
    fn reads_a_full_collection() {
        let pause = parse_gc_pause(
            "[117.6s][info][gc] GC(21) Pause Full (Allocation Failure) 240M->171M(247M) 226.856ms",
        )
        .expect("parsed");
        assert_eq!(pause.kind, "full");
        assert_eq!(pause.heap_after_mb, Some(171));
        assert!((pause.millis - 226.856).abs() < f64::EPSILON);
    }

    #[test]
    fn reads_a_young_collection() {
        let pause = parse_gc_pause(
            "[3.1s][info][gc] GC(2) Pause Young (Allocation Failure) 216M->91M(494M) 17.254ms",
        )
        .expect("parsed");
        assert_eq!(pause.kind, "young");
        assert_eq!(pause.heap_after_mb, Some(91));
    }

    /// The node asks for `-Xlog:gc*:stderr:time,uptime,level,tags`, which is a
    /// richer line than plain `-Xlog:gc`. Real production output.
    #[test]
    fn reads_the_format_the_node_actually_requests() {
        let pause = parse_gc_pause(
            "[2026-08-18T20:41:42.907+0000][120025.819s][info][gc] GC(1202) Pause Full (Allocation Failure) 494M->487M(494M) 545.344ms",
        )
        .expect("parsed");
        assert_eq!(pause.kind, "full");
        assert_eq!(pause.heap_after_mb, Some(487));
        assert!((pause.millis - 545.344).abs() < f64::EPSILON);
    }

    /// `gc*` also emits region and metaspace lines that carry `->`; they must
    /// not be mistaken for pauses.
    #[test]
    fn ignores_the_extra_lines_gc_star_adds() {
        assert!(
            parse_gc_pause("[120025.819s][info][gc,heap] GC(1202) Eden regions: 10->0(12)")
                .is_none()
        );
        assert!(
            parse_gc_pause("[120025.819s][info][gc,metaspace] Metaspace: 48M->48M(1088M)")
                .is_none()
        );
    }

    #[test]
    fn ignores_other_output() {
        assert!(parse_gc_pause("[java] LOGGER ERROR: something").is_none());
        assert!(parse_gc_pause("[1.0s][info][gc,init] CardTable entry size: 512").is_none());
    }
}
