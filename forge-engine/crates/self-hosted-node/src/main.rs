#![allow(clippy::too_many_arguments)]
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc as std_mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

mod config;
mod engine_backend;

use config::{workspace_root, Config, DeckSelection, SelfPlayConfig};
use engine_backend::{java_backend, rust_backend, EngineBackendKind};
use forge_agent_interface::deck_dto::Deck;
use forge_agent_interface::ids_codec::{parse_player_slot, player_slot};
use forge_agent_interface::prompt::{AgentPrompt, PlayerAction};
use forge_bot::{run_bot, AgentKind, BotConfig};
use forge_engine_core::game::TypeRegistry;
use forge_server::protocol::{
    ClientMessage, EngineKind, GameFormat, PlayerDeckInfo, RoomInfo, RoomStatus, ServerMessage,
    StateEnvelope,
};
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio::sync::mpsc as tokio_mpsc;
use tokio::task::JoinHandle;
use tokio::time;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;
type WsWrite = SplitSink<WsStream, Message>;
type WsRead = SplitStream<WsStream>;

const SELF_HOSTED_NODE_PROTOCOL: &str = "self-hosted-node";

struct RelayClient {
    username: String,
    write: WsWrite,
    read: WsRead,
}

enum EngineSession {
    Rust {
        remote_response_txs: HashMap<usize, std_mpsc::Sender<PlayerAction>>,
    },
    Java {
        remote_response_txs: HashMap<usize, std_mpsc::Sender<PlayerAction>>,
        cancel: Arc<AtomicBool>,
    },
}

#[derive(Default)]
struct BotState {
    handle: Option<JoinHandle<()>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpawnBotPayload {
    #[serde(default)]
    deck: Option<SpawnBotDeckPayload>,
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

#[derive(Default)]
struct DisconnectTracker {
    grace: Option<Arc<AtomicBool>>,
}

type SharedDisconnectTracker = Arc<Mutex<DisconnectTracker>>;

const DISCONNECT_GRACE_SECS: u64 = 30;
type SharedBotState = Arc<Mutex<BotState>>;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "self_hosted_node=info".into()),
        )
        .init();

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

async fn run(mut config: Config) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    load_type_registry()?;

    let backend = EngineBackendKind::from_env();
    if config.engine_enabled
        && backend.is_supported()
        && matches!(backend, EngineBackendKind::JavaForge)
    {
        info!("initializing shared java engine (one JVM for all hosted games)");
        java_backend::init_engine()?;
    }

    if config.room_id.is_some() {
        return host_one_room(config, None).await;
    }

    let slots = config.max_games.max(1);
    if slots <= 1 {
        return host_one_room(config, None).await;
    }

    config.format = GameFormat::Any;
    let hosts: Vec<(Config, String)> = (0..slots)
        .map(|slot| (config.clone(), (slot + 1).to_string()))
        .collect();

    info!(rooms = hosts.len(), "hosting multiple rooms on one node");
    let mut handles = Vec::with_capacity(hosts.len());
    for (cfg, label) in hosts {
        handles.push(tokio::spawn(async move {
            if let Err(error) = host_one_room(cfg, Some(label.clone())).await {
                error!(%error, label, "room host exited");
            }
        }));
    }
    for handle in handles {
        let _ = handle.await;
    }
    Ok(())
}

async fn host_one_room(
    mut config: Config,
    label: Option<String>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(label) = &label {
        config.username = format!("{}-{label}", config.username);
        config.bot_username = format!("{}-{label}", config.bot_username);
        config.room_name = format!("{} ({label})", config.room_name);
    }

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

    let mut host =
        RelayClient::connect(&config.relay_url, &config.username, &config.password).await?;

    let room_id = if let Some(room_id) = &config.room_id {
        host.send(&ClientMessage::JoinRoom {
            room_id: room_id.clone(),
            observe: !config.host_plays,
        })
        .await?;
        info!(room_id, "joining configured room");
        room_id.clone()
    } else {
        let engine = if matches!(EngineBackendKind::from_env(), EngineBackendKind::JavaForge) {
            EngineKind::Java
        } else {
            EngineKind::Wasm
        };
        host.send(&ClientMessage::CreateRoom {
            room_name: config.room_name.clone(),
            max_players: config.max_players,
            format: config.format.clone(),
            hosted: !config.host_plays,
            engine,
            draft_config: None,
            sealed_config: None,
        })
        .await?;
        info!(room_name = %config.room_name, "creating room");
        wait_for_host_room(&mut host, &config).await?
    };

    if config.host_plays {
        seat_client(&mut host, &config.host_deck).await?;
    } else {
        info!(
            username = %config.username,
            "hosting room without occupying a player seat"
        );
    }

    let bot_state: SharedBotState = Arc::new(Mutex::new(BotState::default()));
    if config.bot_enabled {
        spawn_bot(&config, &config.bot_deck, room_id.clone(), &bot_state);
    }

    let engine_session: SharedEngineSession = Arc::new(Mutex::new(None));
    let (outbound_tx, outbound_rx) = tokio_mpsc::unbounded_channel::<ClientMessage>();
    run_client_loop(
        host,
        config,
        room_id,
        engine_session,
        bot_state,
        outbound_tx,
        outbound_rx,
    )
    .await
}

