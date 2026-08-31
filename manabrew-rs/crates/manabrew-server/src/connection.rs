use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::error::ProtocolError;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, info, warn};

use crate::analytics::{self, AnalyticsEvent};
use crate::cleanup::mark_disconnected;
use crate::client_build::ClientBuild;
use crate::error::ServerError;
use crate::identity::{self, SessionIdentity};
use crate::lobby;
use crate::metrics;
use crate::protocol::{ClientMessage, RoomStatus, ServerMessage};
use crate::room::Room;
use crate::state::{ConnectedPlayer, ServerState};
use manabrew_protocol::deck_dto::OUTDATED_CLIENT_MESSAGE;
use manabrew_protocol::transport::ClientToServerMessage as EngineInput;

type WsSender = futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    tokio_tungstenite::tungstenite::Message,
>;

type WsReceiver =
    futures_util::stream::SplitStream<tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>>;

pub(crate) const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(25);
pub(crate) const READ_IDLE_TIMEOUT: Duration = Duration::from_secs(90);
const SELF_HOSTED_NODE_PROTOCOL: &str = "self-hosted-node";

#[derive(Clone, Copy, PartialEq, Eq)]
enum GameMessageSource {
    Engine,
    Player,
    RoomRelay,
}

/// A `stateDelta` envelope carries a patch against the last state sent to that
/// seat, not a whole board. See `manabrew_relay_protocol::state_delta`.
fn is_state_patch(envelope: &serde_json::Value) -> bool {
    envelope.get("kind").and_then(serde_json::Value::as_str) == Some("stateDelta")
}

fn authorize_game_message(
    room: &Room,
    player_id: &str,
    username: &str,
    state: &serde_json::Value,
) -> Option<GameMessageSource> {
    match state.get("kind").and_then(serde_json::Value::as_str)? {
        "response" | "directive" => {
            let claimed_slot = state
                .get("fromPlayer")
                .and_then(serde_json::Value::as_str)?;
            let authenticated_slot = room.replay.as_ref()?.slot_for(username)?;
            if claimed_slot != authenticated_slot {
                return None;
            }
            let mut input = state.clone();
            input.as_object_mut()?.remove("fromPlayer");
            serde_json::from_value::<EngineInput>(input)
                .ok()
                .map(|_| GameMessageSource::Player)
        }
        "state" | "stateDelta" | "display" | "prompt" | "error" | "log" | "snapshot" | "fatal" => {
            room.is_host(player_id).then_some(GameMessageSource::Engine)
        }
        "roomRelay" => {
            let protocol = state.get("protocol").and_then(serde_json::Value::as_str)?;
            if protocol != SELF_HOSTED_NODE_PROTOCOL {
                return Some(GameMessageSource::RoomRelay);
            }
            match state
                .get("payload")
                .and_then(|payload| payload.get("type"))
                .and_then(serde_json::Value::as_str)?
            {
                "gameOver" => {
                    let game_id = state
                        .get("payload")
                        .and_then(|payload| payload.get("gameId"))
                        .and_then(serde_json::Value::as_str)?;
                    (room.is_host(player_id)
                        && room
                            .replay
                            .as_ref()
                            .is_some_and(|replay| replay.game_id == game_id))
                    .then_some(GameMessageSource::RoomRelay)
                }
                "heartbeat" => room
                    .is_host(player_id)
                    .then_some(GameMessageSource::RoomRelay),
                "spawnBot" | "removeBot" => room
                    .is_controller(player_id)
                    .then_some(GameMessageSource::RoomRelay),
                _ => None,
            }
        }
        _ => None,
    }
}

/// Background task: drains channel and writes to the WebSocket sink.
async fn write_loop(mut rx: mpsc::UnboundedReceiver<Message>, mut sink: WsSender) {
    while let Some(msg) = rx.recv().await {
        let backlog = rx.len();
        let started = Instant::now();
        let sent = sink.send(msg).await;
        metrics::record_socket_write(backlog, started.elapsed());
        if sent.is_err() {
            break;
        }
    }
    let _ = sink.close().await;
}

fn send_msg(sender: &mpsc::UnboundedSender<Message>, msg: &ServerMessage) {
    if let Ok(json) = serde_json::to_string(msg) {
        let _ = sender.send(Message::Text(json));
    }
}

fn send_error(sender: &mpsc::UnboundedSender<Message>, err: &ServerError) {
    metrics::record_rejection(err.code());
    send_msg(
        sender,
        &ServerMessage::Error {
            code: err.code().into(),
            message: err.to_string(),
        },
    );
}

pub(crate) fn emit_to(state: &Arc<ServerState>, player_id: &str, msg: &ServerMessage, json: &str) {
    if let Some(player) = state.players.get(player_id) {
        if player.connected {
            debug!("[emit] -> '{}': {}", player.username, msg_type_of(msg));
            let _ = player.sender.send(Message::Text(json.to_string()));
        }
    }
}

fn player_list(state: &Arc<ServerState>) -> Vec<crate::protocol::PlayerInfo> {
    state
        .players
        .iter()
        .filter(|entry| !entry.value().is_service)
        .map(|entry| crate::protocol::PlayerInfo {
            username: entry.value().username.clone(),
            player_id: entry.value().player_id.clone(),
            connected: entry.value().connected,
            verified: entry.value().verified(),
            qualification: entry.value().qualification.clone(),
            avatar_url: entry.value().avatar_url.clone(),
            room_id: entry.value().room_id.clone(),
            // A dropped socket stops asserting anything.
            local_game: entry
                .value()
                .connected
                .then(|| entry.value().local_game)
                .flatten(),
        })
        .collect()
}

pub fn broadcast_player_list(state: &Arc<ServerState>) {
    let msg = ServerMessage::PlayerList {
        players: player_list(state),
    };
    let json = match serde_json::to_string(&msg) {
        Ok(j) => j,
        Err(_) => return,
    };
    let player_ids: Vec<String> = state
        .players
        .iter()
        .filter(|entry| entry.value().connected && !entry.value().is_service)
        .map(|entry| entry.key().clone())
        .collect();
    for pid in &player_ids {
        emit_to(state, pid, &msg, &json);
    }
}

