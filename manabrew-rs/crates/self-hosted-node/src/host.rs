#![allow(clippy::too_many_arguments)]
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc as std_mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::config::{Config, DeckSelection, SelfPlayConfig};
use crate::engine_backend::{java_backend, rust_backend, EngineBackendKind, HostedGameOver};
use crate::updater::{run_stale_monitor, StaleConfig};
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use manabot::{run_bot, AgentKind, BotConfig};
use manabrew_agent_interface::ids_codec::{parse_player_slot, player_slot};
use manabrew_agent_interface::prompt::{AgentMessage, ClientToServerMessage, PromptOutput};
use manabrew_agent_interface::protocol::{
    identity_token, ClientMessage, ClientPlatform, EngineKind, GameFormat, IdentityProof,
    PlayerDeckInfo, ResumeRoomRequest, RoomInfo, RoomStatus, ServerMessage, StateEnvelope,
    PROTOCOL_VERSION,
};
use manabrew_protocol::deck_dto::Deck;
use manabrew_protocol::transport::DirectiveInput;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio::sync::mpsc as tokio_mpsc;
use tokio::task::JoinHandle;
use tokio::time;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async_with_config, MaybeTlsStream, WebSocketStream};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;
type WsWrite = SplitSink<WsStream, Message>;
type WsRead = SplitStream<WsStream>;

const SELF_HOSTED_NODE_PROTOCOL: &str = "self-hosted-node";
const PRIVATE_MESSAGE_MISSING_PLAYER: &str =
    "cannot forward private engine message without a mapped player";

struct RelayClient {
    username: String,
    outbound: tokio_mpsc::UnboundedSender<Message>,
    read: WsRead,
    writer: JoinHandle<()>,
}

enum EngineSession {
    Manabrew {
        game_id: String,
        remote_response_txs: HashMap<usize, std_mpsc::Sender<ClientToServerMessage>>,
    },
    Forge {
        game_id: String,
        remote_response_txs: HashMap<usize, std_mpsc::Sender<ClientToServerMessage>>,
        cancel: Arc<AtomicBool>,
    },
}

impl EngineSession {
    fn game_id(&self) -> &str {
        match self {
            EngineSession::Manabrew { game_id, .. } | EngineSession::Forge { game_id, .. } => {
                game_id
            }
        }
    }
}

struct BotState {
    handle: JoinHandle<()>,
    shutdown: Arc<tokio::sync::Notify>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpawnBotPayload {
    #[serde(default)]
    deck: Option<SpawnBotDeckPayload>,
    #[serde(default)]
    decks: Option<Vec<SpawnBotDeckPayload>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpawnBotDeckPayload {
    deck_name: String,
    deck: Deck,
    #[serde(default)]
    commander_name: Option<String>,
}

type SharedEngineSession = Arc<Mutex<Option<EngineSession>>>;
type SessionRegistry = Arc<Mutex<Vec<SharedEngineSession>>>;

fn registry_idle(registry: &SessionRegistry) -> bool {
    registry
        .lock()
        .map(|sessions| {
            sessions
                .iter()
                .all(|session| session.lock().map(|guard| guard.is_none()).unwrap_or(false))
        })
        .unwrap_or(false)
}

static DRAINING: AtomicBool = AtomicBool::new(false);

fn draining() -> bool {
    DRAINING.load(Ordering::Relaxed)
}

type SharedBotState = Arc<Mutex<Vec<BotState>>>;

#[derive(Clone)]
struct GameStart {
    game_id: String,
    player_order: Vec<String>,
    player_decks: Vec<PlayerDeckInfo>,
    starting_life: i32,
}

#[derive(Default)]
struct HostSnapshot {
    room_info: Option<RoomInfo>,
    resume_token: Option<String>,
    game: Option<GameStart>,
    last_state: Option<Value>,
    last_state_by_slot: HashMap<String, Value>,
    pending_prompts: HashMap<String, Value>,
    pending_end_game: Option<String>,
}

type SharedHostSnapshot = Arc<Mutex<HostSnapshot>>;

const RECONNECT_BACKOFF_SECS: [u64; 6] = [1, 2, 4, 8, 15, 30];

/// Pseudo-seat used by per-recipient backends for the public (spectator) view.
pub(crate) const OBSERVER_SEAT: usize = usize::MAX;
const CLOSE_DRAIN_TIMEOUT: Duration = Duration::from_secs(3);
const BOT_STOP_TIMEOUT: Duration = Duration::from_secs(5);

enum LoopExit {
    Cancelled,
    Disconnected,
}

pub async fn cli_entry() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "self_hosted_node=info".into()),
        )
        .init();
    crate::metrics::init_from_env();

    if std::env::var("SELF_HOSTED_NODE_JAVA_SMOKE").is_ok() {
        let max_prompts = std::env::var("SELF_HOSTED_NODE_JAVA_SMOKE_PROMPTS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(4);
        if let Err(error) = java_backend::run_smoke_game(max_prompts) {
            error!(%error, "java-forge smoke failed");
            std::process::exit(1);
        }
        info!(max_prompts, "java-forge smoke completed");
        return;
    }
    if std::env::var("SELF_HOSTED_NODE_GRAAL_SMOKE").is_ok() {
        if let Err(error) = java_backend::run_graal_smoke() {
            error!(%error, "graal-forge smoke failed");
            std::process::exit(1);
        }
        info!("graal-forge smoke completed");
        return;
    }
    if std::env::var("SELF_HOSTED_NODE_JAVA_CONCEDE_SMOKE").is_ok() {
        if let Err(error) = java_backend::run_concede_smoke() {
            error!(%error, "java-forge concede smoke failed");
            std::process::exit(1);
        }
        info!("java-forge concede smoke completed");
        return;
    }
    if let Ok(scenario_name) = std::env::var("SELF_HOSTED_NODE_JAVA_SCENARIO") {
        let max_prompts = std::env::var("SELF_HOSTED_NODE_JAVA_SCENARIO_PROMPTS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(20);
        if let Err(error) = java_backend::run_scenario(&scenario_name, max_prompts) {
            error!(scenario_name, %error, "java-forge scenario failed");
            std::process::exit(1);
        }
        info!(scenario_name, max_prompts, "java-forge scenario completed");
        return;
    }
    if std::env::var("SELF_HOSTED_NODE_JAVA_SELF_PLAY").is_ok() {
        let cfg = SelfPlayConfig::from_env();
        let max_prompts = std::env::var("SELF_HOSTED_NODE_JAVA_SELF_PLAY_PROMPTS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(2_000);
        let games = std::env::var("SELF_HOSTED_NODE_JAVA_SELF_PLAY_GAMES")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(1);
        if let Err(error) =
            java_backend::run_self_play(&cfg.seats, cfg.starting_life, cfg.seed, max_prompts, games)
        {
            error!(%error, "java-forge self-play failed");
            std::process::exit(1);
        }
        info!(
            players = cfg.seats.len(),
            max_prompts, games, "java-forge self-play completed"
        );
        return;
    }
    if let Ok(value) = std::env::var("SELF_HOSTED_NODE_JAVA_CONCURRENT_GAMES") {
        let cfg = SelfPlayConfig::from_env();
        let max_prompts = std::env::var("SELF_HOSTED_NODE_JAVA_SELF_PLAY_PROMPTS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(2_000);
        let concurrency = value.parse().unwrap_or(2);
        if let Err(error) = java_backend::run_concurrent_self_play(
            &cfg.seats,
            cfg.starting_life,
            cfg.seed,
            max_prompts,
            concurrency,
        ) {
            error!(%error, "java-forge concurrent self-play failed");
            std::process::exit(1);
        }
        info!(
            players = cfg.seats.len(),
            concurrency, "java-forge concurrent self-play completed"
        );
        return;
    }
    if std::env::var("SELF_HOSTED_NODE_RUST_SELF_PLAY").is_ok() {
        let cfg = SelfPlayConfig::from_env();
        let max_turns = std::env::var("SELF_HOSTED_NODE_RUST_SELF_PLAY_TURNS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(200);
        if let Err(error) =
            rust_backend::run_self_play(&cfg.seats, cfg.starting_life, cfg.seed, max_turns)
        {
            error!(%error, "rust self-play failed");
            std::process::exit(1);
        }
        info!(
            players = cfg.seats.len(),
            max_turns, "rust self-play completed"
        );
        return;
    }

    let config = Config::from_env();
    if let Err(error) = run(config).await {
        error!(%error, "room node exited");
        std::process::exit(1);
    }
}

/// Signal a hosted room to shut down: call `notify_one()` to stop it.
pub type RoomCancel = Arc<tokio::sync::Notify>;

fn ensure_engine_ready(config: &Config) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if config.engine_enabled
        && config.backend.is_supported()
        && matches!(config.backend, EngineBackendKind::Forge)
    {
        info!("initializing forge engine backend");
        java_backend::init_engine()?;
    }
    Ok(())
}

/// Host a single relay room until it ends or `cancel` is signalled. The crate's
/// public entry point — env-free; the caller supplies a fully-built `Config`.
pub async fn host_room(
    config: Config,
    cancel: RoomCancel,
    ready: tokio::sync::oneshot::Sender<String>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    ensure_engine_ready(&config)?;
    host_one_room(config, None, cancel, Some(ready), None).await
}

async fn run(mut config: Config) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    ensure_engine_ready(&config)?;

    let registry: SessionRegistry = Arc::new(Mutex::new(Vec::new()));

    let slots = config.max_games.max(1);
    let single = config.room_id.is_some() || slots <= 1;
    let room_count = if single { 1 } else { slots };
    let cancels: Vec<RoomCancel> = (0..room_count)
        .map(|_| Arc::new(tokio::sync::Notify::new()))
        .collect();

    let monitor_registry = registry.clone();
    let stale_cancels = cancels.clone();
    tokio::spawn(run_stale_monitor(
        StaleConfig::from_env_and_args(),
        move || registry_idle(&monitor_registry),
        move || notify_all(&stale_cancels),
    ));

    let signal_cancels = cancels.clone();
    tokio::spawn(async move {
        wait_for_shutdown_signal().await;
        info!("shutdown signal received; closing rooms");
        notify_all(&signal_cancels);
    });

    #[cfg(unix)]
    tokio::spawn(async move {
        let mut usr1 =
            match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::user_defined1()) {
                Ok(usr1) => usr1,
                Err(error) => {
                    warn!(%error, "failed to install SIGUSR1 handler");
                    return;
                }
            };
        while usr1.recv().await.is_some() {
            DRAINING.store(true, Ordering::Relaxed);
            info!("drain signal received; refusing new games and closing each room once idle");
        }
    });

    #[cfg(all(unix, feature = "graal-forge"))]
    tokio::spawn(async move {
        let mut usr2 =
            match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::user_defined2()) {
                Ok(usr2) => usr2,
                Err(error) => {
                    warn!(%error, "failed to install SIGUSR2 handler");
                    return;
                }
            };
        while usr2.recv().await.is_some() {
            let dir = std::env::var("SELF_HOSTED_NODE_HEAP_DUMP_DIR")
                .unwrap_or_else(|_| "/tmp".to_string());
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|since| since.as_secs())
                .unwrap_or(0);
            let path = format!("{dir}/self-hosted-node-{stamp}.hprof");
            info!(path, "heap dump requested");
            match tokio::task::spawn_blocking({
                let path = path.clone();
                move || java_backend::dump_shared_heap(&path)
            })
            .await
            {
                Ok(Ok(())) => info!(path, "heap dump written"),
                Ok(Err(error)) => warn!(%error, "heap dump failed"),
                Err(error) => warn!(%error, "heap dump task failed"),
            }
        }
    });

    if single {
        return host_one_room(config, None, cancels[0].clone(), None, Some(registry)).await;
    }

    config.format = GameFormat::Any;
    let hosts: Vec<(Config, String)> = (0..slots)
        .map(|slot| (config.clone(), (slot + 1).to_string()))
        .collect();

    info!(rooms = hosts.len(), "hosting multiple rooms on one node");
    let mut handles = Vec::with_capacity(hosts.len());
    for ((cfg, label), cancel) in hosts.into_iter().zip(cancels) {
        let registry = registry.clone();
        handles.push(tokio::spawn(async move {
            if let Err(error) =
                host_one_room(cfg, Some(label.clone()), cancel, None, Some(registry)).await
            {
                error!(%error, label, "room host exited");
            }
        }));
    }
    for handle in handles {
        let _ = handle.await;
    }
    Ok(())
}