fn spawn_bot(config: &Config, deck: &DeckSelection, room_id: String, bot_state: &SharedBotState) {
    let mut guard = match bot_state.lock() {
        Ok(guard) => guard,
        Err(error) => {
            warn!(%error, "bot state lock poisoned");
            return;
        }
    };
    if guard.handle.is_some() {
        debug!(room_id, "bot already spawned for room");
        return;
    }
    let relay_url = config.relay_url.clone();
    let bot_config = BotConfig {
        username: config.bot_username.clone(),
        password: config.password.clone(),
        room_id,
        deck_name: deck.name.clone(),
        deck: deck.deck.clone(),
        commander_name: deck.commander_name.clone(),
        agent: AgentKind::Simple,
    };
    let handle = tokio::spawn(async move {
        if let Err(error) = run_bot(relay_url, bot_config).await {
            error!(%error, "bot task exited");
        }
    });
    guard.handle = Some(handle);
}

fn stop_bot(bot_state: &SharedBotState) {
    match bot_state.lock() {
        Ok(mut state) => {
            if let Some(handle) = state.handle.take() {
                handle.abort();
            }
        }
        Err(error) => warn!(%error, "bot state lock poisoned"),
    }
}

fn load_type_registry() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let type_lists_path = workspace_root()
        .join("forge")
        .join("forge-gui")
        .join("res")
        .join("lists")
        .join("TypeLists.txt");
    let contents = std::fs::read_to_string(&type_lists_path)?;
    TypeRegistry::load(&contents);
    Ok(())
}