pub fn broadcast_to_room_except(
    state: &Arc<ServerState>,
    sender_player_id: &str,
    room_id: &str,
    msg: &ServerMessage,
) {
    let json = match serde_json::to_string(msg) {
        Ok(j) => j,
        Err(_) => return,
    };

    let player_ids: Vec<String> = {
        if let Some(room) = state.rooms.get(room_id) {
            room.connected_player_ids()
        } else {
            return;
        }
    };

    let sender_name = get_username(state, sender_player_id);
    let target_count = player_ids
        .iter()
        .filter(|p| p.as_str() != sender_player_id)
        .count();
    debug!(
        "[broadcast] room={} from='{}' type={} targets={}",
        &room_id[..8],
        sender_name,
        msg_type_of(msg),
        target_count,
    );

    for pid in &player_ids {
        if pid == sender_player_id {
            continue;
        }
        emit_to(state, pid, msg, &json);
    }
}

fn room_player_id(
    state: &Arc<ServerState>,
    room_id: &str,
    target_username: &str,
) -> Option<String> {
    state
        .rooms
        .get(room_id)
        .and_then(|room| room_player_id_in(&room, target_username))
}

fn room_player_id_in(room: &Room, target_username: &str) -> Option<String> {
    if room.host_username == target_username && room.host_connected() {
        Some(room.host_player_id.clone())
    } else {
        room.players
            .iter()
            .find(|p| p.connected && p.username == target_username)
            .map(|p| p.player_id.clone())
    }
}

/// Whether every client that would receive this envelope ships the `stateDelta`
/// applier. One seat that does not is enough to fall back to a full state: a
/// dropped patch leaves that player's board frozen for the rest of the game.
fn state_patch_audience_ready(
    state: &Arc<ServerState>,
    room: &Room,
    sender_player_id: &str,
    target_username: Option<&str>,
) -> bool {
    let applies = |player_id: &str| {
        state
            .players
            .get(player_id)
            .is_some_and(|player| player.client.applies_state_patches())
    };
    match target_username {
        // An unresolvable target means the send is about to be dropped anyway.
        Some(target) => room_player_id_in(room, target).is_none_or(|pid| applies(&pid)),
        None => room
            .connected_player_ids()
            .iter()
            .filter(|pid| pid.as_str() != sender_player_id)
            .all(|pid| applies(pid)),
    }
}

pub fn send_to_room_player(
    state: &Arc<ServerState>,
    room_id: &str,
    target_username: &str,
    msg: &ServerMessage,
) {
    let json = match serde_json::to_string(msg) {
        Ok(j) => j,
        Err(_) => return,
    };
    let Some(pid) = room_player_id(state, room_id, target_username) else {
        debug!(
            "[send] room={} target '{}' not connected, dropping {}",
            &room_id[..8],
            target_username,
            msg_type_of(msg),
        );
        return;
    };
    emit_to(state, &pid, msg, &json);
}

pub fn broadcast_to_room(state: &Arc<ServerState>, room_id: &str, msg: &ServerMessage) {
    let json = match serde_json::to_string(msg) {
        Ok(j) => j,
        Err(_) => return,
    };

    let player_ids: Vec<String> = {
        if let Some(room) = state.rooms.get(room_id) {
            room.connected_player_ids()
        } else {
            return;
        }
    };

    debug!(
        "[broadcast] room={} type={} targets={}",
        &room_id[..8.min(room_id.len())],
        msg_type_of(msg),
        player_ids.len(),
    );

    for pid in &player_ids {
        emit_to(state, pid, msg, &json);
    }
}