fn notify_all(cancels: &[RoomCancel]) {
    for cancel in cancels {
        cancel.notify_one();
    }
}

async fn wait_for_shutdown_signal() {
    #[cfg(unix)]
    {
        let mut term =
            match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
                Ok(term) => term,
                Err(error) => {
                    warn!(%error, "failed to install SIGTERM handler");
                    let _ = tokio::signal::ctrl_c().await;
                    return;
                }
            };
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = term.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

async fn host_one_room(
    mut config: Config,
    label: Option<String>,
    cancel: RoomCancel,
    ready: Option<tokio::sync::oneshot::Sender<String>>,
    sessions: Option<SessionRegistry>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(label) = &label {
        config.username = format!("{}-{label}", config.username);
        config.bot_username = format!("{}-{label}", config.bot_username);
        config.room_name = format!("{} ({label})", config.room_name);
    }

    let _rooms_hosted = crate::metrics::RoomHostedGuard::new(if label.is_some() {
        crate::metrics::PoolKind::Pod
    } else {
        crate::metrics::PoolKind::Solo
    });

    info!(
        relay_url = %config.relay_url,
        username = %config.username,
        room_name = %config.room_name,
        auto_start = config.auto_start,
        engine_enabled = config.engine_enabled,
        host_plays = config.host_plays,
        bot_enabled = config.bot_enabled,
        "starting room host"
    );

    let snapshot: SharedHostSnapshot = Arc::new(Mutex::new(HostSnapshot::default()));
    let engine_session: SharedEngineSession = Arc::new(Mutex::new(None));
    if let Some(sessions) = &sessions {
        if let Ok(mut registered) = sessions.lock() {
            registered.push(engine_session.clone());
        }
    }
    let bot_state: SharedBotState = Arc::new(Mutex::new(Vec::new()));
    let (outbound_tx, mut outbound_rx) = tokio_mpsc::unbounded_channel::<ClientMessage>();

    let mut host =
        RelayClient::connect(&config.relay_url, &config.username, &config.password).await?;
    let mut room_id = establish_room(&mut host, &config, &snapshot).await?;

    if let Some(ready) = ready {
        let _ = ready.send(room_id.clone());
    }

    if config.bot_enabled {
        spawn_bots(
            &config,
            std::slice::from_ref(&config.bot_deck),
            &room_id,
            &bot_state,
        );
    }

    loop {
        let exit = run_client_loop(
            &mut host,
            &config,
            &room_id,
            &engine_session,
            &snapshot,
            &bot_state,
            &outbound_tx,
            &mut outbound_rx,
            &cancel,
        )
        .await;
        if matches!(exit, LoopExit::Cancelled) {
            stop_bots(&bot_state);
            host.close().await;
            return Ok(());
        }

        crate::metrics::record_relay_reconnect();
        let mut attempt: usize = 0;
        host = loop {
            let delay = RECONNECT_BACKOFF_SECS[attempt.min(RECONNECT_BACKOFF_SECS.len() - 1)];
            tokio::select! {
                _ = cancel.notified() => {
                    info!(username = %config.username, "room host cancelled while reconnecting");
                    cancel_engine(&engine_session);
                    stop_bots(&bot_state);
                    return Ok(());
                }
                _ = time::sleep(Duration::from_secs(delay)) => {}
            }
            attempt += 1;
            let mut client =
                match RelayClient::connect(&config.relay_url, &config.username, &config.password)
                    .await
                {
                    Ok(client) => client,
                    Err(error) => {
                        warn!(%error, attempt, "relay reconnect failed");
                        continue;
                    }
                };
            match reestablish_room(&mut client, &config, &engine_session, &snapshot).await {
                Ok(new_room_id) => {
                    if new_room_id != room_id {
                        stop_bots(&bot_state);
                        if config.bot_enabled {
                            spawn_bots(
                                &config,
                                std::slice::from_ref(&config.bot_deck),
                                &new_room_id,
                                &bot_state,
                            );
                        }
                        room_id = new_room_id;
                    }
                    break client;
                }
                Err(error) => {
                    warn!(%error, attempt, "failed to re-establish room; retrying");
                }
            }
        };
        info!(username = %config.username, room_id, "relay connection re-established");
    }
}

async fn establish_room(
    client: &mut RelayClient,
    config: &Config,
    snapshot: &SharedHostSnapshot,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let room_id = if let Some(room_id) = &config.room_id {
        client
            .send(&ClientMessage::JoinRoom {
                room_id: room_id.clone(),
                observe: !config.host_plays,
                as_bot: false,
                password: config.room_password.clone(),
            })
            .await?;
        info!(room_id, "joining configured room");
        room_id.clone()
    } else {
        client
            .send(&ClientMessage::CreateRoom {
                room_name: config.room_name.clone(),
                max_players: config.max_players,
                format: config.format.clone(),
                protocol_version: PROTOCOL_VERSION,
                hosted: !config.host_plays,
                engine: engine_kind(config),
                draft_config: None,
                sealed_config: None,
                official_key: config.official_key.clone(),
                password: config.room_password.clone(),
                reconnect_timeout_s: config.reconnect_timeout_s,
            })
            .await?;
        info!(room_name = %config.room_name, "creating room");
        wait_for_host_room(client, config, snapshot).await?
    };

    if config.host_plays {
        seat_client(client, &config.host_deck).await?;
    } else {
        info!(
            username = %config.username,
            "hosting room without occupying a player seat"
        );
    }
    Ok(room_id)
}

async fn reestablish_room(
    client: &mut RelayClient,
    config: &Config,
    engine_session: &SharedEngineSession,
    snapshot: &SharedHostSnapshot,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let resume = {
        let snap = snapshot.lock().map_err(|error| error.to_string())?;
        match (&snap.resume_token, &snap.game, &snap.room_info) {
            (Some(token), Some(game), Some(room_info)) => {
                Some(resume_room_request(config, token, game, room_info))
            }
            _ => None,
        }
    };
    let game_active = engine_session
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false);

    if let (Some(request), true) = (resume, game_active) {
        let room_id = request.room_id.clone();
        client.send(&ClientMessage::ResumeRoom(request)).await?;
        match wait_for_room_resumed(client, engine_session, snapshot).await? {
            Some(room) => {
                let (last_state, seat_states, prompts, player_order, pending_end_game) = {
                    let mut snap = snapshot.lock().map_err(|error| error.to_string())?;
                    snap.room_info = Some(room);
                    (
                        snap.last_state.clone(),
                        snap.last_state_by_slot.clone(),
                        snap.pending_prompts.clone(),
                        snap.game
                            .as_ref()
                            .map(|game| game.player_order.clone())
                            .unwrap_or_default(),
                        snap.pending_end_game.clone(),
                    )
                };
                if let Some(state) = last_state {
                    client
                        .send(&ClientMessage::BroadcastState {
                            state,
                            target_player: None,
                        })
                        .await?;
                }
                for (slot, state) in seat_states {
                    let Some(target_player) =
                        parse_player_slot(&slot).and_then(|index| player_order.get(index).cloned())
                    else {
                        warn!(slot, "cannot replay private state without a mapped player");
                        continue;
                    };
                    client
                        .send(&ClientMessage::BroadcastState {
                            state,
                            target_player: Some(target_player),
                        })
                        .await?;
                }
                for (slot, prompt) in prompts {
                    let Some(target_player) =
                        parse_player_slot(&slot).and_then(|index| player_order.get(index).cloned())
                    else {
                        warn!(slot, "cannot replay prompt without a mapped player");
                        continue;
                    };
                    client
                        .send(&ClientMessage::BroadcastState {
                            state: prompt,
                            target_player: Some(target_player),
                        })
                        .await?;
                }
                if let Some(game_id) = pending_end_game {
                    client.send(&ClientMessage::EndGame { game_id }).await?;
                }
                info!(room_id, "room resumed; snapshot re-broadcast");
                return Ok(room_id);
            }
            None => {
                warn!(room_id, "room resume rejected; abandoning hosted game");
                abort_engine_session(engine_session);
            }
        }
    }

    establish_room(client, config, snapshot).await
}

