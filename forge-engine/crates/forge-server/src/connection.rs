use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, info, warn};

use crate::error::ServerError;
use crate::lobby;
use crate::protocol::{ClientMessage, RoomStatus, ServerMessage};
use crate::state::{ConnectedPlayer, ServerState};

type WsSender = futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    tokio_tungstenite::tungstenite::Message,
>;

type WsReceiver =
    futures_util::stream::SplitStream<tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>>;

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(25);
const READ_IDLE_TIMEOUT: Duration = Duration::from_secs(90);

/// Background task: drains channel and writes to the WebSocket sink.
async fn write_loop(mut rx: mpsc::UnboundedReceiver<Message>, mut sink: WsSender) {
    while let Some(msg) = rx.recv().await {
        if sink.send(msg).await.is_err() {
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

fn emit_to(state: &Arc<ServerState>, player_id: &str, msg: &ServerMessage, json: &str) {
    if let Some(player) = state.players.get(player_id) {
        if player.connected {
            debug!("[emit] -> '{}': {}", player.username, msg_type_of(msg));
            let _ = player.sender.send(Message::Text(json.to_string()));
        }
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

    let write_task = tokio::spawn(write_loop(rx, sink));

    let (player_id, username, reconnected, generation) =
        match authenticate(&mut receiver, &tx, &state).await {
            Ok(result) => result,
            Err(e) => {
                warn!("[auth] failed from {}: {}", addr, e);
                return Err(e);
            }
        };

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
    let heartbeat_task = tokio::spawn(async move {
        let mut ticker = tokio::time::interval(HEARTBEAT_INTERVAL);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            ticker.tick().await;
            if heartbeat_tx.send(Message::Ping(Vec::new())).is_err() {
                break;
            }
        }
    });

    loop {
        let frame = match tokio::time::timeout(READ_IDLE_TIMEOUT, receiver.next()).await {
            Ok(Some(Ok(f))) => f,
            Ok(Some(Err(e))) => {
                warn!("[recv] read error from '{}': {}", username, e);
                break;
            }
            Ok(None) => {
                info!("[recv] '{}' stream closed", username);
                break;
            }
            Err(_) => {
                warn!(
                    "[recv] idle timeout from '{}' (no frames for {}s)",
                    username,
                    READ_IDLE_TIMEOUT.as_secs()
                );
                break;
            }
        };

        match frame {
            Message::Text(text) => {
                let client_msg: ClientMessage = match serde_json::from_str(&text) {
                    Ok(m) => m,
                    Err(e) => {
                        warn!("[recv] parse error from '{}': {}", username, e);
                        let err_msg = ServerMessage::Error {
                            code: "parse_error".into(),
                            message: e.to_string(),
                        };
                        send_msg(&tx, &err_msg);
                        continue;
                    }
                };
                debug!("[recv] '{}' -> {}", username, client_msg_type(&client_msg));
                handle_client_message(&state, &player_id, &username, &tx, client_msg);
            }
            Message::Close(_) => {
                info!("[recv] '{}' sent close frame", username);
                break;
            }
            Message::Ping(data) => {
                debug!("[recv] '{}' ping", username);
                let _ = tx.send(Message::Pong(data));
            }
            Message::Pong(_) => {
                debug!("[recv] '{}' pong", username);
            }
            _ => {}
        }
    }

    info!("[disconnect] '{}' (id={})", username, &player_id[..8]);
    mark_disconnected(&state, &player_id, generation);

    // Tear down background tasks after we have marked the player disconnected.
    // Do not wait on write_loop via channel close: sender clones are stored in
    // ServerState for reconnection, so rx may never close on abrupt disconnects.
    heartbeat_task.abort();
    drop(tx);
    write_task.abort();
    let _ = write_task.await;
    Ok(())
}

async fn authenticate(
    receiver: &mut WsReceiver,
    sender: &mpsc::UnboundedSender<Message>,
    state: &Arc<ServerState>,
) -> Result<(String, String, bool, u64), ServerError> {
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
        ClientMessage::Authenticate { username, password } => {
            if password != state.server_key {
                let reply = ServerMessage::AuthResult {
                    success: false,
                    player_id: None,
                    reconnected: None,
                    error: Some("Invalid server key".into()),
                };
                send_msg(sender, &reply);
                return Err(ServerError::AuthFailed("Invalid server key".into()));
            }

            if username.trim().is_empty() {
                let reply = ServerMessage::AuthResult {
                    success: false,
                    player_id: None,
                    reconnected: None,
                    error: Some("Username cannot be empty".into()),
                };
                send_msg(sender, &reply);
                return Err(ServerError::AuthFailed("Empty username".into()));
            }

            if let Some((existing_pid, room_id, old_gen)) =
                state.find_disconnected_by_username(&username)
            {
                let new_gen = old_gen + 1;
                info!(
                    "[auth] reclaiming session for '{}' (id={}, gen={})",
                    username,
                    &existing_pid[..8],
                    new_gen
                );

                if let Some(mut player) = state.players.get_mut(&existing_pid) {
                    player.sender = sender.clone();
                    player.connected = true;
                    player.generation = new_gen;
                }

                let reply = ServerMessage::AuthResult {
                    success: true,
                    player_id: Some(existing_pid.clone()),
                    reconnected: Some(true),
                    error: None,
                };
                send_msg(sender, &reply);

                if let Some(rid) = &room_id {
                    if let Some(mut room) = state.rooms.get_mut(rid) {
                        room.set_connected(&existing_pid, true);
                    }

                    broadcast_to_room_except(
                        state,
                        &existing_pid,
                        rid,
                        &ServerMessage::PlayerConnected {
                            username: username.clone(),
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
                }

                return Ok((existing_pid, username, true, new_gen));
            }

            // If a "connected" entry exists but its outbound channel is already closed,
            // it is stale and can be safely released before duplicate-username rejection.
            if let Some((existing_pid, existing_gen, sender_closed)) =
                state.find_connected_by_username(&username)
            {
                if sender_closed {
                    warn!(
                        "[auth] stale connected session detected for '{}' (id={}) -- forcing cleanup",
                        username,
                        &existing_pid[..8.min(existing_pid.len())]
                    );
                    mark_disconnected(state, &existing_pid, existing_gen);

                    if let Some((reclaim_pid, room_id, old_gen)) =
                        state.find_disconnected_by_username(&username)
                    {
                        let new_gen = old_gen + 1;
                        info!(
                            "[auth] reclaiming session for '{}' (id={}, gen={})",
                            username,
                            &reclaim_pid[..8],
                            new_gen
                        );

                        if let Some(mut player) = state.players.get_mut(&reclaim_pid) {
                            player.sender = sender.clone();
                            player.connected = true;
                            player.generation = new_gen;
                        }

                        let reply = ServerMessage::AuthResult {
                            success: true,
                            player_id: Some(reclaim_pid.clone()),
                            reconnected: Some(true),
                            error: None,
                        };
                        send_msg(sender, &reply);

                        if let Some(rid) = &room_id {
                            if let Some(mut room) = state.rooms.get_mut(rid) {
                                room.set_connected(&reclaim_pid, true);
                            }

                            broadcast_to_room_except(
                                state,
                                &reclaim_pid,
                                rid,
                                &ServerMessage::PlayerConnected {
                                    username: username.clone(),
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
                        }

                        return Ok((reclaim_pid, username, true, new_gen));
                    }
                }
            }

            // TODO: Per ora username unique quindi n'se po' ripetere
            if state.username_taken_by_connected(&username) {
                let reply = ServerMessage::AuthResult {
                    success: false,
                    player_id: None,
                    reconnected: None,
                    error: Some(format!("Username '{}' is already taken", username)),
                };
                send_msg(sender, &reply);
                return Err(ServerError::DuplicateUsername(username));
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
                    connected: true,
                    generation,
                },
            );

            let reply = ServerMessage::AuthResult {
                success: true,
                player_id: Some(player_id.clone()),
                reconnected: Some(false),
                error: None,
            };
            send_msg(sender, &reply);

            Ok((player_id, username, false, generation))
        }
        _ => {
            let reply = ServerMessage::AuthResult {
                success: false,
                player_id: None,
                reconnected: None,
                error: Some("First message must be Authenticate".into()),
            };
            send_msg(sender, &reply);
            Err(ServerError::AuthFailed(
                "First message was not Authenticate".into(),
            ))
        }
    }
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

        ClientMessage::Ping => {}

        ClientMessage::ListRooms => {
            let rooms: Vec<_> = state
                .rooms
                .iter()
                .map(|entry| entry.value().to_room_info())
                .collect();
            debug!("[emit] -> '{}': RoomList ({} rooms)", username, rooms.len());
            send_msg(sender, &ServerMessage::RoomList { rooms });
        }

        ClientMessage::ListPlayers => {
            let players: Vec<_> = state
                .players
                .iter()
                .map(|entry| crate::protocol::PlayerInfo {
                    username: entry.value().username.clone(),
                    player_id: entry.value().player_id.clone(),
                    connected: entry.value().connected,
                    room_id: entry.value().room_id.clone(),
                })
                .collect();
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
            hosted,
        } => {
            info!(
                "[lobby] '{}' creating room '{}' (max={}, format={:?}, hosted={})",
                username, room_name, max_players, format, hosted
            );
            match lobby::create_room_sync(state, player_id, room_name, max_players, format, hosted)
            {
                Ok(info) => {
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
                        },
                    );
                    send_msg(sender, &ServerMessage::RoomUpdate { room: info });
                }
                Err(e) => {
                    warn!("[lobby] '{}' create room failed: {}", username, e);
                    send_msg(
                        sender,
                        &ServerMessage::Error {
                            code: e.code().into(),
                            message: e.to_string(),
                        },
                    );
                }
            }
        }

        ClientMessage::JoinRoom { room_id, observe } => {
            info!(
                "[lobby] '{}' joining room {} (observe={})",
                username,
                &room_id[..8.min(room_id.len())],
                observe
            );
            match lobby::join_room_sync(state, player_id, &room_id, observe) {
                Ok(info) => {
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
                    broadcast_to_room(state, &room_id, &ServerMessage::RoomUpdate { room: info });
                }
                Err(e) => {
                    warn!("[lobby] '{}' join room failed: {}", username, e);
                    send_msg(
                        sender,
                        &ServerMessage::Error {
                            code: e.code().into(),
                            message: e.to_string(),
                        },
                    );
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
                Err(e) => {
                    warn!("[lobby] '{}' leave room failed: {}", username, e);
                    send_msg(
                        sender,
                        &ServerMessage::Error {
                            code: e.code().into(),
                            message: e.to_string(),
                        },
                    );
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
                    send_msg(
                        sender,
                        &ServerMessage::Error {
                            code: e.code().into(),
                            message: e.to_string(),
                        },
                    );
                }
            }
        }

        ClientMessage::SetDeckSelection {
            deck_name,
            deck,
            commander_name,
        } => {
            info!(
                "[lobby] '{}' selected deck '{}' ({} cards)",
                username,
                deck_name,
                deck.cards.len()
            );
            match lobby::set_deck_selection_sync(
                state,
                player_id,
                deck_name,
                deck,
                commander_name,
            ) {
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
                    warn!("[lobby] '{}' set deck failed: {}", username, e);
                    send_msg(
                        sender,
                        &ServerMessage::Error {
                            code: e.code().into(),
                            message: e.to_string(),
                        },
                    );
                }
            }
        }

        ClientMessage::StartGame => {
            info!("[game] '{}' starting game", username);
            match lobby::start_game_sync(state, player_id) {
                Ok((room_id, player_order, player_decks, starting_life)) => {
                    info!(
                        "[game] game started in room {} | order: {:?}",
                        &room_id[..8],
                        player_order
                    );
                    broadcast_to_room(
                        state,
                        &room_id,
                        &ServerMessage::GameStarted {
                            room_id: room_id.clone(),
                            player_order,
                            player_decks,
                            starting_life,
                        },
                    );
                }
                Err(e) => {
                    warn!("[game] '{}' start game failed: {}", username, e);
                    send_msg(
                        sender,
                        &ServerMessage::Error {
                            code: e.code().into(),
                            message: e.to_string(),
                        },
                    );
                }
            }
        }

        ClientMessage::BroadcastState { state: game_state } => {
            let room_id = { state.players.get(player_id).and_then(|p| p.room_id.clone()) };
            if let Some(rid) = room_id {
                debug!(
                    "[game] '{}' broadcasting state to room {}",
                    username,
                    &rid[..8]
                );
                broadcast_to_room_except(
                    state,
                    player_id,
                    &rid,
                    &ServerMessage::StateUpdate {
                        from_player: username.to_string(),
                        state: game_state,
                    },
                );
            } else {
                warn!(
                    "[game] '{}' tried to broadcast state but not in a room",
                    username
                );
                send_msg(
                    sender,
                    &ServerMessage::Error {
                        code: "not_in_room".into(),
                        message: "You are not in a room".into(),
                    },
                );
            }
        }

        ClientMessage::TurnChange {
            new_active_player,
            turn_number,
        } => {
            let room_id = { state.players.get(player_id).and_then(|p| p.room_id.clone()) };
            if let Some(rid) = room_id {
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
                send_msg(
                    sender,
                    &ServerMessage::Error {
                        code: "not_in_room".into(),
                        message: "You are not in a room".into(),
                    },
                );
            }
        }
    }
}

fn mark_disconnected(state: &Arc<ServerState>, player_id: &str, our_generation: u64) {
    let (username, room_id) = {
        if let Some(mut player) = state.players.get_mut(player_id) {
            if player.generation != our_generation {
                info!(
                    "[disconnect] '{}' old connection cleaned up (session reclaimed by new connection)",
                    player.username
                );
                return;
            }
            player.connected = false;
            (player.username.clone(), player.room_id.clone())
        } else {
            return;
        }
    };

    if let Some(rid) = &room_id {
        let room_status = state.rooms.get(rid).map(|r| r.status.clone());

        match room_status {
            Some(RoomStatus::InGame) => {
                // InGame: always preserve session for reconnection.
                let host_without_player = state
                    .rooms
                    .get(rid)
                    .map(|room| room.is_host(player_id) && !room.host_is_player())
                    .unwrap_or(false);
                if host_without_player {
                    info!(
                        "[cleanup] hosted in-game room {} lost its non-playing host -- removing",
                        &rid[..8]
                    );
                    remove_room_and_clear_sessions(state, rid);
                    return;
                }

                let all_disconnected = if let Some(mut room) = state.rooms.get_mut(rid) {
                    room.set_connected(player_id, false);
                    room.all_disconnected()
                } else {
                    return;
                };

                if all_disconnected {
                    info!(
                        "[cleanup] in-game room {} has no connected players -- removing",
                        &rid[..8]
                    );
                    state.rooms.remove(rid);
                    let player_ids = state
                        .players
                        .iter()
                        .filter_map(|entry| {
                            entry
                                .value()
                                .room_id
                                .as_deref()
                                .is_some_and(|room_id| room_id == rid)
                                .then(|| entry.key().clone())
                        })
                        .collect::<Vec<_>>();
                    for player_id in player_ids {
                        state.players.remove(&player_id);
                    }
                    return;
                }

                info!(
                    "[disconnect] '{}' marked disconnected in in-game room {} (session preserved)",
                    username,
                    &rid[..8]
                );
                broadcast_to_room(
                    state,
                    rid,
                    &ServerMessage::PlayerDisconnected {
                        username: username.clone(),
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
            }
            Some(RoomStatus::Lobby) => {
                // Lobby: treat like a leave — remove player, clean up room, free username
                info!(
                    "[disconnect] '{}' disconnected from lobby room {} -- treating as leave",
                    username,
                    &rid[..8]
                );

                let remove_hosted_room = state
                    .rooms
                    .get(rid)
                    .map(|room| room.is_host(player_id) && !room.host_is_player())
                    .unwrap_or(false);
                if remove_hosted_room {
                    info!(
                        "[cleanup] hosted lobby room {} lost its non-playing host -- removing",
                        &rid[..8]
                    );
                    remove_room_and_clear_sessions(state, rid);
                    return;
                }

                let room_empty = {
                    if let Some(mut room) = state.rooms.get_mut(rid) {
                        room.remove_participant(player_id);
                        room.is_empty()
                    } else {
                        false
                    }
                };

                if let Some(mut player) = state.players.get_mut(player_id) {
                    player.room_id = None;
                }

                if room_empty {
                    info!(
                        "[cleanup] lobby room {} is now empty -- removing",
                        &rid[..8]
                    );
                    remove_room_and_clear_sessions(state, rid);
                } else {
                    broadcast_to_room(
                        state,
                        rid,
                        &ServerMessage::PlayerLeft {
                            room_id: rid.clone(),
                            username: username.clone(),
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
                }

                info!("[cleanup] '{}' removed (disconnected from lobby)", username);
                state.players.remove(player_id);
            }
            None => {
                info!("[cleanup] '{}' removed (room no longer exists)", username);
                state.players.remove(player_id);
            }
        }
    } else {
        info!("[cleanup] '{}' removed (was not in a room)", username);
        state.players.remove(player_id);
    }
}

fn get_username(state: &Arc<ServerState>, player_id: &str) -> String {
    state
        .players
        .get(player_id)
        .map(|p| p.username.clone())
        .unwrap_or_default()
}

fn remove_room_and_clear_sessions(state: &Arc<ServerState>, room_id: &str) {
    state.rooms.remove(room_id);
    let player_ids = state
        .players
        .iter()
        .filter_map(|entry| {
            entry
                .value()
                .room_id
                .as_deref()
                .is_some_and(|rid| rid == room_id)
                .then(|| entry.key().clone())
        })
        .collect::<Vec<_>>();
    for player_id in player_ids {
        state.players.remove(&player_id);
    }
}

fn msg_type_of(msg: &ServerMessage) -> &'static str {
    match msg {
        ServerMessage::AuthResult { .. } => "AuthResult",
        ServerMessage::RoomList { .. } => "RoomList",
        ServerMessage::PlayerList { .. } => "PlayerList",
        ServerMessage::RoomCreated { .. } => "RoomCreated",
        ServerMessage::PlayerJoined { .. } => "PlayerJoined",
        ServerMessage::PlayerLeft { .. } => "PlayerLeft",
        ServerMessage::PlayerConnected { .. } => "PlayerConnected",
        ServerMessage::PlayerDisconnected { .. } => "PlayerDisconnected",
        ServerMessage::ReadyStateChanged { .. } => "ReadyStateChanged",
        ServerMessage::RoomUpdate { .. } => "RoomUpdate",
        ServerMessage::GameStarted { .. } => "GameStarted",
        ServerMessage::StateUpdate { .. } => "StateUpdate",
        ServerMessage::TurnChanged { .. } => "TurnChanged",
        ServerMessage::Error { .. } => "Error",
    }
}

fn client_msg_type(msg: &ClientMessage) -> &'static str {
    match msg {
        ClientMessage::Authenticate { .. } => "Authenticate",
        ClientMessage::Ping => "Ping",
        ClientMessage::ListRooms => "ListRooms",
        ClientMessage::ListPlayers => "ListPlayers",
        ClientMessage::CreateRoom { .. } => "CreateRoom",
        ClientMessage::JoinRoom { .. } => "JoinRoom",
        ClientMessage::LeaveRoom => "LeaveRoom",
        ClientMessage::SetReady { .. } => "SetReady",
        ClientMessage::SetDeckSelection { .. } => "SetDeckSelection",
        ClientMessage::StartGame => "StartGame",
        ClientMessage::BroadcastState { .. } => "BroadcastState",
        ClientMessage::TurnChange { .. } => "TurnChange",
    }
}