/// Handle a single WebSocket connection from accept to close.
pub async fn handle_connection(
    stream: tokio::net::TcpStream,
    addr: SocketAddr,
    state: Arc<ServerState>,
) -> Result<(), ServerError> {
    info!("[connect] new TCP connection from {}", addr);

    let ws_stream = tokio_tungstenite::accept_async(stream)
        .await
        .map_err(|e| ServerError::WebSocket(Box::new(e)))?;

    info!("[connect] WebSocket upgraded for {}", addr);

    let (sink, mut receiver) = ws_stream.split();
    let (tx, rx) = mpsc::unbounded_channel();

    let mut write_task = tokio::spawn(write_loop(rx, sink));

    let (player_id, username, reconnected, generation, client, service) =
        match authenticate(&mut receiver, &tx, &state).await {
            Ok(result) => result,
            Err(e) => {
                if matches!(e, ServerError::AuthTimeout) {
                    info!("[auth] failed from {}: {}", addr, e);
                } else {
                    warn!("[auth] failed from {}: {}", addr, e);
                }
                metrics::record_rejection(e.code());
                drop(tx);
                let _ = write_task.await;
                return Ok(());
            }
        };

    if !service {
        state.analytics.emit(AnalyticsEvent::ClientConnected {
            ts: analytics::now_ts(),
            username: username.clone(),
            platform: client.platform.as_str().to_string(),
            version: client.version().map(str::to_string),
            reconnected,
        });
    }

    if reconnected {
        info!(
            "[auth] '{}' reconnected from {} (id={})",
            username,
            addr,
            &player_id[..8]
        );
    } else {
        info!(
            "[auth] '{}' authenticated from {} (id={})",
            username,
            addr,
            &player_id[..8]
        );
    }

    let heartbeat_tx = tx.clone();
    let heartbeat_start = Instant::now();
    let heartbeat_task = tokio::spawn(async move {
        let mut ticker = tokio::time::interval(HEARTBEAT_INTERVAL);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            ticker.tick().await;
            // The payload comes back untouched in the pong (RFC 6455 §5.5.2),
            // so the relay can time the round trip without the client
            // participating or the two clocks agreeing.
            let stamp = heartbeat_start.elapsed().as_millis() as u64;
            if heartbeat_tx
                .send(Message::Ping(stamp.to_be_bytes().to_vec()))
                .is_err()
            {
                break;
            }
        }
    });

    let mut write_task_done = false;
    let connected_at = Instant::now();
    let disconnect_reason: &str;

    loop {
        let read = tokio::time::timeout(READ_IDLE_TIMEOUT, receiver.next());
        let frame = tokio::select! {
            frame = read => match frame {
                Ok(Some(Ok(f))) => f,
                Ok(Some(Err(e))) => {
                    if matches!(
                        &e,
                        tokio_tungstenite::tungstenite::Error::Protocol(
                            ProtocolError::ResetWithoutClosingHandshake
                        )
                    ) {
                        info!("[recv] '{}' disconnected without close handshake", username);
                        disconnect_reason = "connection_reset";
                    } else {
                        warn!("[recv] read error from '{}': {}", username, e);
                        disconnect_reason = "read_error";
                    }
                    break;
                }
                Ok(None) => {
                    disconnect_reason = "stream_closed";
                    break;
                }
                Err(_) => {
                    disconnect_reason = "idle_timeout";
                    break;
                }
            },
            result = &mut write_task => {
                write_task_done = true;
                match result {
                    Ok(()) => {
                        disconnect_reason = "writer_stopped";
                    }
                    Err(e) => {
                        warn!("[send] writer task failed for '{}': {}", username, e);
                        disconnect_reason = "writer_failed";
                    }
                }
                break;
            }
        };

        if let Some(mut player) = state.players.get_mut(&player_id) {
            if player.generation == generation {
                player.last_seen = Instant::now();
            }
        }

        match frame {
            Message::Text(text) => {
                let client_msg: ClientMessage = match serde_json::from_str(&text) {
                    Ok(m) => m,
                    Err(e) => {
                        warn!("[recv] parse error from '{}': {}", username, e);
                        let message = e.to_string();
                        let parse_error = ServerError::from(e);
                        if message.contains(OUTDATED_CLIENT_MESSAGE) {
                            metrics::record_rejection(metrics::REJECTION_OUTDATED_WIRE);
                        } else {
                            metrics::record_rejection(parse_error.code());
                        }
                        let err_msg = ServerMessage::Error {
                            code: parse_error.code().into(),
                            message,
                        };
                        send_msg(&tx, &err_msg);
                        continue;
                    }
                };
                debug!("[recv] '{}' -> {}", username, client_msg_type(&client_msg));
                handle_client_message(&state, &player_id, &username, &tx, client_msg);
            }
            Message::Close(_) => {
                disconnect_reason = "client_close";
                break;
            }
            Message::Ping(data) => {
                debug!("[recv] '{}' ping", username);
                let _ = tx.send(Message::Pong(data));
            }
            Message::Pong(data) => {
                debug!("[recv] '{}' pong", username);
                if let Ok(bytes) = <[u8; 8]>::try_from(data.as_slice()) {
                    let sent = u64::from_be_bytes(bytes);
                    let now = heartbeat_start.elapsed().as_millis() as u64;
                    let rtt = now.saturating_sub(sent);
                    metrics::record_client_rtt(rtt as f64);
                    if let Some(mut player) = state.players.get_mut(&player_id) {
                        player.last_client_rtt_ms = Some(rtt.min(u64::from(u32::MAX)) as u32);
                    }
                }
            }
            _ => {}
        }
    }

    let connected_for_s = connected_at.elapsed().as_secs();
    let room_id_for_log = state
        .players
        .get(&player_id)
        .and_then(|p| p.room_id.clone());
    info!(
        "[disconnect] user='{}' id={} reason={} connected_for_s={} room={:?}",
        username,
        &player_id[..8],
        disconnect_reason,
        connected_for_s,
        room_id_for_log,
    );
    mark_disconnected(&state, &player_id, generation);

    // Tear down background tasks after we have marked the player disconnected.
    // Do not wait on write_loop via channel close: sender clones are stored in
    // ServerState for reconnection, so rx may never close on abrupt disconnects.
    heartbeat_task.abort();
    drop(tx);
    if !write_task_done {
        write_task.abort();
        let _ = write_task.await;
    }
    Ok(())
}