fn engine_kind(config: &Config) -> EngineKind {
    if matches!(config.backend, EngineBackendKind::Forge) {
        EngineKind::Forge
    } else {
        EngineKind::Manabrew
    }
}

fn resume_room_request(
    config: &Config,
    token: &str,
    game: &GameStart,
    room_info: &RoomInfo,
) -> ResumeRoomRequest {
    ResumeRoomRequest {
        room_id: room_info.room_id.clone(),
        resume_token: token.to_string(),
        room_name: room_info.room_name.clone(),
        max_players: room_info.max_players,
        format: room_info.format.clone(),
        hosted: !config.host_plays,
        engine: engine_kind(config),
        official_key: config.official_key.clone(),
        password: config.room_password.clone(),
        reconnect_timeout_s: Some(room_info.reconnect_timeout_s),
        draft_config: room_info.draft_config.clone(),
        sealed_config: room_info.sealed_config.clone(),
        player_order: game.player_order.clone(),
        player_decks: game.player_decks.clone(),
        starting_life: game.starting_life,
        bot_players: room_info
            .players
            .iter()
            .filter(|player| player.is_bot)
            .map(|player| player.username.clone())
            .collect(),
        game_id: game.game_id.clone(),
    }
}

async fn wait_for_room_resumed(
    client: &mut RelayClient,
    engine_session: &SharedEngineSession,
    snapshot: &SharedHostSnapshot,
) -> Result<Option<RoomInfo>, Box<dyn std::error::Error + Send + Sync>> {
    loop {
        match client.recv().await? {
            Some(ServerMessage::RoomResumed { room }) => {
                if room.status == RoomStatus::Lobby {
                    abort_stale_engine_session(
                        engine_session,
                        snapshot,
                        "resumed room is no longer in game",
                    );
                } else {
                    concede_missing_active_seats(engine_session, snapshot, &room);
                }
                return Ok(Some(room));
            }
            Some(ServerMessage::RoomUpdate { room }) => {
                if room.status == RoomStatus::Lobby {
                    abort_stale_engine_session(
                        engine_session,
                        snapshot,
                        "room reset while reconnecting",
                    );
                } else {
                    concede_missing_active_seats(engine_session, snapshot, &room);
                }
                if let Ok(mut snap) = snapshot.lock() {
                    snap.room_info = Some(room);
                }
            }
            Some(ServerMessage::StateUpdate { from_player, state }) => {
                let Ok(envelope) = serde_json::from_value::<StateEnvelope>(state.clone()) else {
                    continue;
                };
                match envelope {
                    StateEnvelope::Response { .. } => {
                        route_remote_response(engine_session, snapshot, &from_player, &state);
                    }
                    StateEnvelope::Directive {
                        from_player: claimed_slot,
                        directive,
                    } => route_remote_directive(
                        engine_session,
                        snapshot,
                        &from_player,
                        &claimed_slot,
                        &directive,
                    ),
                    _ => {}
                }
            }
            Some(ServerMessage::Error { code, message }) => {
                warn!(code, message, "resume rejected by relay");
                return Ok(None);
            }
            Some(other) => debug!(?other, "ignored message while waiting for room resume"),
            None => return Err("relay closed while waiting for room resume".into()),
        }
    }
}

fn cancel_engine(engine_session: &SharedEngineSession) {
    if let Ok(guard) = engine_session.lock() {
        if let Some(EngineSession::Forge { cancel, .. }) = guard.as_ref() {
            cancel.store(true, Ordering::Relaxed);
        }
    }
}

fn abort_engine_session(engine_session: &SharedEngineSession) {
    cancel_engine(engine_session);
    // Dropping the response channels makes the Manabrew backend's transports
    // observe a disconnect and concede, which ends the engine thread.
    clear_engine_session(engine_session);
}

fn abort_stale_engine_session(
    engine_session: &SharedEngineSession,
    snapshot: &SharedHostSnapshot,
    reason: &str,
) {
    let stale_game_id = engine_session
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|s| s.game_id().to_string()));
    let Some(stale_game_id) = stale_game_id else {
        return;
    };
    warn!(game_id = %stale_game_id, reason, "aborting stale engine session");
    abort_engine_session(engine_session);
    clear_game_snapshot(snapshot, &stale_game_id);
}

fn clear_game_snapshot(snapshot: &SharedHostSnapshot, game_id: &str) {
    if let Ok(mut snap) = snapshot.lock() {
        if snap
            .game
            .as_ref()
            .is_some_and(|game| game.game_id == game_id)
        {
            snap.game = None;
            snap.last_state = None;
            snap.last_state_by_slot.clear();
            snap.pending_prompts.clear();
            snap.pending_end_game = None;
        }
    }
}

/// A game must have at least one human seat. Seats survive disconnects and
/// concessions (reconnect grace / spectating), but an explicit leave removes
/// the seat for good — once every human seat is gone the game has no
/// stakeholders and ends now, instead of bots playing it out until the
/// relay's humanless sweep reclaims the room minutes later.
fn end_game_without_humans(
    engine_session: &SharedEngineSession,
    snapshot: &SharedHostSnapshot,
    outbound_tx: &tokio_mpsc::UnboundedSender<ClientMessage>,
    room: &RoomInfo,
) {
    if room.players.iter().any(|seat| !seat.is_bot) {
        return;
    }
    let game_id = engine_session
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|s| s.game_id().to_string()));
    let Some(game_id) = game_id else {
        return;
    };
    info!(game_id, "no human seats remain; ending hosted game");
    abort_engine_session(engine_session);
    clear_game_snapshot(snapshot, &game_id);
    let _ = outbound_tx.send(ClientMessage::EndGame { game_id });
}

