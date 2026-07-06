use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, info, warn};

use crate::analytics::{self, AnalyticsEvent};
use crate::cleanup::mark_disconnected;
use crate::error::ServerError;
use crate::lobby;
use crate::metrics;
use crate::protocol::{ClientMessage, RoomStatus, ServerMessage};
use crate::state::{ConnectedPlayer, ServerState};
use manabrew_protocol::deck_dto::OUTDATED_CLIENT_MESSAGE;

type WsSender = futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    tokio_tungstenite::tungstenite::Message,
>;

type WsReceiver =
    futures_util::stream::SplitStream<tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>>;

pub(crate) const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(25);
pub(crate) const READ_IDLE_TIMEOUT: Duration = Duration::from_secs(90);

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

    let mut write_task = tokio::spawn(write_loop(rx, sink));

    let (player_id, username, reconnected, generation) =
        match authenticate(&mut receiver, &tx, &state).await {
            Ok(result) => result,
            Err(e) => {
                warn!("[auth] failed from {}: {}", addr, e);
                metrics::record_rejection(e.code());
                drop(tx);
                let _ = write_task.await;
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

    let mut write_task_done = false;
    let connected_at = Instant::now();
    let disconnect_reason: &str;

    loop {
        let read = tokio::time::timeout(READ_IDLE_TIMEOUT, receiver.next());
        let frame = tokio::select! {
            frame = read => match frame {
                Ok(Some(Ok(f))) => f,
                Ok(Some(Err(e))) => {
                    warn!("[recv] read error from '{}': {}", username, e);
                    disconnect_reason = "read_error";
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
            Message::Pong(_) => {
                debug!("[recv] '{}' pong", username);
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
        ClientMessage::Authenticate {
            username,
            password,
            service,
        } => {
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
                let new_gen =
                    reclaim_session(state, sender, &existing_pid, &username, room_id, old_gen);
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
                        let new_gen = reclaim_session(
                            state,
                            sender,
                            &reclaim_pid,
                            &username,
                            room_id,
                            old_gen,
                        );
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
                    last_seen: Instant::now(),
                    disconnected_at: None,
                    is_service: service,
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

fn reclaim_session(
    state: &Arc<ServerState>,
    sender: &mpsc::UnboundedSender<Message>,
    existing_pid: &str,
    username: &str,
    room_id: Option<String>,
    old_gen: u64,
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
    }

    let reply = ServerMessage::AuthResult {
        success: true,
        player_id: Some(existing_pid.to_string()),
        reconnected: Some(true),
        error: None,
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
            let replay = room.replay.as_mut()?;
            let responses = replay.take_queued_responses(username);
            (!responses.is_empty()).then(|| (room.host_username(), responses))
        });
        if let Some((host_username, responses)) = queued {
            info!(
                "[auth] flushing {} queued responses to '{}'",
                responses.len(),
                username
            );
            for response in responses {
                send_msg(
                    sender,
                    &ServerMessage::StateUpdate {
                        from_player: host_username.clone(),
                        state: response,
                    },
                );
            }
        }
    }

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
                .filter(|entry| !entry.value().is_service)
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
                            resume_token: Some(resume_token),
                        },
                    );
                    send_msg(sender, &ServerMessage::RoomUpdate { room: info });
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
                    for seat in resumed.awaiting_rejoin {
                        crate::cleanup::schedule_seat_rejoin_abort(
                            state.clone(),
                            room_id.clone(),
                            seat,
                        );
                    }
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
            commander_name,
            avatar,
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
                commander_name.clone(),
                avatar,
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

        ClientMessage::EndGame => match lobby::end_game_sync(state, player_id) {
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
        },

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
                    player_order: replay.player_order.clone(),
                    player_decks: replay.player_decks.clone(),
                    starting_life: replay.starting_life,
                }];
                if let Some(state_env) = replay.last_state.clone() {
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

        ClientMessage::BroadcastState { state: game_state } => {
            let room_id = { state.players.get(player_id).and_then(|p| p.room_id.clone()) };
            if let Some(rid) = room_id {
                let capture_game_id = state.rooms.get_mut(&rid).and_then(|mut room| {
                    let room = &mut *room;
                    if room.status != RoomStatus::InGame {
                        return None;
                    }
                    let replay = room.replay.as_mut()?;
                    replay.observe(&game_state, &room.players);
                    state
                        .analytics
                        .capture_enabled()
                        .then(|| replay.game_id.clone())
                });
                if let Some(game_id) = capture_game_id {
                    state
                        .analytics
                        .capture_envelope(&game_id, username, &game_state);
                }
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
                send_error(sender, &ServerError::NotInRoom);
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
        ServerMessage::AuthResult { .. } => "AuthResult",
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
        ClientMessage::CreateRoom { .. } => "CreateRoom",
        ClientMessage::JoinRoom { .. } => "JoinRoom",
        ClientMessage::ResumeRoom { .. } => "ResumeRoom",
        ClientMessage::LeaveRoom => "LeaveRoom",
        ClientMessage::SetReady { .. } => "SetReady",
        ClientMessage::SetDeckSelection { .. } => "SetDeckSelection",
        ClientMessage::SetFormat { .. } => "SetFormat",
        ClientMessage::SetMaxPlayers { .. } => "SetMaxPlayers",
        ClientMessage::StartGame { .. } => "StartGame",
        ClientMessage::EndGame => "EndGame",
        ClientMessage::RequestResync => "RequestResync",
        ClientMessage::BroadcastState { .. } => "BroadcastState",
        ClientMessage::TurnChange { .. } => "TurnChange",
    }
}
