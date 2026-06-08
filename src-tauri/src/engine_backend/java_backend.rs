#![allow(dead_code)]

use std::env;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
#[cfg(feature = "java-forge")]
use std::sync::mpsc::TryRecvError;
#[cfg(feature = "java-forge")]
use std::time::Duration;

#[cfg(feature = "java-forge")]
use j4rs::{Instance, InvocationArg, JavaOpt, Jvm, JvmBuilder};
use serde::Serialize;
#[cfg(feature = "java-forge")]
use serde_json::Value;

use crate::preset_decks::CardIdentity;
#[cfg(feature = "java-forge")]
use forge_agent_interface::java_prompt_normalizer::{
    make_java_game_over_prompt, make_java_state_update, normalize_java_prompt,
    translate_java_player_action,
};
#[cfg(feature = "java-forge")]
use forge_agent_interface::java_raw::{
    JavaAction, JavaRawPrompt, JavaRawPromptBody, JavaRawSnapshot,
};
use forge_agent_interface::prompt::{AgentMessage, PlayerAction};

pub fn unsupported_error() -> String {
    "Engine backend 'java-forge' requires building Tauri with --features java-forge".to_string()
}

#[cfg(feature = "java-forge")]
pub fn run_game(
    game_id: String,
    deck_list: Vec<CardIdentity>,
    starting_life: i32,
    commander_name: Option<String>,
    opponent_deck_list: Option<Vec<CardIdentity>>,
    prompt_tx: mpsc::Sender<AgentMessage>,
    response_rx: mpsc::Receiver<PlayerAction>,
) {
    if let Err(error) = run_game_inner(
        game_id,
        deck_list,
        starting_life,
        commander_name,
        opponent_deck_list,
        prompt_tx,
        response_rx,
    ) {
        eprintln!("[java_game_thread] Java Forge game exited with error: {error}");
    }
}

#[cfg(not(feature = "java-forge"))]
pub fn run_game(
    _game_id: String,
    _deck_list: Vec<CardIdentity>,
    _starting_life: i32,
    _commander_name: Option<String>,
    _opponent_deck_list: Option<Vec<CardIdentity>>,
    _prompt_tx: mpsc::Sender<AgentMessage>,
    _response_rx: mpsc::Receiver<PlayerAction>,
) {
    eprintln!("[java_game_thread] {}", unsupported_error());
}