async fn authenticate(
    receiver: &mut WsReceiver,
    sender: &mpsc::UnboundedSender<Message>,
    state: &Arc<ServerState>,
) -> Result<(String, String, bool, u64, ClientBuild, bool), ServerError> {
    let timeout = Duration::from_secs(10);

    let frame = tokio::time::timeout(timeout, receiver.next())
        .await
        .map_err(|_| ServerError::AuthTimeout)?
        .ok_or(ServerError::AuthFailed("Connection closed".into()))?
        .map_err(|e| ServerError::WebSocket(Box::new(e)))?;

    let text = match frame {
        Message::Text(t) => t,
        _ => {
            return Err(ServerError::AuthFailed("Expected text frame".into()));
        }
    };

    let msg: ClientMessage =
        serde_json::from_str(&text).map_err(|e| ServerError::AuthFailed(e.to_string()))?;

    match msg {
        ClientMessage::Authenticate {
            username,
            password,
            service,
            identity,
            client_platform,
            client_version,
        } => {
            let client = ClientBuild::new(client_platform, client_version);
            if password != state.server_key {
                let reply = ServerMessage::AuthResult {
                    success: false,
                    player_id: None,
                    reconnected: None,
                    error: Some("Invalid server key".into()),
                    features: crate::protocol::FEATURES
                        .iter()
                        .map(|f| f.to_string())
                        .collect(),
                };
                send_msg(sender, &reply);
                return Err(ServerError::AuthFailed("Invalid server key".into()));
            }

            let resolved = match &identity {
                Some(proof) => state.identity.resolve(proof).await,
                None => identity::ResolvedIdentity::default(),
            };
            if resolved.stale_token {
                let reply = ServerMessage::AuthResult {
                    success: false,
                    player_id: None,
                    reconnected: None,
                    error: Some("identity token expired".into()),
                    features: crate::protocol::FEATURES
                        .iter()
                        .map(|f| f.to_string())
                        .collect(),
                };
                send_msg(sender, &reply);
                return Err(ServerError::AuthFailed("identity token expired".into()));
            }
            let identities = resolved.identities;
            let name_verified = resolved.name_verified;
            let qualification = resolved.qualification;
            let avatar_url = resolved.avatar_url;
            let username = resolved.name.unwrap_or(username);

            if username.trim().is_empty() {
                let reply = ServerMessage::AuthResult {
                    success: false,
                    player_id: None,
                    reconnected: None,
                    error: Some("Username cannot be empty".into()),
                    features: crate::protocol::FEATURES
                        .iter()
                        .map(|f| f.to_string())
                        .collect(),
                };
                send_msg(sender, &reply);
                return Err(ServerError::AuthFailed("Empty username".into()));
            }

            if let Some(session) = state.session_by_username(&username) {
                let claimed = identity::same_owner(&session.identity, &identities);
                let displaces = name_verified && !session.name_verified;
                let reclaimable =
                    !session.connected || session.sender_closed || claimed || displaces;

                if !reclaimable || (!session.identity.is_empty() && !claimed && !displaces) {
                    let reply = ServerMessage::AuthResult {
                        success: false,
                        player_id: None,
                        reconnected: None,
                        error: Some(format!("Username '{username}' is already taken")),
                        features: crate::protocol::FEATURES
                            .iter()
                            .map(|f| f.to_string())
                            .collect(),
                    };
                    send_msg(sender, &reply);
                    return Err(ServerError::DuplicateUsername(username));
                }

                if session.connected {
                    if session.sender_closed {
                        warn!(
                            "[auth] stale connected session detected for '{}' (id={}) -- forcing cleanup",
                            username,
                            &session.player_id[..8.min(session.player_id.len())]
                        );
                    } else {
                        info!(
                            "[auth] '{}' took over {} session (id={}, identity={})",
                            username,
                            if claimed { "its own" } else { "an unverified" },
                            &session.player_id[..8.min(session.player_id.len())],
                            identity::label(&identities),
                        );
                        metrics::record_session_takeover(identity::label(&identities));
                        evict(state, &session.player_id);
                    }
                }

                let new_gen = reclaim_session(
                    state,
                    sender,
                    &session.player_id,
                    &username,
                    session.room_id,
                    session.generation,
                    identities,
                    name_verified,
                    qualification,
                    avatar_url,
                    client.clone(),
                );
                return Ok((session.player_id, username, true, new_gen, client, service));
            }

            let player_id = uuid::Uuid::new_v4().to_string();
            let generation = 0u64;
            state.players.insert(
                player_id.clone(),
                ConnectedPlayer {
                    player_id: player_id.clone(),
                    username: username.clone(),
                    room_id: None,
                    sender: sender.clone(),
                    last_client_rtt_ms: None,
                    connected: true,
                    generation,
                    last_seen: Instant::now(),
                    disconnected_at: None,
                    is_service: service,
                    identity: identities,
                    name_verified,
                    qualification,
                    avatar_url,
                    client: client.clone(),
                    local_game: None,
                },
            );

            let reply = ServerMessage::AuthResult {
                success: true,
                player_id: Some(player_id.clone()),
                reconnected: Some(false),
                error: None,
                features: crate::protocol::FEATURES
                    .iter()
                    .map(|f| f.to_string())
                    .collect(),
            };
            send_msg(sender, &reply);
            broadcast_player_list(state);

            Ok((player_id, username, false, generation, client, service))
        }
        _ => {
            let reply = ServerMessage::AuthResult {
                success: false,
                player_id: None,
                reconnected: None,
                error: Some("First message must be Authenticate".into()),
                features: crate::protocol::FEATURES
                    .iter()
                    .map(|f| f.to_string())
                    .collect(),
            };
            send_msg(sender, &reply);
            Err(ServerError::AuthFailed(
                "First message was not Authenticate".into(),
            ))
        }
    }
}

fn evict(state: &Arc<ServerState>, player_id: &str) {
    if let Some(player) = state.players.get(player_id) {
        send_msg(&player.sender, &ServerMessage::SessionTakenOver);
        let _ = player.sender.send(Message::Close(None));
    }
}

#[allow(clippy::too_many_arguments)]
fn reclaim_session(
    state: &Arc<ServerState>,
    sender: &mpsc::UnboundedSender<Message>,
    existing_pid: &str,
    username: &str,
    room_id: Option<String>,
    old_gen: u64,
    identities: Vec<SessionIdentity>,
    name_verified: bool,
    qualification: Option<String>,
    avatar_url: Option<String>,
    client: ClientBuild,
) -> u64 {
    let new_gen = old_gen + 1;
    info!(
        "[auth] reclaiming session for '{}' (id={}, gen={})",
        username,
        &existing_pid[..8],
        new_gen
    );

    if let Some(mut player) = state.players.get_mut(existing_pid) {
        player.sender = sender.clone();
        player.connected = true;
        player.generation = new_gen;
        player.last_seen = Instant::now();
        player.disconnected_at = None;
        player.name_verified = name_verified;
        player.qualification = qualification;
        player.avatar_url = avatar_url;
        player.client = client;
        if !identities.is_empty() {
            player.identity = identities;
        }
    }

    let reply = ServerMessage::AuthResult {
        success: true,
        player_id: Some(existing_pid.to_string()),
        reconnected: Some(true),
        error: None,
        features: crate::protocol::FEATURES
            .iter()
            .map(|f| f.to_string())
            .collect(),
    };
    send_msg(sender, &reply);

    if let Some(rid) = &room_id {
        if let Some(mut room) = state.rooms.get_mut(rid) {
            room.set_connected(existing_pid, true);
        }

        broadcast_to_room_except(
            state,
            existing_pid,
            rid,
            &ServerMessage::PlayerConnected {
                username: username.to_string(),
            },
        );

        if let Some(room) = state.rooms.get(rid) {
            broadcast_to_room(
                state,
                rid,
                &ServerMessage::RoomUpdate {
                    room: room.to_room_info(),
                },
            );
        }

        let queued = state.rooms.get_mut(rid).and_then(|mut room| {
            let room = &mut *room;
            if room.status != RoomStatus::InGame {
                return None;
            }
            let replay = room.replay.as_ref()?;
            let inputs = replay.queued_inputs_for(username);
            (!inputs.is_empty()).then_some(inputs)
        });
        if let Some(inputs) = queued {
            info!(
                "[auth] flushing {} queued engine inputs to '{}'",
                inputs.len(),
                username
            );
            for input in inputs {
                send_msg(
                    sender,
                    &ServerMessage::StateUpdate {
                        from_player: input.from_player,
                        state: input.state,
                    },
                );
            }
        }
    }

    broadcast_player_list(state);
    new_gen
}