fn spawn_bots(config: &Config, decks: &[DeckSelection], room_id: &str, bot_state: &SharedBotState) {
    stop_bots(bot_state);
    let mut guard = match bot_state.lock() {
        Ok(guard) => guard,
        Err(error) => {
            warn!(%error, "bot state lock poisoned");
            return;
        }
    };
    let open_seats = config.max_players.saturating_sub(1) as usize;
    for (index, deck) in decks.iter().take(open_seats).enumerate() {
        let username = if index == 0 {
            config.bot_username.clone()
        } else {
            format!("{} {}", config.bot_username, index + 1)
        };
        let relay_url = config.relay_url.clone();
        let bot_config = BotConfig {
            username,
            password: config.password.clone(),
            room_id: room_id.to_string(),
            room_password: config.room_password.clone(),
            deck_name: deck.name.clone(),
            deck: deck.deck.clone(),
            commander_name: deck.commander_name.clone(),
            agent: AgentKind::Simple,
            answer_delay_ms: None,
        };
        let shutdown = Arc::new(tokio::sync::Notify::new());
        let bot_shutdown = shutdown.clone();
        let handle = tokio::spawn(async move {
            if let Err(error) = run_bot(relay_url, bot_config, bot_shutdown).await {
                error!(%error, "bot task exited");
            }
        });
        guard.push(BotState { handle, shutdown });
    }
}

fn stop_bots(bot_state: &SharedBotState) {
    match bot_state.lock() {
        Ok(mut state) => {
            for bot in state.drain(..) {
                bot.shutdown.notify_one();
                let mut handle = bot.handle;
                tokio::spawn(async move {
                    if time::timeout(BOT_STOP_TIMEOUT, &mut handle).await.is_err() {
                        handle.abort();
                    }
                });
            }
        }
        Err(error) => warn!(%error, "bot state lock poisoned"),
    }
}

async fn wait_for_host_room(
    client: &mut RelayClient,
    config: &Config,
    snapshot: &SharedHostSnapshot,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    loop {
        match client.recv().await? {
            Some(ServerMessage::RoomCreated {
                room_id,
                room_name,
                room,
                resume_token,
            }) => {
                info!(room_id, room_name, "room created");
                if let Ok(mut snap) = snapshot.lock() {
                    snap.resume_token = resume_token;
                    snap.room_info = Some(room);
                }
                return Ok(room_id);
            }
            Some(ServerMessage::RoomUpdate { room }) if room.host == config.username => {
                info!(room_id = %room.room_id, room_name = %room.room_name, "host room update");
                return Ok(room.room_id);
            }
            Some(ServerMessage::AuthResult { success, error, .. }) => {
                if !success {
                    return Err(format!("authentication failed: {error:?}").into());
                }
            }
            Some(ServerMessage::Error { code, message }) => {
                return Err(format!("server error while creating room: {code}: {message}").into());
            }
            Some(other) => debug!(?other, "ignored message while waiting for room creation"),
            None => return Err("relay closed while waiting for room creation".into()),
        }
    }
}

async fn seat_client(
    client: &mut RelayClient,
    deck: &DeckSelection,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    client
        .send(&ClientMessage::SetDeckSelection {
            deck_name: deck.name.clone(),
            deck: deck.deck.clone(),
            published_deck_id: None,
            commander_name: deck.commander_name.clone(),
            avatar: None,
        })
        .await?;
    client
        .send(&ClientMessage::SetReady { ready: true })
        .await?;
    info!(
        username = %client.username,
        deck = %deck.name,
        cards = deck.deck.cards.len(),
        "selected deck and marked ready"
    );
    Ok(())
}

async fn run_client_loop(
    client: &mut RelayClient,
    config: &Config,
    room_id: &str,
    engine_session: &SharedEngineSession,
    snapshot: &SharedHostSnapshot,
    bot_state: &SharedBotState,
    outbound_tx: &tokio_mpsc::UnboundedSender<ClientMessage>,
    outbound_rx: &mut tokio_mpsc::UnboundedReceiver<ClientMessage>,
    cancel: &RoomCancel,
) -> LoopExit {
    let mut heartbeat = time::interval(Duration::from_secs(30));
    heartbeat.set_missed_tick_behavior(time::MissedTickBehavior::Delay);
    let mut drain_tick = time::interval(Duration::from_secs(5));
    drain_tick.set_missed_tick_behavior(time::MissedTickBehavior::Delay);
    let mut bot_usernames: HashSet<String> = HashSet::new();

    loop {
        tokio::select! {
            _ = cancel.notified() => {
                info!(username = %client.username, "room host cancelled; shutting down");
                cancel_engine(engine_session);
                return LoopExit::Cancelled;
            }
            _ = drain_tick.tick() => {
                let idle = engine_session
                    .lock()
                    .map(|guard| guard.is_none())
                    .unwrap_or(false);
                if draining() && idle {
                    info!(username = %client.username, "draining and no active game; closing room");
                    return LoopExit::Cancelled;
                }
            }
            _ = heartbeat.tick() => {
                if let Err(error) = client.broadcast_room_message(SELF_HOSTED_NODE_PROTOCOL, json!({
                    "type": "heartbeat",
                    "node": client.username,
                    "capacity": config.max_games,
                })).await {
                    warn!(%error, username = %client.username, "relay send failed");
                    return LoopExit::Disconnected;
                }
            }
            outbound = outbound_rx.recv() => {
                let Some(outbound) = outbound else {
                    warn!(username = %client.username, "outbound channel closed");
                    return LoopExit::Cancelled;
                };
                if let Err(error) = client.send(&outbound).await {
                    warn!(%error, username = %client.username, "relay send failed");
                    return LoopExit::Disconnected;
                }
            }
            message = client.recv() => {
                let message = match message {
                    Ok(Some(message)) => message,
                    Ok(None) => {
                        warn!(username = %client.username, "relay websocket closed");
                        return LoopExit::Disconnected;
                    }
                    Err(error) => {
                        warn!(%error, username = %client.username, "relay receive failed");
                        return LoopExit::Disconnected;
                    }
                };
                if let Err(error) = handle_server_message(
                    client,
                    config,
                    room_id,
                    engine_session,
                    snapshot,
                    bot_state,
                    outbound_tx,
                    &mut bot_usernames,
                    message,
                ).await {
                    warn!(%error, username = %client.username, "relay send failed");
                    return LoopExit::Disconnected;
                }
            }
        }
    }
}

async fn handle_server_message(
    client: &mut RelayClient,
    config: &Config,
    room_id: &str,
    engine_session: &SharedEngineSession,
    snapshot: &SharedHostSnapshot,
    bot_state: &SharedBotState,
    outbound_tx: &tokio_mpsc::UnboundedSender<ClientMessage>,
    bot_usernames: &mut HashSet<String>,
    message: ServerMessage,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    match message {
        ServerMessage::RoomUpdate { room } => {
            if let Ok(mut snap) = snapshot.lock() {
                snap.room_info = Some(room.clone());
            }
            *bot_usernames = room
                .players
                .iter()
                .filter(|p| p.is_bot)
                .map(|p| p.username.clone())
                .collect();
            log_room_update(&client.username, &room);
            if room.status == RoomStatus::Lobby {
                abort_stale_engine_session(engine_session, snapshot, "room reset to lobby");
            } else {
                end_game_without_humans(engine_session, snapshot, outbound_tx, &room);
            }
            maybe_auto_start_room(client, config, &room).await?;
        }
        ServerMessage::StateUpdate { from_player, state } => {
            handle_state_update(
                client,
                config,
                room_id,
                engine_session,
                snapshot,
                bot_state,
                from_player,
                state,
            )
            .await?;
        }
        ServerMessage::ReadyStateChanged { username, ready } => {
            info!(username, ready, observer = %client.username, "ready changed");
        }
        ServerMessage::PlayerJoined { username, room_id } => {
            info!(username, room_id, observer = %client.username, "player joined");
        }
        ServerMessage::PlayerLeft { username, room_id } => {
            info!(username, room_id, observer = %client.username, "player left");
            let leaver_still_needed =
                active_player_usernames(snapshot).is_some_and(|active| active.contains(&username));
            if leaver_still_needed {
                if let Some(index) = seat_index_of(snapshot, &username) {
                    info!(
                        username,
                        index, "player abandoned mid-game; conceding their seat"
                    );
                    concede_seat(engine_session, index);
                }
            }
        }
        ServerMessage::GameStarted {
            room_id,
            game_id,
            player_order,
            player_decks,
            starting_life,
        } => {
            info!(room_id, game_id, ?player_order, observer = %client.username, "game started");
            abort_stale_engine_session(engine_session, snapshot, "relay started a new game");
            if let Ok(mut snap) = snapshot.lock() {
                snap.game = Some(GameStart {
                    game_id: game_id.clone(),
                    player_order: player_order.clone(),
                    player_decks: player_decks.clone(),
                    starting_life,
                });
                snap.last_state = None;
                snap.last_state_by_slot.clear();
                snap.pending_prompts.clear();
                snap.pending_end_game = None;
            }
            maybe_start_hosted_engine(
                config,
                engine_session,
                snapshot,
                outbound_tx,
                game_id,
                player_order,
                player_decks,
                starting_life,
                bot_usernames,
            );
        }
        ServerMessage::ServerShuttingDown { reconnect_in_s } => {
            info!(reconnect_in_s, observer = %client.username, "relay is restarting");
        }
        ServerMessage::Error { code, message } => {
            warn!(code, message, observer = %client.username, "server error");
        }
        other => {
            debug!(?other, observer = %client.username, "server message");
        }
    }

    Ok(())
}