#[cfg(feature = "java-forge")]
fn run_game_inner(
    game_id: String,
    deck_list: Vec<CardIdentity>,
    starting_life: i32,
    commander_name: Option<String>,
    opponent_deck_list: Option<Vec<CardIdentity>>,
    prompt_tx: mpsc::Sender<AgentMessage>,
    response_rx: mpsc::Receiver<PlayerAction>,
) -> Result<(), String> {
    let config = JavaRuntimeConfig::from_env();
    let assets_dir = config.assets_dir.to_string_lossy().to_string();
    let bridge = J4rsBridge::new(&config)?;
    let mut session = JavaForgeSession::new(bridge);
    session.initialize(&assets_dir)?;

    // The UI is responsible for picking the opponent deck explicitly. There
    // is no auto-inference or random AI fallback.
    let opponent_deck = opponent_deck_list
        .filter(|d| !d.is_empty())
        .ok_or_else(|| "start_game called without an opponent deck".to_string())?;
    let mut players = Vec::with_capacity(2);
    players.push(PlayerConfig::new(
        "You".to_string(),
        &deck_list,
        commander_name,
    ));
    players.push(PlayerConfig::new(
        "AI Opponent".to_string(),
        &opponent_deck,
        None,
    ));

    let request = StartGameRequest::new(game_id.clone(), starting_life, players);
    let session_id = session.start_game(&request)?;
    eprintln!("[java_game_thread] Java Forge session started: {session_id}");

    let mut last_prompt_json: Option<String> = None;
    loop {
        loop {
            match response_rx.try_recv() {
                Ok(action) => match translate_java_player_action(&action) {
                    Ok(java_action) => submit_java_action(&mut session, &java_action)?,
                    Err(error) => {
                        eprintln!("[java_game_thread] dropping untranslatable action: {error}");
                    }
                },
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    session.end_game()?;
                    return Ok(());
                }
            }
        }

        if let Some(prompt_json) = session.get_prompt(0)? {
            if last_prompt_json.as_deref() != Some(prompt_json.as_str()) {
                let raw: JavaRawPrompt = serde_json::from_str(&prompt_json)
                    .map_err(|err| format!("failed to parse java prompt: {err}"))?;
                let player_index = raw.player;
                let is_first_player_roll =
                    matches!(raw.body, JavaRawPromptBody::FirstPlayerRoll { .. });
                let state = AgentMessage::State(make_java_state_update(
                    &raw.snapshot,
                    raw.session_id.as_deref(),
                    raw.player,
                ));
                let _ = prompt_tx.send(state);
                if player_index == 0 || is_first_player_roll {
                    if prompt_tx
                        .send(AgentMessage::Prompt(normalize_java_prompt(raw)))
                        .is_err()
                    {
                        session.end_game()?;
                        return Ok(());
                    }
                } else {
                    let auto = auto_java_action(&raw);
                    let _ = prompt_tx.send(AgentMessage::Prompt(normalize_java_prompt(raw)));
                    submit_java_action(&mut session, &auto)?;
                }
                last_prompt_json = Some(prompt_json);
            }
        }

        let snapshot_json = session.get_snapshot()?;
        let snapshot: Value = serde_json::from_str(&snapshot_json)
            .map_err(|err| format!("failed to parse java snapshot: {err}"))?;
        if snapshot
            .get("game_over")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            eprintln!("[java_game_thread] Java Forge session reached game over");
            let raw_snapshot: JavaRawSnapshot = serde_json::from_str(&snapshot_json)
                .map_err(|err| format!("failed to parse java snapshot for game-over: {err}"))?;
            let state =
                AgentMessage::State(make_java_state_update(&raw_snapshot, Some(&session_id), 0));
            let _ = prompt_tx.send(state);
            let _ = prompt_tx.send(AgentMessage::Prompt(make_java_game_over_prompt()));
            session.end_game()?;
            return Ok(());
        }

        std::thread::sleep(Duration::from_millis(50));
    }
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
fn submit_java_action<B: JavaBridge>(
    session: &mut JavaForgeSession<B>,
    action: &JavaAction,
) -> Result<(), String> {
    let action_json = serde_json::to_string(action)
        .map_err(|err| format!("failed to serialize java action: {err}"))?;
    session.submit_action(&action_json)?;
    Ok(())
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
        let root = project_root();
        Self {
            assets_dir: env_path("MANA_BREW_FORGE_ASSETS_DIR")
                .unwrap_or_else(|| root.join("forge/forge-gui")),
            harness_jar: env_path("MANA_BREW_FORGE_HARNESS_JAR").unwrap_or_else(|| {
                root.join("forge-harness/target/forge-harness-jar-with-dependencies.jar")
            }),
            java_home: env_path("MANA_BREW_JAVA_HOME").or_else(|| env_path("JAVA_HOME")),
            extra_classpath: env_classpath("MANA_BREW_FORGE_EXTRA_CLASSPATH"),
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
    fn end_game(&mut self, session_id: &str) -> Result<(), String>;
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
        Err(unsupported_error())
    }

    fn start_game_json(&mut self, _request_json: &str) -> Result<String, String> {
        Err(unsupported_error())
    }

    fn submit_action(&mut self, _session_id: &str, _action_json: &str) -> Result<String, String> {
        Err(unsupported_error())
    }

    fn get_prompt(
        &mut self,
        _session_id: &str,
        _player_index: usize,
    ) -> Result<Option<String>, String> {
        Err(unsupported_error())
    }

    fn get_snapshot(&mut self, _session_id: &str) -> Result<String, String> {
        Err(unsupported_error())
    }

    fn end_game(&mut self, _session_id: &str) -> Result<(), String> {
        Err(unsupported_error())
    }
}

#[cfg(feature = "java-forge")]
pub struct J4rsBridge {
    jvm: Jvm,
    adapter: Instance,
}

#[cfg(feature = "java-forge")]
impl J4rsBridge {
    pub fn new(config: &JavaRuntimeConfig) -> Result<Self, String> {
        config.validate()?;
        if let Some(java_home) = &config.java_home {
            env::set_var("JAVA_HOME", java_home);
        }
        let classpath = explicit_classpath(config)?;
        let classpath_opt = format!("-Djava.class.path={classpath}");

        let jvm = JvmBuilder::new()
            .with_no_implicit_classpath()
            .with_default_classloader()
            .java_opt(JavaOpt::new(&classpath_opt))
            .java_opt(JavaOpt::new("-Djava.awt.headless=true"))
            .build()
            .map_err(java_error)?;
        let adapter = jvm
            .create_instance(
                "forge.harness.host.ManaBrewEngineAdapter",
                InvocationArg::empty(),
            )
            .map_err(java_error)?;
        Ok(Self { jvm, adapter })
    }