fn handle_client_message(
    state: &Arc<ServerState>,
    player_id: &str,
    username: &str,
    sender: &mpsc::UnboundedSender<Message>,
    msg: ClientMessage,
) {
    match msg {
        ClientMessage::Authenticate { .. } => {
            warn!(
                "[recv] '{}' sent Authenticate while already authenticated",
                username
            );
            send_msg(
                sender,
                &ServerMessage::Error {
                    code: "already_authenticated".into(),
                    message: "You are already authenticated".into(),
                },
            );
        }

        ClientMessage::Ping => send_msg(sender, &ServerMessage::Pong),

        ClientMessage::ListRooms => {
            let rooms: Vec<_> = state
                .rooms
                .iter()
                .map(|entry| entry.value().to_room_info())
                .collect();
            debug!("[emit] -> '{}': RoomList ({} rooms)", username, rooms.len());
            send_msg(sender, &ServerMessage::RoomList { rooms });
        }

        ClientMessage::SetLocalGame { kind } => {
            if let Some(mut player) = state.players.get_mut(player_id) {
                if player.local_game == kind {
                    return;
                }
                player.local_game = kind;
            } else {
                return;
            }
            broadcast_player_list(state);
        }

        ClientMessage::ListPlayers => {
            let players = player_list(state);
            debug!(
                "[emit] -> '{}': PlayerList ({} players)",
                username,
                players.len()
            );
            send_msg(sender, &ServerMessage::PlayerList { players });
        }

        ClientMessage::CreateRoom {
            room_name,
            max_players,
            format,
            protocol_version,
            hosted,
            engine,
            draft_config,
            sealed_config,
            official_key,
            password,
            reconnect_timeout_s,
        } => {
            info!(
                "[lobby] '{}' creating room '{}' (max={}, format={:?}, hosted={}, engine={:?}, draft={}, sealed={})",
                username,
                room_name,
                max_players,
                format,
                hosted,
                engine,
                draft_config.is_some(),
                sealed_config.is_some(),
            );
            match lobby::create_room_sync(
                state,
                player_id,
                room_name,
                max_players,
                format,
                protocol_version,
                hosted,
                engine,
                draft_config,
                sealed_config,
                official_key,
                password,
                reconnect_timeout_s,
            ) {
                Ok((info, resume_token)) => {
                    info!(
                        "[lobby] room created: {} (id={})",
                        info.room_name,
                        &info.room_id[..8]
                    );
                    send_msg(
                        sender,
                        &ServerMessage::RoomCreated {
                            room_id: info.room_id.clone(),
                            room_name: info.room_name.clone(),
                            room: info,
                            resume_token: Some(resume_token),
                        },
                    );
                }
                Err(e) => {
                    warn!("[lobby] '{}' create room failed: {}", username, e);
                    send_error(sender, &e);
                }
            }
        }

        ClientMessage::JoinRoom {
            room_id,
            observe,
            as_bot,
            password,
        } => {
            info!(
                "[lobby] '{}' joining room {} (observe={}, bot={})",
                username,
                &room_id[..8.min(room_id.len())],
                observe,
                as_bot
            );
            match lobby::join_room_sync(state, player_id, &room_id, observe, as_bot, password) {
                Ok((info, rejoined)) => {
                    if !rejoined {
                        state.analytics.emit(AnalyticsEvent::SeatJoined {
                            ts: analytics::now_ts(),
                            room_id: room_id.clone(),
                            username: username.to_string(),
                            is_bot: as_bot,
                            observer: observe,
                        });
                    }
                    if rejoined {
                        info!(
                            "[lobby] '{}' rejoined in-game room '{}'",
                            username, info.room_name
                        );
                        broadcast_to_room_except(
                            state,
                            player_id,
                            &room_id,
                            &ServerMessage::PlayerConnected {
                                username: username.to_string(),
                            },
                        );
                    } else {
                        info!("[lobby] '{}' joined room '{}'", username, info.room_name);
                        if !observe {
                            broadcast_to_room(
                                state,
                                &room_id,
                                &ServerMessage::PlayerJoined {
                                    room_id: room_id.clone(),
                                    username: username.to_string(),
                                },
                            );
                        }
                    }
                    broadcast_to_room(state, &room_id, &ServerMessage::RoomUpdate { room: info });
                }
                Err(e) => {
                    warn!("[lobby] '{}' join room failed: {}", username, e);
                    send_error(sender, &e);
                }
            }
        }

        ClientMessage::ResumeRoom(request) => {
            let room_id = request.room_id.clone();
            info!(
                "[lobby] '{}' resuming room {} (hosted={}, players={:?})",
                username,
                &room_id[..8.min(room_id.len())],
                request.hosted,
                request.player_order,
            );
            match lobby::resume_room_sync(state, player_id, request) {
                Ok(resumed) => {
                    info!(
                        "[lobby] room {} resumed by '{}' ({} seats awaiting rejoin)",
                        &room_id[..8],
                        username,
                        resumed.awaiting_rejoin.len()
                    );
                    send_msg(
                        sender,
                        &ServerMessage::RoomResumed {
                            room: resumed.room_info.clone(),
                        },
                    );
                    broadcast_to_room_except(
                        state,
                        player_id,
                        &room_id,
                        &ServerMessage::RoomUpdate {
                            room: resumed.room_info,
                        },
                    );
                }
                Err(e) => {
                    warn!("[lobby] '{}' resume room failed: {}", username, e);
                    send_error(sender, &e);
                }
            }
        }

        ClientMessage::LeaveRoom => {
            let room_id_before = state.players.get(player_id).and_then(|p| p.room_id.clone());

            info!("[lobby] '{}' leaving room", username);
            match lobby::leave_room_sync(state, player_id) {
                Ok(()) => {
                    if let Some(rid) = room_id_before {
                        info!("[lobby] '{}' left room {}", username, &rid[..8]);
                        state.analytics.emit(AnalyticsEvent::SeatLeft {
                            ts: analytics::now_ts(),
                            room_id: rid.clone(),
                            username: username.to_string(),
                        });
                        broadcast_to_room(
                            state,
                            &rid,
                            &ServerMessage::PlayerLeft {
                                room_id: rid.clone(),
                                username: username.to_string(),
                            },
                        );
                        if let Some(room) = state.rooms.get(&rid) {
                            broadcast_to_room(
                                state,
                                &rid,
                                &ServerMessage::RoomUpdate {
                                    room: room.to_room_info(),
                                },
                            );
                        }
                    }
                }
                Err(ServerError::NotInRoom) => {
                    info!("[lobby] '{}' already out of any room", username);
                }
                Err(e) => {
                    warn!("[lobby] '{}' leave room failed: {}", username, e);
                    send_error(sender, &e);
                }
            }
        }

        ClientMessage::SetReady { ready } => {
            info!("[lobby] '{}' set ready={}", username, ready);
            match lobby::set_ready_sync(state, player_id, ready) {
                Ok(room_id) => {
                    broadcast_to_room(
                        state,
                        &room_id,
                        &ServerMessage::ReadyStateChanged {
                            username: username.to_string(),
                            ready,
                        },
                    );
                    if let Some(room) = state.rooms.get(&room_id) {
                        broadcast_to_room(
                            state,
                            &room_id,
                            &ServerMessage::RoomUpdate {
                                room: room.to_room_info(),
                            },
                        );
                    }
                }
                Err(e) => {
                    warn!("[lobby] '{}' set ready failed: {}", username, e);
                    send_error(sender, &e);
                }
            }
        }

        ClientMessage::SetDeckSelection {
            deck_name,
            deck,
            published_deck_id,
            commander_name,
            avatar_url,
        } => {
            info!(
                "[lobby] '{}' selected deck '{}' ({} cards)",
                username,
                deck_name,
                deck.cards.len()
            );
            let deck_summary = state
                .analytics
                .events_enabled()
                .then(|| (analytics::aggregate_deck_cards(&deck), deck.sideboard.len()));
            match lobby::set_deck_selection_sync(
                state,
                player_id,
                deck_name.clone(),
                deck,
                published_deck_id,
                commander_name.clone(),
                avatar_url,
            ) {
                Ok(room_id) => {
                    if let Some((cards, sideboard_count)) = deck_summary {
                        let is_bot = state
                            .rooms
                            .get(&room_id)
                            .map(|room| {
                                room.players
                                    .iter()
                                    .any(|slot| slot.player_id == player_id && slot.is_bot)
                            })
                            .unwrap_or(false);
                        state.analytics.emit(AnalyticsEvent::DeckSelected {
                            ts: analytics::now_ts(),
                            room_id: room_id.clone(),
                            username: username.to_string(),
                            is_bot,
                            deck_name,
                            commander: commander_name,
                            cards,
                            sideboard_count,
                        });
                    }
                    if let Some(room) = state.rooms.get(&room_id) {
                        broadcast_to_room(
                            state,
                            &room_id,
                            &ServerMessage::RoomUpdate {
                                room: room.to_room_info(),
                            },
                        );
                    }
                }
                Err(e) => {
                    warn!("[lobby] '{}' set deck failed: {}", username, e);
                    send_error(sender, &e);
                }
            }
        }

        ClientMessage::SetFormat { format } => {
            info!("[lobby] '{}' set format={:?}", username, format);
            match lobby::set_format_sync(state, player_id, format) {
                Ok(room_id) => {
                    if let Some(room) = state.rooms.get(&room_id) {
                        broadcast_to_room(
                            state,
                            &room_id,
                            &ServerMessage::RoomUpdate {
                                room: room.to_room_info(),
                            },
                        );
                    }
                }
                Err(e) => {
                    warn!("[lobby] '{}' set format failed: {}", username, e);
                    send_error(sender, &e);
                }
            }
        }

        ClientMessage::SetMaxPlayers { max_players } => {
            info!("[lobby] '{}' set max_players={}", username, max_players);
            match lobby::set_max_players_sync(state, player_id, max_players) {
                Ok(room_id) => {
                    if let Some(room) = state.rooms.get(&room_id) {
                        broadcast_to_room(
                            state,
                            &room_id,
                            &ServerMessage::RoomUpdate {
                                room: room.to_room_info(),
                            },
                        );
                    }
                }
                Err(e) => {
                    warn!("[lobby] '{}' set max_players failed: {}", username, e);
                    send_error(sender, &e);
                }
            }
        }

        ClientMessage::StartGame { format } => {
            info!("[game] '{}' starting game", username);
            match lobby::start_game_sync(state, player_id, format) {
                Ok(started) => {
                    info!(
                        "[game] game started in room {} | order: {:?}",
                        &started.room_id[..8],
                        started.player_order
                    );
                    metrics::record_game_started(started.room_info.engine);
                    state.deck_play_events.game_started(&started);
                    state
                        .analytics
                        .emit(analytics::game_started_event(&started));
                    broadcast_to_room(
                        state,
                        &started.room_id,
                        &ServerMessage::RoomUpdate {
                            room: started.room_info,
                        },
                    );
                    broadcast_to_room(
                        state,
                        &started.room_id,
                        &ServerMessage::GameStarted {
                            room_id: started.room_id.clone(),
                            game_id: started.game_id,
                            player_order: started.player_order,
                            player_decks: started.player_decks,
                            starting_life: started.starting_life,
                        },
                    );
                }
                Err(e) => {
                    warn!("[game] '{}' start game failed: {}", username, e);
                    send_error(sender, &e);
                }
            }
        }

        ClientMessage::EndGame { game_id } => {
            match lobby::end_game_sync(state, player_id, &game_id) {
                Ok((room_id, info, notify)) => {
                    info!("[game] '{}' ended game in room {}", username, &room_id[..8]);
                    broadcast_to_room(state, &room_id, &ServerMessage::RoomUpdate { room: info });
                    let aborted = ServerMessage::GameAborted {
                        room_id: room_id.clone(),
                    };
                    if let Ok(json) = serde_json::to_string(&aborted) {
                        for pid in notify.iter().filter(|pid| pid.as_str() != player_id) {
                            emit_to(state, pid, &aborted, &json);
                        }
                    }
                }
                Err(e) => {
                    debug!("[game] '{}' end game ignored: {}", username, e);
                }
            }
        }

        ClientMessage::ReportEngineStats { game_id, stats } => {
            if !stats.is_plausible() {
                metrics::record_engine_report(metrics::ENGINE_REPORT_IMPLAUSIBLE);
                debug!(
                    "[analytics] '{}' sent an implausible engine report",
                    username
                );
                return;
            }
            let room_id = state.players.get(player_id).and_then(|p| p.room_id.clone());
            let Some(room_id) = room_id else {
                metrics::record_engine_report(metrics::ENGINE_REPORT_OUTSIDE_ROOM);
                debug!(
                    "[analytics] '{}' reported engine stats outside a room",
                    username
                );
                return;
            };
            metrics::record_engine_report(metrics::ENGINE_REPORT_ACCEPTED);
            state.analytics.emit(AnalyticsEvent::EngineStats {
                ts: analytics::now_ts(),
                room_id,
                username: username.to_string(),
                report_id: stats.report_id,
                game_id,
                engine: stats.engine,
                client_version: stats.client_version,
                platform: stats.platform,
                format: stats.format,
                seats: stats.seats,
                multiplayer: stats.multiplayer,
                duration_s: stats.duration_s,
                end_reason: stats.end_reason,
                decisions: stats.turnaround.n,
                turnaround_p50: stats.turnaround.p50,
                turnaround_p90: stats.turnaround.p90,
                turnaround_max: stats.turnaround.max,
                engine_p50: stats.engine_think.as_ref().map(|t| t.p50),
                engine_p90: stats.engine_think.as_ref().map(|t| t.p90),
                engine_max: stats.engine_think.as_ref().map(|t| t.max),
                engine_same_p50: stats.engine_think_same_turn.as_ref().map(|t| t.p50),
                engine_same_p90: stats.engine_think_same_turn.as_ref().map(|t| t.p90),
                engine_same_max: stats.engine_think_same_turn.as_ref().map(|t| t.max),
                engine_cross_p50: stats.engine_think_cross_turn.as_ref().map(|t| t.p50),
                engine_cross_p90: stats.engine_think_cross_turn.as_ref().map(|t| t.p90),
                engine_cross_max: stats.engine_think_cross_turn.as_ref().map(|t| t.max),
                think_hidden: stats.think_samples_hidden,
            });
        }

        ClientMessage::RequestResync => {
            let room_id = { state.players.get(player_id).and_then(|p| p.room_id.clone()) };
            let replayed = room_id.and_then(|rid| {
                let room = state.rooms.get(&rid)?;
                if room.status != RoomStatus::InGame {
                    return None;
                }
                let replay = room.replay.as_ref()?;
                let mut messages = vec![ServerMessage::GameStarted {
                    room_id: rid.clone(),
                    game_id: replay.game_id.clone(),
                    player_order: replay.player_order.clone(),
                    player_decks: replay.player_decks.clone(),
                    starting_life: replay.starting_life,
                }];
                let seat_state = replay
                    .slot_for(username)
                    .and_then(|slot| replay.last_state_by_slot.get(&slot).cloned())
                    .or_else(|| replay.last_state.clone());
                if let Some(state_env) = seat_state {
                    messages.push(ServerMessage::StateUpdate {
                        from_player: room.host_username(),
                        state: state_env,
                    });
                }
                if let Some(prompt) = replay
                    .slot_for(username)
                    .and_then(|slot| replay.pending_prompts.get(&slot).cloned())
                {
                    messages.push(ServerMessage::StateUpdate {
                        from_player: room.host_username(),
                        state: prompt,
                    });
                }
                Some(messages)
            });
            match replayed {
                Some(messages) => {
                    info!("[game] '{}' resync ({} messages)", username, messages.len());
                    metrics::record_resync();
                    for msg in &messages {
                        send_msg(sender, msg);
                    }
                }
                None => {
                    send_error(sender, &ServerError::GameNotInProgress);
                }
            }
        }

        ClientMessage::BroadcastState {
            state: game_state,
            target_player,
        } => {
            let handling_started = Instant::now();
            let room_id = { state.players.get(player_id).and_then(|p| p.room_id.clone()) };
            if let Some(rid) = room_id {
                let Some(mut room) = state.rooms.get_mut(&rid) else {
                    return;
                };
                let Some(source) = authorize_game_message(&room, player_id, username, &game_state)
                else {
                    warn!(username, "rejected unauthorized game envelope");
                    return;
                };
                if source != GameMessageSource::RoomRelay && room.status != RoomStatus::InGame {
                    return;
                }
                let host_username = room.host_username();
                let host_connected = room.host_connected();
                let canonical_target = if source == GameMessageSource::Player {
                    Some(host_username.clone())
                } else {
                    target_player
                };
                let should_deliver = source != GameMessageSource::Player || host_connected;
                let capture_game_id = room.replay.as_mut().and_then(|replay| {
                    if source == GameMessageSource::Engine {
                        replay.acknowledge_inputs(&host_username);
                    }
                    replay.observe(&game_state);
                    if source == GameMessageSource::Player {
                        replay.queue_input(&host_username, username, game_state.clone());
                    }
                    state
                        .analytics
                        .capture_enabled()
                        .then(|| replay.game_id.clone())
                });
                let seats = room.players.len();
                let folded_state = (is_state_patch(&game_state)
                    && !state_patch_audience_ready(
                        state,
                        &room,
                        player_id,
                        canonical_target.as_deref(),
                    ))
                .then(|| {
                    room.replay
                        .as_ref()
                        .and_then(|replay| replay.state_after(&game_state).cloned())
                })
                .flatten();
                drop(room);
                if let Some(game_id) = capture_game_id {
                    // Only a player's own envelope carries a link that is theirs.
                    // On an engine envelope `username` is the node.
                    let client_rtt_ms = (source == GameMessageSource::Player)
                        .then(|| {
                            state
                                .players
                                .get(player_id)
                                .and_then(|player| player.last_client_rtt_ms)
                        })
                        .flatten();
                    state.analytics.capture_envelope(
                        &game_id,
                        username,
                        &game_state,
                        client_rtt_ms,
                    );
                }
                if !should_deliver {
                    metrics::record_state_handling(seats, handling_started.elapsed());
                    return;
                }
                let game_state = match folded_state {
                    Some(full) => {
                        metrics::record_state_patch_downgrade();
                        full
                    }
                    None => game_state,
                };
                let msg = ServerMessage::StateUpdate {
                    from_player: username.to_string(),
                    state: game_state,
                };
                match canonical_target {
                    Some(target) => {
                        debug!(
                            "[game] '{}' sending state to '{}' in room {}",
                            username,
                            target,
                            &rid[..8]
                        );
                        send_to_room_player(state, &rid, &target, &msg);
                    }
                    None => {
                        debug!(
                            "[game] '{}' broadcasting state to room {}",
                            username,
                            &rid[..8]
                        );
                        broadcast_to_room_except(state, player_id, &rid, &msg);
                    }
                }
                metrics::record_state_handling(seats, handling_started.elapsed());
            } else {
                warn!(
                    "[game] '{}' tried to broadcast state but not in a room",
                    username
                );
                send_error(sender, &ServerError::NotInRoom);
            }
        }

        ClientMessage::TurnChange {
            new_active_player,
            turn_number,
        } => {
            let room_id = { state.players.get(player_id).and_then(|p| p.room_id.clone()) };
            if let Some(rid) = room_id {
                let engine_host = state.rooms.get(&rid).is_some_and(|room| {
                    room.status == RoomStatus::InGame && room.is_host(player_id)
                });
                if !engine_host {
                    send_error(sender, &ServerError::NotHost);
                    return;
                }
                info!(
                    "[game] turn change in room {}: '{}' -> '{}' (turn {})",
                    &rid[..8],
                    username,
                    new_active_player,
                    turn_number
                );
                broadcast_to_room_except(
                    state,
                    player_id,
                    &rid,
                    &ServerMessage::TurnChanged {
                        from_player: username.to_string(),
                        new_active_player,
                        turn_number,
                    },
                );
            } else {
                warn!("[game] '{}' tried turn change but not in a room", username);
                send_error(sender, &ServerError::NotInRoom);
            }
        }
    }
}