async fn handle_state_update(
    client: &mut RelayClient,
    config: &Config,
    room_id: &str,
    engine_session: &SharedEngineSession,
    snapshot: &SharedHostSnapshot,
    bot_state: &SharedBotState,
    from_player: String,
    state: Value,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let Ok(envelope) = serde_json::from_value::<StateEnvelope>(state.clone()) else {
        debug!(from_player, state = %state, observer = %client.username, "state update");
        return Ok(());
    };

    match envelope {
        StateEnvelope::Response { .. } => {
            route_remote_response(engine_session, snapshot, &from_player, &state);
            Ok(())
        }
        StateEnvelope::Directive {
            from_player: claimed_slot,
            directive,
        } => {
            route_remote_directive(
                engine_session,
                snapshot,
                &from_player,
                &claimed_slot,
                &directive,
            );
            Ok(())
        }
        StateEnvelope::RoomRelay {
            protocol,
            from_player: _,
            room_id: requested_room_id,
            payload,
            ..
        } => {
            info!(
                from_player,
                protocol,
                payload = %payload,
                observer = %client.username,
                "room relay message"
            );
            if protocol != SELF_HOSTED_NODE_PROTOCOL {
                return Ok(());
            }
            let payload_type = payload.get("type").and_then(Value::as_str);
            match payload_type {
                Some("removeBot") => {
                    info!(observer = %client.username, "received removeBot request");
                    stop_bots(bot_state);
                }
                Some("spawnBot") => {
                    let effective_room_id = requested_room_id.as_deref().unwrap_or(room_id);
                    if effective_room_id == room_id {
                        info!(observer = %client.username, room_id, "received spawnBot request");
                        let bot_decks = bot_decks_from_payload(config, &payload);
                        spawn_bots(config, &bot_decks, room_id, bot_state);
                    } else {
                        debug!(
                            observer = %client.username,
                            current_room_id = room_id,
                            requested_room_id = effective_room_id,
                            "ignoring spawnBot request for another room"
                        );
                    }
                }
                _ => {}
            }
            Ok(())
        }
        _ => {
            debug!(from_player, state = %state, observer = %client.username, "state update");
            Ok(())
        }
    }
}

fn bot_decks_from_payload(config: &Config, payload: &Value) -> Vec<DeckSelection> {
    let parsed = serde_json::from_value::<SpawnBotPayload>(payload.clone()).ok();
    let requested = match parsed {
        Some(SpawnBotPayload {
            decks: Some(decks), ..
        }) if !decks.is_empty() => decks,
        Some(SpawnBotPayload {
            deck: Some(deck), ..
        }) => vec![deck],
        _ => return vec![config.bot_deck.clone()],
    };
    requested
        .into_iter()
        .map(deck_selection_from_payload)
        .collect()
}

fn deck_selection_from_payload(deck: SpawnBotDeckPayload) -> DeckSelection {
    info!(
        deck = %deck.deck_name,
        cards = deck.deck.cards.len(),
        commander = ?deck.commander_name,
        "using requested bot deck"
    );
    let commander_name = deck.commander_name.or_else(|| {
        deck.deck
            .commanders
            .as_ref()
            .and_then(|commanders| commanders.first())
            .map(|commander| commander.identity.name.clone())
    });
    DeckSelection {
        name: deck.deck_name,
        deck: deck.deck,
        commander_name,
    }
}

async fn maybe_auto_start_room(
    client: &mut RelayClient,
    config: &Config,
    room: &RoomInfo,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if !config.auto_start || draining() {
        return Ok(());
    }
    if config.format == GameFormat::Any {
        return Ok(());
    }
    if room.host != config.username
        || room.status != RoomStatus::Lobby
        || room.players.len() < config.max_players as usize
    {
        return Ok(());
    }
    let all_ready = room
        .players
        .iter()
        .all(|player| player.connected && player.ready && player.selected_deck_name.is_some());
    if all_ready {
        info!(
            room_id = %room.room_id,
            players = room.players.len(),
            "all players ready; auto-starting hosted game"
        );
        client
            .send(&ClientMessage::StartGame { format: None })
            .await?;
    }
    Ok(())
}

const ENGINE_STACK_BYTES: usize = 64 * 1024 * 1024;

fn spawn_engine_thread<F: FnOnce() + Send + 'static>(body: F) {
    if let Err(error) = thread::Builder::new()
        .name("hosted-engine".to_string())
        .stack_size(ENGINE_STACK_BYTES)
        .spawn(body)
    {
        error!(%error, "failed to spawn hosted engine thread");
    }
}

// Any stays commander-capable: hosted "Any" rooms resolve their real format
// at StartGame, and dropping commanders there would break commander games.
fn is_commander_variant(format: GameFormat) -> bool {
    match format {
        GameFormat::Any | GameFormat::Commander | GameFormat::Brawl | GameFormat::Oathbreaker => {
            true
        }
        GameFormat::Standard
        | GameFormat::Pioneer
        | GameFormat::Modern
        | GameFormat::Legacy
        | GameFormat::Vintage
        | GameFormat::Pauper
        | GameFormat::Draft
        | GameFormat::Sealed => false,
    }
}

// Forge GameType name for the java backend; empty = let the adapter infer
// commander-ness the pre-variant way (Any rooms carry no concrete format here).
fn java_game_variant(format: GameFormat) -> &'static str {
    match format {
        GameFormat::Any => "",
        GameFormat::Commander => "Commander",
        GameFormat::Brawl => "Brawl",
        GameFormat::Oathbreaker => "Oathbreaker",
        GameFormat::Standard
        | GameFormat::Pioneer
        | GameFormat::Modern
        | GameFormat::Legacy
        | GameFormat::Vintage
        | GameFormat::Pauper
        | GameFormat::Draft
        | GameFormat::Sealed => "Constructed",
    }
}