    fn invoke_string(&self, method: &str, args: &[InvocationArg]) -> Result<String, String> {
        let response = self
            .jvm
            .invoke(&self.adapter, method, args)
            .map_err(java_error)?;
        self.jvm.to_rust(response).map_err(java_error)
    }

    fn invoke_void(&self, method: &str, args: &[InvocationArg]) -> Result<(), String> {
        self.jvm
            .invoke(&self.adapter, method, args)
            .map(|_| ())
            .map_err(java_error)
    }
}

#[cfg(feature = "java-forge")]
impl JavaBridge for J4rsBridge {
    fn initialize(&mut self, assets_dir: &str) -> Result<(), String> {
        self.invoke_void(
            "initialize",
            &[InvocationArg::try_from(assets_dir.to_string()).map_err(java_error)?],
        )
    }

    fn start_game_json(&mut self, request_json: &str) -> Result<String, String> {
        self.invoke_string(
            "startGameJson",
            &[InvocationArg::try_from(request_json.to_string()).map_err(java_error)?],
        )
    }

    fn submit_action(&mut self, session_id: &str, action_json: &str) -> Result<String, String> {
        self.invoke_string(
            "submitAction",
            &[
                InvocationArg::try_from(session_id.to_string()).map_err(java_error)?,
                InvocationArg::try_from(action_json.to_string()).map_err(java_error)?,
            ],
        )
    }

    fn get_prompt(
        &mut self,
        session_id: &str,
        player_index: usize,
    ) -> Result<Option<String>, String> {
        let prompt = self.invoke_string(
            "getPrompt",
            &[
                InvocationArg::try_from(session_id.to_string()).map_err(java_error)?,
                InvocationArg::try_from(player_index as i32)
                    .map_err(java_error)?
                    .into_primitive()
                    .map_err(java_error)?,
            ],
        )?;
        Ok((!prompt.is_empty()).then_some(prompt))
    }

    fn get_snapshot(&mut self, session_id: &str) -> Result<String, String> {
        self.invoke_string(
            "getSnapshot",
            &[InvocationArg::try_from(session_id.to_string()).map_err(java_error)?],
        )
    }

    fn end_game(&mut self, session_id: &str) -> Result<(), String> {
        self.invoke_void(
            "endGameJson",
            &[InvocationArg::try_from(session_id.to_string()).map_err(java_error)?],
        )
    }
}

#[cfg(feature = "java-forge")]
fn java_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(feature = "java-forge")]
fn explicit_classpath(config: &JavaRuntimeConfig) -> Result<String, String> {
    let mut entries = config.classpath_entries();
    entries.push(j4rs_runtime_jar()?);
    Ok(entries
        .iter()
        .map(|entry| entry.to_string_lossy())
        .collect::<Vec<_>>()
        .join(classpath_separator()))
}

#[cfg(feature = "java-forge")]
fn j4rs_runtime_jar() -> Result<PathBuf, String> {
    let exe = env::current_exe().map_err(java_error)?;
    let Some(exe_dir) = exe.parent() else {
        return Err(format!(
            "cannot resolve executable directory: {}",
            exe.display()
        ));
    };
    let jar = exe_dir
        .join("jassets")
        .join("j4rs-0.25.1-jar-with-dependencies.jar");
    if jar.is_file() {
        Ok(jar)
    } else {
        Err(format!(
            "j4rs runtime jar does not exist: {}",
            jar.display()
        ))
    }
}

#[cfg(feature = "java-forge")]
fn classpath_separator() -> &'static str {
    if cfg!(windows) {
        ";"
    } else {
        ":"
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartGameRequest {
    game_id: String,
    starting_life: i32,
    players: Vec<PlayerConfig>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerConfig {
    name: String,
    deck: Vec<CardIdentityForJava>,
    commander_name: Option<String>,
}

#[derive(Debug, Serialize)]
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
    pub fn new(game_id: String, starting_life: i32, players: Vec<PlayerConfig>) -> Self {
        Self {
            game_id,
            starting_life,
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

fn project_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf()
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