fn get_username(state: &Arc<ServerState>, player_id: &str) -> String {
    state
        .players
        .get(player_id)
        .map(|p| p.username.clone())
        .unwrap_or_default()
}

fn msg_type_of(msg: &ServerMessage) -> &'static str {
    match msg {
        ServerMessage::Pong => "Pong",
        ServerMessage::AuthResult { .. } => "AuthResult",
        ServerMessage::SessionTakenOver => "SessionTakenOver",
        ServerMessage::RoomList { .. } => "RoomList",
        ServerMessage::PlayerList { .. } => "PlayerList",
        ServerMessage::RoomCreated { .. } => "RoomCreated",
        ServerMessage::RoomResumed { .. } => "RoomResumed",
        ServerMessage::PlayerJoined { .. } => "PlayerJoined",
        ServerMessage::PlayerLeft { .. } => "PlayerLeft",
        ServerMessage::PlayerConnected { .. } => "PlayerConnected",
        ServerMessage::PlayerDisconnected { .. } => "PlayerDisconnected",
        ServerMessage::ReadyStateChanged { .. } => "ReadyStateChanged",
        ServerMessage::RoomUpdate { .. } => "RoomUpdate",
        ServerMessage::GameStarted { .. } => "GameStarted",
        ServerMessage::StateUpdate { .. } => "StateUpdate",
        ServerMessage::TurnChanged { .. } => "TurnChanged",
        ServerMessage::GameAborted { .. } => "GameAborted",
        ServerMessage::Error { .. } => "Error",
        ServerMessage::ServerShuttingDown { .. } => "ServerShuttingDown",
    }
}