fn maybe_start_hosted_engine(
    config: &Config,
    engine_session: &SharedEngineSession,
    snapshot: &SharedHostSnapshot,
    outbound_tx: &tokio_mpsc::UnboundedSender<ClientMessage>,
    game_id: String,
    player_order: Vec<String>,
    player_decks: Vec<PlayerDeckInfo>,
    starting_life: i32,
    bot_usernames: &HashSet<String>,
) {
    if !config.engine_enabled {
        debug!("hosted engine disabled for this node");
        return;
    }
    let backend = config.backend;
    if !backend.is_supported() {
        if let Err(error) = java_backend::JavaRuntimeConfig::from_env().validate() {
            warn!(
                backend = backend.label(),
                %error,
                "hosted engine backend runtime is not ready"
            );
            return;
        }
        warn!(
            backend = backend.label(),
            message = java_backend::unsupported_message(),
            "hosted engine backend is not implemented yet"
        );
        return;
    }

    let local_player_index = if config.host_plays {
        match player_order
            .iter()
            .position(|name| name == &config.username)
        {
            Some(index) => Some(index),
            None => {
                warn!(
                    username = %config.username,
                    ?player_order,
                    "room node is configured as a player but is not in player order; not starting engine"
                );
                return;
            }
        }
    } else {
        None
    };

    let mut guard = match engine_session.lock() {
        Ok(guard) => guard,
        Err(error) => {
            warn!(%error, "engine session lock poisoned");
            return;
        }
    };
    if let Some(session) = guard.as_ref() {
        warn!(
            game_id,
            stale_game_id = session.game_id(),
            "engine session still present at game start; not starting engine"
        );
        return;
    }

    let session_handle = engine_session.clone();
    let num_players = player_order.len();
    if num_players < 2 {
        warn!(num_players, "not enough players to start hosted engine");
        return;
    }

    let mut deck_map: HashMap<String, PlayerDeckInfo> = player_decks
        .into_iter()
        .map(|deck| (deck.username.clone(), deck))
        .collect();
    let mut ordered_decks = Vec::with_capacity(num_players);
    let mut commander_names = Vec::with_capacity(num_players);
    let mut ai_player_indices = Vec::new();
    for (index, username) in player_order.iter().enumerate() {
        let Some(deck) = deck_map.remove(username) else {
            warn!(username, "missing deck for player; not starting engine");
            return;
        };
        if config.forge_ai && bot_usernames.contains(username) {
            ai_player_indices.push(index);
        }
        ordered_decks.push(deck.deck);
        commander_names.push(deck.commander_name);
    }

    let player_names = player_order;
    let room_format = snapshot
        .lock()
        .ok()
        .and_then(|snap| snap.room_info.as_ref().map(|room| room.format.clone()))
        .unwrap_or(GameFormat::Any);
    let commander_variant = is_commander_variant(room_format.clone());
    let game_variant = java_game_variant(room_format).to_string();

    match backend {
        EngineBackendKind::Manabrew => {
            let (remote_prompt_tx, remote_prompt_rx) = std_mpsc::channel::<(usize, AgentMessage)>();
            let mut remote_response_txs = HashMap::new();
            let mut remote_response_rxs = Vec::new();
            for i in 0..num_players {
                if Some(i) == local_player_index {
                    continue;
                }
                let (response_tx, response_rx) = std_mpsc::channel::<ClientToServerMessage>();
                remote_response_txs.insert(i, response_tx);
                remote_response_rxs.push((i, response_rx));
            }
            *guard = Some(EngineSession::Manabrew {
                game_id: game_id.clone(),
                remote_response_txs,
            });
            drop(guard);

            spawn_remote_prompt_forwarder(
                outbound_tx.clone(),
                snapshot.clone(),
                engine_session.clone(),
                game_id.clone(),
                remote_prompt_rx,
                Some(player_names.clone()),
                config.state_delta,
            );
            let (game_over_tx, game_over_rx) = std_mpsc::channel::<HostedGameOver>();
            spawn_game_over_forwarder(
                outbound_tx.clone(),
                game_over_rx,
                engine_session.clone(),
                snapshot.clone(),
                game_id.clone(),
                Some(player_names.clone()),
            );
            let outbound_tx = outbound_tx.clone();
            let snapshot = snapshot.clone();
            spawn_engine_thread(move || {
                info!(
                    game_id,
                    backend = backend.label(),
                    players = num_players,
                    local_player_index,
                    "starting hosted engine thread"
                );
                crate::metrics::record_engine_session_started();
                let started = Instant::now();
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    rust_backend::run_hosted_engine_game(
                        game_id.clone(),
                        player_names,
                        ordered_decks,
                        commander_names,
                        local_player_index,
                        starting_life,
                        remote_prompt_tx,
                        remote_response_rxs,
                        game_over_tx,
                    )
                }));
                finish_hosted_engine(
                    result,
                    &game_id,
                    num_players,
                    started,
                    &outbound_tx,
                    &session_handle,
                    &snapshot,
                );
            });
        }
        EngineBackendKind::Forge => {
            let (remote_prompt_tx, remote_prompt_rx) = std_mpsc::channel::<(usize, AgentMessage)>();
            let mut remote_response_txs = HashMap::new();
            let mut remote_response_rxs = Vec::new();
            for i in 0..num_players {
                if Some(i) == local_player_index {
                    continue;
                }
                let (response_tx, response_rx) = std_mpsc::channel::<ClientToServerMessage>();
                remote_response_txs.insert(i, response_tx);
                remote_response_rxs.push((i, response_rx));
            }
            let cancel = Arc::new(AtomicBool::new(false));
            *guard = Some(EngineSession::Forge {
                game_id: game_id.clone(),
                remote_response_txs,
                cancel: cancel.clone(),
            });
            drop(guard);

            spawn_remote_prompt_forwarder(
                outbound_tx.clone(),
                snapshot.clone(),
                engine_session.clone(),
                game_id.clone(),
                remote_prompt_rx,
                Some(player_names.clone()),
                config.state_delta,
            );
            let (game_over_tx, game_over_rx) = std_mpsc::channel::<HostedGameOver>();
            spawn_game_over_forwarder(
                outbound_tx.clone(),
                game_over_rx,
                engine_session.clone(),
                snapshot.clone(),
                game_id.clone(),
                Some(player_names.clone()),
            );
            let outbound_tx = outbound_tx.clone();
            let snapshot = snapshot.clone();
            spawn_engine_thread(move || {
                info!(
                    game_id,
                    backend = backend.label(),
                    players = num_players,
                    local_player_index,
                    "starting hosted engine thread"
                );
                crate::metrics::record_engine_session_started();
                let started = Instant::now();
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    java_backend::run_hosted_engine_game(
                        game_id.clone(),
                        player_names,
                        ordered_decks,
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
                }));
                finish_hosted_engine(
                    result,
                    &game_id,
                    num_players,
                    started,
                    &outbound_tx,
                    &session_handle,
                    &snapshot,
                );
            });
        }
    }
}

fn clear_engine_session(engine_session: &SharedEngineSession) {
    match engine_session.lock() {
        Ok(mut guard) => *guard = None,
        Err(error) => warn!(%error, "engine session lock poisoned on reset"),
    }
}

/// Usernames of engine players the game still needs — seated in the current
/// game and not yet eliminated per the last state broadcast. Everyone else
/// (eliminated players, non-playing members) is effectively a spectator whose
/// absence never matters. `None` = no hosted game.
fn active_player_usernames(snapshot: &SharedHostSnapshot) -> Option<HashSet<String>> {
    let snap = snapshot.lock().ok()?;
    let game = snap.game.as_ref()?;
    let mut active: HashSet<String> = game.player_order.iter().cloned().collect();
    let players = snap
        .last_state
        .as_ref()
        .and_then(|state| state.pointer("/state/gameView/players"))
        .and_then(Value::as_array);
    if let Some(players) = players {
        for player in players {
            let playing = player
                .get("status")
                .and_then(Value::as_str)
                .is_none_or(|status| status == "playing");
            if playing {
                continue;
            }
            let index = player
                .get("id")
                .and_then(Value::as_str)
                .and_then(parse_player_slot);
            if let Some(username) = index.and_then(|i| game.player_order.get(i)) {
                active.remove(username);
            }
        }
    }
    Some(active)
}

fn seat_index_of(snapshot: &SharedHostSnapshot, username: &str) -> Option<usize> {
    let snap = snapshot.lock().ok()?;
    let game = snap.game.as_ref()?;
    game.player_order.iter().position(|name| name == username)
}

fn concede_missing_active_seats(
    engine_session: &SharedEngineSession,
    snapshot: &SharedHostSnapshot,
    room: &RoomInfo,
) {
    let Some(active) = active_player_usernames(snapshot) else {
        return;
    };
    let present: HashSet<&str> = room
        .players
        .iter()
        .map(|player| player.username.as_str())
        .collect();
    for username in active {
        if !present.contains(username.as_str()) {
            if let Some(index) = seat_index_of(snapshot, &username) {
                concede_seat(engine_session, index);
            }
        }
    }
}

fn concede_seat(engine_session: &SharedEngineSession, player_index: usize) {
    send_seat_message(
        engine_session,
        player_index,
        ClientToServerMessage::Directive {
            directive: manabrew_protocol::transport::DirectiveInput::Concede,
        },
    );
}

fn send_seat_message(
    engine_session: &SharedEngineSession,
    player_index: usize,
    message: ClientToServerMessage,
) {
    let guard = match engine_session.lock() {
        Ok(guard) => guard,
        Err(error) => {
            warn!(%error, "engine session lock poisoned");
            return;
        }
    };
    let Some(session) = guard.as_ref() else {
        debug!(player_index, "no engine session for seat action");
        return;
    };
    let txs = match session {
        EngineSession::Manabrew {
            remote_response_txs,
            ..
        }
        | EngineSession::Forge {
            remote_response_txs,
            ..
        } => remote_response_txs,
    };
    let Some(tx) = txs.get(&player_index) else {
        debug!(player_index, "no response channel for player");
        return;
    };
    if let Err(error) = tx.send(message) {
        warn!(player_index, %error, "failed to route seat message");
    }
}