async fn wait_for_host_room(
    client: &mut RelayClient,
    config: &Config,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    loop {
        match client.recv().await? {
            Some(ServerMessage::RoomCreated { room_id, room_name }) => {
                info!(room_id, room_name, "room created");
                return Ok(room_id);
            }
            Some(ServerMessage::RoomUpdate { room }) if room.host == config.username => {
                info!(room_id = %room.room_id, room_name = %room.room_name, "host room update");
                return Ok(room.room_id);
            }
            Some(ServerMessage::AuthResult { success, error, .. }) => {
                if !success {
                    return Err(format!("authentication failed: {:?}", error).into());
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
            commander_name: deck.commander_name.clone(),
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
    mut client: RelayClient,
    config: Config,
    room_id: String,
    engine_session: SharedEngineSession,
    bot_state: SharedBotState,
    outbound_tx: tokio_mpsc::UnboundedSender<ClientMessage>,
    mut outbound_rx: tokio_mpsc::UnboundedReceiver<ClientMessage>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut heartbeat = time::interval(Duration::from_secs(30));
    heartbeat.set_missed_tick_behavior(time::MissedTickBehavior::Delay);
    let disconnect_tracker: SharedDisconnectTracker =
        Arc::new(Mutex::new(DisconnectTracker::default()));

    loop {
        tokio::select! {
            _ = heartbeat.tick() => {
                client.broadcast_room_message(SELF_HOSTED_NODE_PROTOCOL, json!({
                    "type": "heartbeat",
                    "node": client.username,
                    "capacity": config.max_games,
                })).await?;
            }
            outbound = outbound_rx.recv() => {
                let Some(outbound) = outbound else {
                    warn!(username = %client.username, "outbound channel closed");
                    return Ok(());
                };
                client.send(&outbound).await?;
            }
            message = client.recv() => {
                let Some(message) = message? else {
                    warn!(username = %client.username, "relay websocket closed");
                    return Ok(());
                };
                handle_server_message(
                    &mut client,
                    &config,
                    &room_id,
                    &engine_session,
                    &bot_state,
                    &outbound_tx,
                    &disconnect_tracker,
                    message,
                ).await?;
            }
        }
    }
}

async fn handle_server_message(
    client: &mut RelayClient,
    config: &Config,
    room_id: &str,
    engine_session: &SharedEngineSession,
    bot_state: &SharedBotState,
    outbound_tx: &tokio_mpsc::UnboundedSender<ClientMessage>,
    disconnect_tracker: &SharedDisconnectTracker,
    message: ServerMessage,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    match message {
        ServerMessage::RoomUpdate { room } => {
            log_room_update(&client.username, &room);
            handle_disconnect_grace(&room, engine_session, outbound_tx, disconnect_tracker);
            maybe_auto_start_room(client, config, &room).await?;
        }
        ServerMessage::StateUpdate { from_player, state } => {
            handle_state_update(
                client,
                config,
                room_id,
                engine_session,
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
            end_hosted_game_on_abandon(engine_session, outbound_tx);
        }
        ServerMessage::GameStarted {
            room_id,
            player_order,
            player_decks,
            starting_life,
        } => {
            info!(room_id, ?player_order, observer = %client.username, "game started");
            maybe_start_hosted_engine(
                config,
                engine_session,
                outbound_tx,
                player_order,
                player_decks,
                starting_life,
            );
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
            route_remote_response(engine_session, &state);
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
                    stop_bot(bot_state);
                }
                Some("startGame") => {
                    info!(observer = %client.username, "received startGame request");
                    let format = payload
                        .get("format")
                        .and_then(|value| serde_json::from_value::<GameFormat>(value.clone()).ok());
                    client.send(&ClientMessage::StartGame { format }).await?;
                }
                Some("spawnBot") => {
                    let effective_room_id = requested_room_id.as_deref().unwrap_or(room_id);
                    if effective_room_id == room_id {
                        info!(observer = %client.username, room_id, "received spawnBot request");
                        let bot_deck = bot_deck_from_payload(config, &payload);
                        stop_bot(bot_state);
                        spawn_bot(config, &bot_deck, room_id.to_string(), bot_state);
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

fn bot_deck_from_payload(config: &Config, payload: &Value) -> DeckSelection {
    let deck = serde_json::from_value::<SpawnBotPayload>(payload.clone())
        .ok()
        .and_then(|payload| payload.deck);
    let Some(deck) = deck else {
        return config.bot_deck.clone();
    };
    info!(
        deck = %deck.deck_name,
        cards = deck.deck.cards.len(),
        commander = ?deck.commander_name,
        "using requested bot deck"
    );
    DeckSelection {
        name: deck.deck_name,
        deck: deck.deck,
        commander_name: deck.commander_name,
    }
}

async fn maybe_auto_start_room(
    client: &mut RelayClient,
    config: &Config,
    room: &RoomInfo,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if !config.auto_start {
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

fn maybe_start_hosted_engine(
    config: &Config,
    engine_session: &SharedEngineSession,
    outbound_tx: &tokio_mpsc::UnboundedSender<ClientMessage>,
    player_order: Vec<String>,
    player_decks: Vec<PlayerDeckInfo>,
    starting_life: i32,
) {
    if !config.engine_enabled {
        debug!("hosted engine disabled for this node");
        return;
    }
    let backend = EngineBackendKind::from_env();
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
    if guard.is_some() {
        debug!("engine session already running");
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
    for username in &player_order {
        let Some(deck) = deck_map.remove(username) else {
            warn!(username, "missing deck for player; not starting engine");
            return;
        };
        ordered_decks.push(deck.deck);
        commander_names.push(deck.commander_name);
    }

    let player_names = player_order;
    let game_id = format!("room-game-{}", Uuid::new_v4());

    match backend {
        EngineBackendKind::Rust => {
            let (remote_prompt_tx, remote_prompt_rx) = std_mpsc::channel::<(usize, AgentPrompt)>();
            let mut remote_response_txs = HashMap::new();
            let mut remote_response_rxs = Vec::new();
            for i in 0..num_players {
                if Some(i) == local_player_index {
                    continue;
                }
                let (response_tx, response_rx) = std_mpsc::channel::<PlayerAction>();
                remote_response_txs.insert(i, response_tx);
                remote_response_rxs.push((i, response_rx));
            }
            *guard = Some(EngineSession::Rust {
                remote_response_txs,
            });
            drop(guard);

            spawn_remote_prompt_forwarder(outbound_tx.clone(), remote_prompt_rx);
            let (game_over_tx, game_over_rx) = std_mpsc::channel::<String>();
            spawn_game_over_forwarder(outbound_tx.clone(), game_over_rx);
            spawn_engine_thread(move || {
                info!(
                    game_id,
                    backend = backend.label(),
                    players = num_players,
                    local_player_index,
                    "starting hosted engine thread"
                );
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
                log_hosted_engine_result(result);
                clear_engine_session(&session_handle);
            });
        }
        EngineBackendKind::JavaForge => {
            let (remote_prompt_tx, remote_prompt_rx) = std_mpsc::channel::<(usize, AgentPrompt)>();
            let mut remote_response_txs = HashMap::new();
            let mut remote_response_rxs = Vec::new();
            for i in 0..num_players {
                if Some(i) == local_player_index {
                    continue;
                }
                let (response_tx, response_rx) = std_mpsc::channel::<PlayerAction>();
                remote_response_txs.insert(i, response_tx);
                remote_response_rxs.push((i, response_rx));
            }
            let cancel = Arc::new(AtomicBool::new(false));
            *guard = Some(EngineSession::Java {
                remote_response_txs,
                cancel: cancel.clone(),
            });
            drop(guard);

            spawn_remote_prompt_forwarder(outbound_tx.clone(), remote_prompt_rx);
            let (game_over_tx, game_over_rx) = std_mpsc::channel::<String>();
            spawn_game_over_forwarder(outbound_tx.clone(), game_over_rx);
            spawn_engine_thread(move || {
                info!(
                    game_id,
                    backend = backend.label(),
                    players = num_players,
                    local_player_index,
                    "starting hosted engine thread"
                );
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    java_backend::run_hosted_engine_game(
                        game_id.clone(),
                        player_names,
                        ordered_decks,
                        commander_names,
                        local_player_index,
                        starting_life,
                        remote_prompt_tx,
                        remote_response_rxs,
                        game_over_tx,
                        cancel,
                    )
                }));
                log_hosted_engine_result(result);
                clear_engine_session(&session_handle);
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

fn handle_disconnect_grace(
    room: &RoomInfo,
    engine_session: &SharedEngineSession,
    outbound_tx: &tokio_mpsc::UnboundedSender<ClientMessage>,
    tracker: &SharedDisconnectTracker,
) {
    let any_offline = room.players.iter().any(|player| !player.connected);
    let game_active = engine_session
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false);
    let mut tracker = match tracker.lock() {
        Ok(tracker) => tracker,
        Err(error) => {
            warn!(%error, "disconnect tracker lock poisoned");
            return;
        }
    };
    if any_offline && game_active {
        if tracker.grace.is_none() {
            let token = Arc::new(AtomicBool::new(true));
            tracker.grace = Some(token.clone());
            let engine_session = engine_session.clone();
            let outbound_tx = outbound_tx.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_secs(DISCONNECT_GRACE_SECS)).await;
                if token.load(Ordering::Relaxed) {
                    info!("player did not reconnect within grace; ending hosted game");
                    end_hosted_game_on_abandon(&engine_session, &outbound_tx);
                }
            });
        }
    } else if let Some(token) = tracker.grace.take() {
        token.store(false, Ordering::Relaxed);
    }
}

fn end_hosted_game_on_abandon(
    engine_session: &SharedEngineSession,
    outbound_tx: &tokio_mpsc::UnboundedSender<ClientMessage>,
) {
    let cancelled = match engine_session.lock() {
        Ok(guard) => match guard.as_ref() {
            Some(EngineSession::Java { cancel, .. }) => {
                cancel.store(true, Ordering::Relaxed);
                true
            }
            _ => false,
        },
        Err(error) => {
            warn!(%error, "engine session lock poisoned");
            false
        }
    };
    if cancelled {
        info!("player abandoned an in-progress hosted game; ending it to free the room");
        let _ = outbound_tx.send(ClientMessage::EndGame);
    }
}

fn log_hosted_engine_result(result: std::thread::Result<()>) {
    match result {
        Ok(()) => info!("hosted engine thread finished"),
        Err(error) => {
            let message = if let Some(message) = error.downcast_ref::<String>() {
                message.clone()
            } else if let Some(message) = error.downcast_ref::<&str>() {
                message.to_string()
            } else {
                "unknown panic".to_string()
            };
            error!(message, "hosted engine thread panicked");
        }
    }
}

fn route_remote_response(engine_session: &SharedEngineSession, state: &Value) {
    let envelope: StateEnvelope = match serde_json::from_value(state.clone()) {
        Ok(envelope) => envelope,
        Err(error) => {
            warn!(%error, state = %state, "relay response invalid envelope");
            return;
        }
    };
    let StateEnvelope::Response {
        from_player,
        action: action_value,
    } = envelope
    else {
        warn!(state = %state, "expected response envelope");
        return;
    };
    let Some(player_index) = parse_player_slot(&from_player) else {
        warn!(from_player, "relay response has invalid player slot");
        return;
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
    match session {
        EngineSession::Rust {
            remote_response_txs,
        } => {
            let action: PlayerAction = match serde_json::from_value(action_value) {
                Ok(action) => action,
                Err(error) => {
                    warn!(from_player, %error, "relay response has invalid rust action");
                    return;
                }
            };
            let Some(tx) = remote_response_txs.get(&player_index) else {
                debug!(from_player, player_index, "no response channel for player");
                return;
            };
            if let Err(error) = tx.send(action) {
                warn!(from_player, %error, "failed to route relay response");
            }
        }
        EngineSession::Java {
            remote_response_txs,
            ..
        } => {
            let action: PlayerAction = match serde_json::from_value(action_value) {
                Ok(action) => action,
                Err(error) => {
                    warn!(from_player, %error, "relay response has invalid java action");
                    return;
                }
            };
            let Some(tx) = remote_response_txs.get(&player_index) else {
                debug!(from_player, player_index, "no response channel for player");
                return;
            };
            debug!(
                from_player,
                player_index, "routing relay response to java engine"
            );
            if let Err(error) = tx.send(action) {
                warn!(from_player, %error, "failed to route relay response");
            }
        }
    }
}

fn spawn_remote_prompt_forwarder(
    outbound_tx: tokio_mpsc::UnboundedSender<ClientMessage>,
    remote_prompt_rx: std_mpsc::Receiver<(usize, AgentPrompt)>,
) {
    thread::spawn(move || {
        while let Ok((player_index, prompt)) = remote_prompt_rx.recv() {
            let Ok(state) = serde_json::to_value(StateEnvelope::Prompt {
                for_player: player_slot(player_index),
                prompt: serde_json::to_value(prompt).unwrap_or(Value::Null),
            }) else {
                continue;
            };
            if outbound_tx
                .send(ClientMessage::BroadcastState { state })
                .is_err()
            {
                break;
            }
        }
    });
}

fn spawn_game_over_forwarder(
    outbound_tx: tokio_mpsc::UnboundedSender<ClientMessage>,
    game_over_rx: std_mpsc::Receiver<String>,
) {
    thread::spawn(move || {
        while let Ok(game_id) = game_over_rx.recv() {
            let Ok(state) = serde_json::to_value(StateEnvelope::RoomRelay {
                protocol: SELF_HOSTED_NODE_PROTOCOL.to_string(),
                version: 1,
                message_id: Uuid::new_v4().to_string(),
                from_player: None,
                target_player: None,
                room_id: None,
                payload: json!({ "type": "gameOver", "gameId": game_id }),
            }) else {
                continue;
            };
            if outbound_tx
                .send(ClientMessage::BroadcastState { state })
                .is_err()
            {
                break;
            }
            if outbound_tx.send(ClientMessage::EndGame).is_err() {
                break;
            }
        }
    });
}

impl RelayClient {
    async fn connect(
        relay_url: &str,
        username: &str,
        password: &str,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        info!(relay_url, username, "connecting relay client");
        let (socket, _) = connect_async(relay_url).await?;
        let (write, read) = socket.split();
        let mut client = Self {
            username: username.to_string(),
            write,
            read,
        };
        client
            .send(&ClientMessage::Authenticate {
                username: username.to_string(),
                password: password.to_string(),
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
                    return Err(format!("authentication failed: {:?}", error).into());
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
        self.write
            .send(Message::Text(serde_json::to_string(message)?))
            .await?;
        Ok(())
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
                    self.write.send(Message::Pong(payload)).await?;
                }
                Message::Close(_) => return Ok(None),
                _ => {}
            }
        }
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