fn client_msg_type(msg: &ClientMessage) -> &'static str {
    match msg {
        ClientMessage::Authenticate { .. } => "Authenticate",
        ClientMessage::Ping => "Ping",
        ClientMessage::ListRooms => "ListRooms",
        ClientMessage::ListPlayers => "ListPlayers",
        ClientMessage::SetLocalGame { .. } => "SetLocalGame",
        ClientMessage::CreateRoom { .. } => "CreateRoom",
        ClientMessage::JoinRoom { .. } => "JoinRoom",
        ClientMessage::ResumeRoom { .. } => "ResumeRoom",
        ClientMessage::LeaveRoom => "LeaveRoom",
        ClientMessage::SetReady { .. } => "SetReady",
        ClientMessage::SetDeckSelection { .. } => "SetDeckSelection",
        ClientMessage::SetFormat { .. } => "SetFormat",
        ClientMessage::SetMaxPlayers { .. } => "SetMaxPlayers",
        ClientMessage::StartGame { .. } => "StartGame",
        ClientMessage::EndGame { .. } => "EndGame",
        ClientMessage::ReportEngineStats { .. } => "ReportEngineStats",
        ClientMessage::RequestResync => "RequestResync",
        ClientMessage::BroadcastState { .. } => "BroadcastState",
        ClientMessage::TurnChange { .. } => "TurnChange",
    }
}
