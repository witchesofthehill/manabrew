#![allow(dead_code)]

#[cfg(feature = "java-forge")]
use std::collections::HashMap;
use std::env;
use std::path::{Path, PathBuf};
use std::sync::mpsc as std_mpsc;
#[cfg(feature = "java-forge")]
use std::sync::mpsc::TryRecvError;
#[cfg(feature = "java-forge")]
use std::time::Duration;

use forge_agent_interface::deck_dto::{CardIdentity, Deck};
#[cfg(feature = "java-forge")]
use forge_agent_interface::java_prompt_normalizer::{
    normalize_java_prompt, translate_java_action_value,
};
#[cfg(feature = "java-forge")]
use forge_agent_interface::prompt::PlayerAction;
#[cfg(feature = "java-forge")]
use j4rs::{Instance, InvocationArg, JavaOpt, Jvm, JvmBuilder};
use serde::Serialize;
#[cfg(feature = "java-forge")]
use serde_json::json;
use serde_json::Value;
use tracing::warn;
#[cfg(feature = "java-forge")]
use tracing::{debug, info};

use crate::config::workspace_root;

pub fn unsupported_message() -> &'static str {
    "hosted java-forge backend is recognized, but hosted GameAPI dispatch is not wired to the j4rs Forge session yet"
}

#[cfg(feature = "java-forge")]
pub fn run_smoke_game(max_prompts: usize) -> Result<(), String> {
    let config = JavaRuntimeConfig::from_env();
    let assets_dir = config.assets_dir.to_string_lossy().to_string();
    let bridge = J4rsBridge::new(&config)?;
    let mut session = JavaForgeSession::new(bridge);
    session.initialize(&assets_dir)?;

    let deck_a = smoke_deck("Mountain", "Lightning Bolt");
    let deck_b = smoke_deck("Forest", "Grizzly Bears");
    let request = StartGameRequest::new(
        "self-hosted-java-smoke".to_string(),
        20,
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
    let bridge = J4rsBridge::new(&config)?;
    let mut session = JavaForgeSession::new(bridge);
    session.initialize(&assets_dir)?;

    let request = StartGameRequest::new(
        format!("self-hosted-java-scenario-{}", scenario.name()),
        20,
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
                    root.join("forge/forge-harness/target/forge-harness-jar-with-dependencies.jar")
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
    remote_prompt_tx: std_mpsc::Sender<(usize, Value)>,
    remote_response_rxs: Vec<(usize, std_mpsc::Receiver<Value>)>,
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
    _remote_prompt_tx: std_mpsc::Sender<(usize, Value)>,
    _remote_response_rxs: Vec<(usize, std_mpsc::Receiver<Value>)>,
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
    remote_prompt_tx: std_mpsc::Sender<(usize, Value)>,
    remote_response_rxs: Vec<(usize, std_mpsc::Receiver<Value>)>,
) -> Result<(), String> {
    let config = JavaRuntimeConfig::from_env();
    let assets_dir = config.assets_dir.to_string_lossy().to_string();
    let bridge = J4rsBridge::new(&config)?;
    let mut session = JavaForgeSession::new(bridge);
    session.initialize(&assets_dir)?;

    let mut players = Vec::with_capacity(player_names.len());
    for (index, name) in player_names.iter().enumerate() {
        let identities = deck_card_identities(&decks[index]);
        players.push(PlayerConfig::new(
            name.clone(),
            &identities,
            commander_names[index].clone(),
        ));
    }
    let request = StartGameRequest::new(game_id.clone(), starting_life, players);
    let session_id = session.start_game(&request)?;
    info!(game_id, session_id, "hosted java-forge session started");

    let mut remote_response_rxs: HashMap<usize, std_mpsc::Receiver<Value>> =
        remote_response_rxs.into_iter().collect();
    let mut last_prompt_json: Option<String> = None;

    loop {
        for (player_index, rx) in &mut remote_response_rxs {
            loop {
                match rx.try_recv() {
                    Ok(action) => {
                        let action_json = serde_json::to_string(&action).map_err(|err| {
                            format!(
                                "failed to serialize java action for player {player_index}: {err}"
                            )
                        })?;
                        debug!(player_index, %action_json, "submitting remote response to java");
                        session.submit_action(&action_json)?;
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => {
                        debug!(player_index, "java-forge response channel disconnected");
                        break;
                    }
                }
            }
        }

        if let Some(prompt_json) = session.get_prompt(0)? {
            if last_prompt_json.as_deref() != Some(prompt_json.as_str()) {
                let prompt: Value = serde_json::from_str(&prompt_json)
                    .map_err(|err| format!("failed to parse java prompt: {err}"))?;
                if let Some(player_index) = prompt
                    .get("player")
                    .and_then(Value::as_u64)
                    .map(|value| value as usize)
                {
                    let prompt_kind = prompt
                        .get("kind")
                        .and_then(Value::as_str)
                        .unwrap_or("?")
                        .to_string();
                    debug!(
                        player_index,
                        prompt_kind, "forwarding java prompt to remote"
                    );
                    if Some(player_index) == local_player_index {
                        session.submit_action(&auto_java_action(&prompt).to_string())?;
                    } else if remote_prompt_tx
                        .send((player_index, normalize_java_prompt(prompt)))
                        .is_err()
                    {
                        session.end_game()?;
                        return Ok(());
                    }
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
            info!("hosted java-forge session reached game over");
            session.end_game()?;
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
fn auto_java_action(prompt: &Value) -> Value {
    prompt
        .get("actions")
        .and_then(Value::as_array)
        .and_then(|actions| {
            actions
                .iter()
                .find_map(|action| action.get("index").and_then(Value::as_u64))
        })
        .map(|index| json!({ "kind": "choose_action", "index": index }))
        .unwrap_or_else(|| json!({ "kind": "pass" }))
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

        let prompt: Value = serde_json::from_str(&prompt_json)
            .map_err(|err| format!("failed to parse java scenario prompt: {err}"))?;
        let player = prompt
            .get("player")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        if player != 0 {
            session.submit_action(&auto_java_action(&prompt).to_string())?;
            continue;
        }

        let normalized_prompt = normalize_java_prompt(prompt);
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
fn submit_player_action<B: JavaBridge>(
    session: &mut JavaForgeSession<B>,
    action: &PlayerAction,
) -> Result<(), String> {
    let action_value = serde_json::to_value(action)
        .map_err(|err| format!("failed to serialize scenario player action: {err}"))?;
    let java_action = translate_java_action_value(&action_value);
    session.submit_action(&java_action.to_string())?;
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

    fn end_game(&mut self, _session_id: &str) -> Result<(), String> {
        Err(unsupported_message().to_string())
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
                "forge.harness.ManaBrewEngineAdapter",
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