fn finish_hosted_engine(
    result: std::thread::Result<Result<(), String>>,
    game_id: &str,
    players: usize,
    started: Instant,
    outbound_tx: &tokio_mpsc::UnboundedSender<ClientMessage>,
    session_handle: &SharedEngineSession,
    snapshot: &SharedHostSnapshot,
) {
    let fatal = match result {
        Ok(Ok(())) => {
            info!(game_id, "hosted engine thread finished");
            None
        }
        Ok(Err(message)) => {
            error!(game_id, message, "hosted engine exited with a fatal error");
            Some(message)
        }
        Err(panic) => {
            let message = if let Some(message) = panic.downcast_ref::<String>() {
                message.clone()
            } else if let Some(message) = panic.downcast_ref::<&str>() {
                message.to_string()
            } else {
                "the host engine panicked".to_string()
            };
            error!(game_id, message, "hosted engine thread panicked");
            Some(message)
        }
    };
    crate::metrics::record_engine_session_finished(players, started, fatal.as_deref());
    let still_owner = session_handle
        .lock()
        .map(|guard| guard.as_ref().is_some_and(|s| s.game_id() == game_id))
        .unwrap_or(false);
    if let Some(message) = fatal {
        if still_owner {
            if let Ok(mut snap) = snapshot.lock() {
                if snap
                    .game
                    .as_ref()
                    .is_some_and(|game| game.game_id == game_id)
                {
                    snap.pending_end_game = Some(game_id.to_string());
                }
            }
            if let Ok(state) = serde_json::to_value(StateEnvelope::Fatal { message }) {
                let _ = outbound_tx.send(ClientMessage::BroadcastState {
                    state,
                    target_player: None,
                });
            }
            let _ = outbound_tx.send(ClientMessage::EndGame {
                game_id: game_id.to_string(),
            });
        } else {
            warn!(game_id, message, "stale engine session finished with error");
        }
    }
}

fn route_remote_response(
    engine_session: &SharedEngineSession,
    snapshot: &SharedHostSnapshot,
    authenticated_username: &str,
    state: &Value,
) {
    let envelope: StateEnvelope = match serde_json::from_value(state.clone()) {
        Ok(envelope) => envelope,
        Err(error) => {
            warn!(%error, state = %state, "relay response invalid envelope");
            return;
        }
    };
    let StateEnvelope::Response {
        from_player,
        prompt_id,
        action: action_value,
    } = envelope
    else {
        warn!(state = %state, "expected response envelope");
        return;
    };
    let Some(player_index) =
        authenticated_player_index(snapshot, authenticated_username, &from_player, "response")
    else {
        return;
    };
    let action: PromptOutput = match serde_json::from_value(action_value) {
        Ok(action) => action,
        Err(error) => {
            warn!(from_player, %error, "relay response has invalid action");
            return;
        }
    };

    let guard = match engine_session.lock() {
        Ok(guard) => guard,
        Err(error) => {
            warn!(%error, "engine session lock poisoned");
            return;
        }
    };
    let Some(session) = guard.as_ref() else {
        debug!(from_player, "no engine session for relay response");
        return;
    };
    let tx = match session {
        EngineSession::Manabrew {
            remote_response_txs,
            ..
        } => remote_response_txs.get(&player_index),
        EngineSession::Forge {
            remote_response_txs,
            ..
        } => {
            debug!(
                from_player,
                player_index, "routing relay response to java engine"
            );
            remote_response_txs.get(&player_index)
        }
    };
    let Some(tx) = tx else {
        debug!(from_player, player_index, "no response channel for player");
        return;
    };
    if let Err(error) = tx.send(ClientToServerMessage::Response { prompt_id, action }) {
        warn!(from_player, %error, "failed to route relay response");
        return;
    }
    drop(guard);
    if let Ok(mut snap) = snapshot.lock() {
        snap.pending_prompts.remove(&from_player);
    }
}

fn route_remote_directive(
    engine_session: &SharedEngineSession,
    snapshot: &SharedHostSnapshot,
    authenticated_username: &str,
    claimed_slot: &str,
    directive: &Value,
) {
    let directive: DirectiveInput = match serde_json::from_value(directive.clone()) {
        Ok(directive) => directive,
        Err(error) => {
            warn!(claimed_slot, %error, "relay directive is invalid");
            return;
        }
    };
    let Some(player_index) =
        authenticated_player_index(snapshot, authenticated_username, claimed_slot, "directive")
    else {
        return;
    };
    info!(claimed_slot, player_index, ?directive, "routing directive");
    match directive {
        DirectiveInput::Concede => concede_seat(engine_session, player_index),
    }
}

fn authenticated_player_index(
    snapshot: &SharedHostSnapshot,
    authenticated_username: &str,
    claimed_slot: &str,
    message_kind: &str,
) -> Option<usize> {
    let Some(player_index) = seat_index_of(snapshot, authenticated_username) else {
        warn!(
            authenticated_username,
            message_kind, "relay sender has no engine seat"
        );
        return None;
    };
    let authenticated_slot = player_slot(player_index);
    if claimed_slot != authenticated_slot {
        warn!(
            authenticated_username,
            claimed_slot,
            authenticated_slot,
            message_kind,
            "relay sender claimed another engine seat"
        );
        return None;
    }
    Some(player_index)
}

/// Add the fingerprint of the carried state to a full state envelope, so a
/// receiver can tell whether a later patch applies to what it holds.
fn stamp_fingerprint(mut envelope: Value) -> Value {
    let Some(state) = envelope.get("state") else {
        return envelope;
    };
    let fingerprint = manabrew_relay_protocol::state_delta::fingerprint(state);
    if let Some(object) = envelope.as_object_mut() {
        object.insert("fingerprint".to_string(), Value::String(fingerprint));
    }
    envelope
}

/// Patch form of a fingerprinted state envelope, against the last one sent to
/// this seat. `None` the first time a seat is served, or if anything is missing,
/// and the caller falls back to the full state, which is always correct.
fn patch_against_last(
    bases: &mut HashMap<usize, (Value, String)>,
    player_index: usize,
    per_seat: bool,
    slot: &str,
    envelope: &Value,
) -> Option<Value> {
    let next = envelope.get("state")?.clone();
    let fingerprint = envelope.get("fingerprint")?.as_str()?.to_string();
    let previous = bases.insert(player_index, (next.clone(), fingerprint.clone()));
    let (base_state, base) = previous?;
    let patch = manabrew_relay_protocol::state_delta::diff(&base_state, &next)?;
    serde_json::to_value(StateEnvelope::StateDelta {
        for_player: per_seat.then(|| slot.to_string()),
        base,
        fingerprint,
        patch,
    })
    .ok()
}

fn spawn_remote_prompt_forwarder(
    outbound_tx: tokio_mpsc::UnboundedSender<ClientMessage>,
    snapshot: SharedHostSnapshot,
    engine_session: SharedEngineSession,
    game_id: String,
    remote_prompt_rx: std_mpsc::Receiver<(usize, AgentMessage)>,
    seat_usernames: Option<Vec<String>>,
    state_delta: bool,
) {
    thread::spawn(move || {
        let mut last_state_by_seat: HashMap<usize, Value> = HashMap::new();
        let mut delta_bases: HashMap<usize, (Value, String)> = HashMap::new();
        let mut last_state: Option<Value> = None;
        let mut last_display: Option<Value> = None;
        while let Ok((player_index, message)) = remote_prompt_rx.recv() {
            let Ok(session) = engine_session.lock() else {
                break;
            };
            if session
                .as_ref()
                .is_none_or(|session| session.game_id() != game_id)
            {
                break;
            }
            let per_seat = seat_usernames.is_some() && player_index != OBSERVER_SEAT;
            let slot = player_slot(player_index);
            let envelope = match &message {
                AgentMessage::State(state_update) if !per_seat => StateEnvelope::State {
                    for_player: None,
                    state: serde_json::to_value(state_update).unwrap_or(Value::Null),
                    fingerprint: None,
                },
                _ => StateEnvelope::for_agent_message(slot.clone(), &message),
            };
            let Ok(state) = serde_json::to_value(envelope) else {
                continue;
            };
            let state = match &message {
                AgentMessage::State(_) if state_delta => stamp_fingerprint(state),
                _ => state,
            };
            match &message {
                AgentMessage::State(_) if per_seat => {
                    if last_state_by_seat.get(&player_index) == Some(&state) {
                        continue;
                    }
                    last_state_by_seat.insert(player_index, state.clone());
                }
                AgentMessage::State(_) if last_state.as_ref() == Some(&state) => continue,
                AgentMessage::State(_) => last_state = Some(state.clone()),
                AgentMessage::Display(_) if last_display.as_ref() == Some(&state) => continue,
                AgentMessage::Display(_) => last_display = Some(state.clone()),
                AgentMessage::Prompt(_) | AgentMessage::Error(_) => {}
            }
            if let Ok(mut snap) = snapshot.lock() {
                match &message {
                    AgentMessage::State(_) if per_seat => {
                        snap.last_state_by_slot.insert(slot.clone(), state.clone());
                    }
                    AgentMessage::State(_) => snap.last_state = Some(state.clone()),
                    AgentMessage::Prompt(_) => {
                        snap.pending_prompts.insert(slot.clone(), state.clone());
                    }
                    AgentMessage::Display(_) | AgentMessage::Error(_) => {}
                }
            }
            let state = match &message {
                AgentMessage::State(_) if state_delta => {
                    patch_against_last(&mut delta_bases, player_index, per_seat, &slot, &state)
                        .unwrap_or(state)
                }
                _ => state,
            };
            let target_player = if per_seat
                && matches!(
                    message,
                    AgentMessage::State(_) | AgentMessage::Prompt(_) | AgentMessage::Error(_)
                ) {
                let Some(target_player) = seat_usernames
                    .as_ref()
                    .and_then(|names| names.get(player_index).cloned())
                else {
                    warn!(player_index, PRIVATE_MESSAGE_MISSING_PLAYER);
                    continue;
                };
                Some(target_player)
            } else {
                None
            };
            if outbound_tx
                .send(ClientMessage::BroadcastState {
                    state,
                    target_player,
                })
                .is_err()
            {
                break;
            }
        }
    });
}

