use std::sync::Arc;
use std::time::{Duration, Instant};

use tracing::{info, warn};

use crate::connection::{broadcast_to_room, emit_to};
use crate::protocol::{RoomStatus, ServerMessage};
use crate::room::Room;
use crate::state::ServerState;

const CLEANUP_INTERVAL: Duration = Duration::from_secs(60);
const STALE_CONNECTED_TIMEOUT: Duration = Duration::from_secs(180);
const IN_GAME_DISCONNECTED_GRACE: Duration = Duration::from_secs(3600);
const RECONNECT_ABORT_MARGIN: Duration = Duration::from_secs(5);

pub async fn cleanup_loop(state: Arc<ServerState>) {
    let mut ticker = tokio::time::interval(CLEANUP_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        ticker.tick().await;
        cleanup_stale_state(&state);
    }
}

fn cleanup_stale_state(state: &Arc<ServerState>) {
    let now = Instant::now();
    let stale_players = state
        .players
        .iter()
        .filter_map(|entry| {
            let player = entry.value();
            (player.connected && now.duration_since(player.last_seen) >= STALE_CONNECTED_TIMEOUT)
                .then(|| {
                    (
                        entry.key().clone(),
                        player.username.clone(),
                        player.generation,
                    )
                })
        })
        .collect::<Vec<_>>();

    for (player_id, username, generation) in stale_players {
        warn!(
            "[cleanup] '{}' had no websocket frames for {}s -- marking disconnected",
            username,
            STALE_CONNECTED_TIMEOUT.as_secs()
        );
        mark_disconnected(state, &player_id, generation);
    }

    let rooms_to_remove = state
        .rooms
        .iter()
        .filter_map(|entry| {
            let room = entry.value();
            match room.status {
                RoomStatus::Lobby => room
                    .connected_player_ids()
                    .is_empty()
                    .then(|| entry.key().clone()),
                RoomStatus::InGame => {
                    in_game_room_expired(state, room, now).then(|| entry.key().clone())
                }
            }
        })
        .collect::<Vec<_>>();

    for room_id in rooms_to_remove {
        info!(
            "[cleanup] removing stale room {}",
            &room_id[..8.min(room_id.len())]
        );
        remove_room_and_clear_sessions(state, &room_id);
    }
}

pub fn schedule_reconnect_abort(state: Arc<ServerState>, room_id: String, player_id: String) {
    let Some(timeout_s) = state
        .rooms
        .get(&room_id)
        .map(|room| room.reconnect_timeout_s)
    else {
        return;
    };
    let timeout = Duration::from_secs(timeout_s as u64);

    tokio::spawn(async move {
        tokio::time::sleep(timeout + RECONNECT_ABORT_MARGIN).await;

        let disconnected_past_timeout = state
            .players
            .get(&player_id)
            .and_then(|player| player.disconnected_at)
            .is_some_and(|since| since.elapsed() >= timeout);
        if !disconnected_past_timeout {
            return;
        }

        let seat_expired = state
            .rooms
            .get(&room_id)
            .map(|room| {
                room.status == RoomStatus::InGame
                    && room
                        .players
                        .iter()
                        .any(|slot| slot.player_id == player_id && !slot.connected && !slot.is_bot)
            })
            .unwrap_or(false);
        if !seat_expired {
            return;
        }

        abort_in_game_room(&state, &room_id);
    });
}

fn abort_in_game_room(state: &Arc<ServerState>, room_id: &str) {
    info!(
        "[cleanup] aborting in-game room {} (reconnect timeout)",
        &room_id[..8.min(room_id.len())]
    );
    let Some((info, notify)) = crate::lobby::reset_room_to_lobby(state, room_id) else {
        return;
    };

    let aborted = ServerMessage::GameAborted {
        room_id: room_id.to_string(),
    };
    if let Ok(json) = serde_json::to_string(&aborted) {
        for pid in &notify {
            emit_to(state, pid, &aborted, &json);
        }
    }
    broadcast_to_room(state, room_id, &ServerMessage::RoomUpdate { room: info });

    let room_deserted = state
        .rooms
        .get(room_id)
        .map(|room| room.connected_player_ids().is_empty())
        .unwrap_or(true);
    if room_deserted {
        state.rooms.remove(room_id);
    }
}

fn in_game_room_expired(state: &Arc<ServerState>, room: &Room, now: Instant) -> bool {
    if !room.all_disconnected() {
        return false;
    }

    let disconnected_at = room
        .players
        .iter()
        .map(|slot| slot.player_id.as_str())
        .chain(
            room.observers
                .iter()
                .map(|observer| observer.player_id.as_str()),
        )
        .map(|player_id| state.players.get(player_id).and_then(|p| p.disconnected_at))
        .collect::<Option<Vec<_>>>();

    disconnected_at
        .filter(|times| !times.is_empty())
        .and_then(|times| times.into_iter().max())
        .is_some_and(|latest| now.duration_since(latest) >= IN_GAME_DISCONNECTED_GRACE)
}

pub fn mark_disconnected(state: &Arc<ServerState>, player_id: &str, our_generation: u64) {
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
            player.disconnected_at = Some(Instant::now());
            (player.username.clone(), player.room_id.clone())
        } else {
            return;
        }
    };

    if let Some(rid) = &room_id {
        let room_status = state.rooms.get(rid).map(|r| r.status.clone());

        match room_status {
            Some(RoomStatus::InGame) => {
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

                if let Some(mut room) = state.rooms.get_mut(rid) {
                    room.set_connected(player_id, false);
                } else {
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

                schedule_reconnect_abort(state.clone(), rid.clone(), player_id.to_string());
            }
            Some(RoomStatus::Lobby) => {
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

pub fn remove_room_and_clear_sessions(state: &Arc<ServerState>, room_id: &str) {
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