fn spawn_game_over_forwarder(
    outbound_tx: tokio_mpsc::UnboundedSender<ClientMessage>,
    game_over_rx: std_mpsc::Receiver<HostedGameOver>,
    session_handle: SharedEngineSession,
    snapshot: SharedHostSnapshot,
    game_id: String,
    seat_usernames: Option<Vec<String>>,
) {
    thread::spawn(move || {
        while let Ok(game_over) = game_over_rx.recv() {
            let Ok(session) = session_handle.lock() else {
                return;
            };
            if session
                .as_ref()
                .is_none_or(|session| session.game_id() != game_id)
            {
                warn!(
                    game_id,
                    "stale engine session reached game over; not ending the relay game"
                );
                continue;
            }
            if let Ok(mut snap) = snapshot.lock() {
                if snap
                    .game
                    .as_ref()
                    .is_some_and(|game| game.game_id == game_id)
                {
                    snap.pending_end_game = Some(game_id.clone());
                }
            }
            let mut last_state_by_seat: HashMap<usize, Value> = HashMap::new();
            let mut last_state: Option<Value> = None;
            for (player_index, message) in game_over.messages {
                let per_seat = seat_usernames.is_some() && player_index != OBSERVER_SEAT;
                let envelope = match &message {
                    AgentMessage::State(state_update) if !per_seat => StateEnvelope::State {
                        for_player: None,
                        state: serde_json::to_value(state_update).unwrap_or(Value::Null),
                        fingerprint: None,
                    },
                    _ => StateEnvelope::for_agent_message(player_slot(player_index), &message),
                };
                let Ok(state) = serde_json::to_value(envelope) else {
                    continue;
                };
                match &message {
                    AgentMessage::State(_) if per_seat => {
                        if last_state_by_seat.get(&player_index) == Some(&state) {
                            continue;
                        }
                        last_state_by_seat.insert(player_index, state.clone());
                    }
                    AgentMessage::State(_) if last_state.as_ref() == Some(&state) => continue,
                    AgentMessage::State(_) => last_state = Some(state.clone()),
                    AgentMessage::Display(_) | AgentMessage::Prompt(_) | AgentMessage::Error(_) => {
                    }
                }
                let target_player = if per_seat
                    && matches!(
                        message,
                        AgentMessage::State(_) | AgentMessage::Prompt(_) | AgentMessage::Error(_)
                    ) {
                    let Some(target_player) = seat_usernames
                        .as_ref()
                        .and_then(|names| names.get(player_index).cloned())
                    else {
                        warn!(player_index, PRIVATE_MESSAGE_MISSING_PLAYER);
                        continue;
                    };
                    Some(target_player)
                } else {
                    None
                };
                if outbound_tx
                    .send(ClientMessage::BroadcastState {
                        state,
                        target_player,
                    })
                    .is_err()
                {
                    return;
                }
            }
            let Ok(state) = serde_json::to_value(StateEnvelope::RoomRelay {
                protocol: SELF_HOSTED_NODE_PROTOCOL.to_string(),
                version: 1,
                message_id: Uuid::new_v4().to_string(),
                from_player: None,
                target_player: None,
                room_id: None,
                payload: json!({ "type": "gameOver", "gameId": game_over.game_id }),
            }) else {
                continue;
            };
            if outbound_tx
                .send(ClientMessage::BroadcastState {
                    state,
                    target_player: None,
                })
                .is_err()
            {
                return;
            }
            if outbound_tx
                .send(ClientMessage::EndGame {
                    game_id: game_id.clone(),
                })
                .is_err()
            {
                return;
            }
        }
    });
}

async fn relay_writer(mut write: WsWrite, mut outbound: tokio_mpsc::UnboundedReceiver<Message>) {
    while let Some(message) = outbound.recv().await {
        let started = Instant::now();
        let closing = matches!(message, Message::Close(_));
        if let Err(error) = write.send(message).await {
            warn!(%error, "relay write failed");
            break;
        }
        crate::metrics::record_relay_send(started.elapsed());
        if closing {
            break;
        }
    }
    let _ = write.close().await;
}

fn self_minted_identity_token(kind: &str, handle: &str) -> String {
    let iat = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or_default();
    identity_token::mint_unsigned(&format!("{kind}:{handle}"), handle, iat, 24 * 60 * 60)
}

impl RelayClient {
    async fn connect(
        relay_url: &str,
        username: &str,
        password: &str,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        info!(relay_url, username, "connecting relay client");
        let (socket, _) = connect_async_with_config(relay_url, None, true).await?;
        let (write, read) = socket.split();
        let (outbound, outbound_rx) = tokio_mpsc::unbounded_channel();
        let writer = tokio::spawn(relay_writer(write, outbound_rx));
        let mut client = Self {
            username: username.to_string(),
            outbound,
            read,
            writer,
        };
        client
            .send(&ClientMessage::Authenticate {
                username: username.to_string(),
                password: password.to_string(),
                service: true,
                identity: Some(IdentityProof {
                    token: Some(self_minted_identity_token("node", username)),
                    device: None,
                }),
                client_platform: ClientPlatform::Unknown,
                client_version: None,
            })
            .await?;
        client.wait_for_auth().await?;
        Ok(client)
    }

    async fn wait_for_auth(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        loop {
            match self.recv().await? {
                Some(ServerMessage::AuthResult { success, error, .. }) => {
                    if success {
                        info!(username = %self.username, "authenticated");
                        return Ok(());
                    }
                    return Err(format!("authentication failed: {error:?}").into());
                }
                Some(other) => {
                    debug!(?other, username = %self.username, "ignored pre-auth message")
                }
                None => return Err("relay closed before authentication".into()),
            }
        }
    }

    async fn send(
        &mut self,
        message: &ClientMessage,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.enqueue(Message::Text(serde_json::to_string(message)?))
    }

    fn enqueue(&self, message: Message) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.outbound
            .send(message)
            .map_err(|_| "relay writer stopped".into())
    }

    async fn recv(
        &mut self,
    ) -> Result<Option<ServerMessage>, Box<dyn std::error::Error + Send + Sync>> {
        loop {
            let Some(message) = self.read.next().await else {
                return Ok(None);
            };
            let message = message?;
            match message {
                Message::Text(text) => {
                    return Ok(Some(serde_json::from_str(&text)?));
                }
                Message::Ping(payload) => {
                    self.enqueue(Message::Pong(payload))?;
                }
                Message::Close(_) => return Ok(None),
                _ => {}
            }
        }
    }

    async fn close(&mut self) {
        if self.enqueue(Message::Close(None)).is_err() {
            return;
        }
        let _ = time::timeout(CLOSE_DRAIN_TIMEOUT, async {
            while let Some(Ok(_)) = self.read.next().await {}
        })
        .await;
        self.writer.abort();
    }

    async fn broadcast_room_message(
        &mut self,
        protocol: &str,
        payload: Value,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let envelope = StateEnvelope::RoomRelay {
            protocol: protocol.to_string(),
            version: 1,
            message_id: Uuid::new_v4().to_string(),
            from_player: Some(self.username.clone()),
            target_player: None,
            room_id: None,
            payload,
        };
        self.send(&ClientMessage::BroadcastState {
            state: serde_json::to_value(envelope)?,
            target_player: None,
        })
        .await
    }
}

fn log_room_update(observer: &str, room: &RoomInfo) {
    let players = room
        .players
        .iter()
        .map(|player| {
            format!(
                "{}{}{}",
                player.username,
                if player.ready { ":ready" } else { "" },
                if player.connected { "" } else { ":offline" },
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    info!(
        observer,
        room_id = %room.room_id,
        room_name = %room.room_name,
        host = %room.host,
        players,
        "room update"
    );
}
