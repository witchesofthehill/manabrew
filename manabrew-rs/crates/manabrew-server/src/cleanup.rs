use std::sync::Arc;
use std::time::{Duration, Instant};

use tracing::{info, warn};

use crate::analytics::{self, GameEndReason};
use crate::connection::{broadcast_room_transport, broadcast_to_room, emit_to};
use crate::lobby;
use crate::metrics;
use crate::protocol::{RoomStatus, ServerMessage, FEATURE_HOST_HANDOFF, FEATURE_JOURNAL_HANDOFF};
use crate::room::Room;
use crate::state::ServerState;

const CLEANUP_INTERVAL: Duration = Duration::from_secs(60);
const STALE_CONNECTED_TIMEOUT: Duration = Duration::from_secs(180);
const IN_GAME_DISCONNECTED_GRACE: Duration = Duration::from_secs(3600);
const RECONNECT_ABORT_MARGIN: Duration = Duration::from_secs(5);
/// How long a hosted room waits for its own host before offering the game to
/// another session. A node that only lost its socket is back well inside it.
const HOST_HANDOFF_GRACE: Duration = Duration::from_secs(20);
/// Time for the asked session to load the checkpoint and claim the room.
const HOST_HANDOFF_WINDOW: Duration = Duration::from_secs(45);
/// A journal taker replays every decision in a fresh engine before it claims.
const JOURNAL_HANDOFF_WINDOW: Duration = Duration::from_secs(120);
const HOST_HANDOFF_ATTEMPTS: usize = 3;
/// How long after the first offer a declined or unclaimed game may still be
/// offered to another pod.
const HOST_HANDOFF_SEARCH: Duration = Duration::from_secs(90);

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

    let mut humanless_rooms = Vec::new();
    for mut entry in state.rooms.iter_mut() {
        let room = entry.value_mut();
        if room.status != RoomStatus::InGame || room.has_connected_human() {
            room.humanless_since = None;
            continue;
        }
        let since = *room.humanless_since.get_or_insert(now);
        let grace = Duration::from_secs(room.reconnect_timeout_s as u64) + RECONNECT_ABORT_MARGIN;
        if now.duration_since(since) >= grace {
            humanless_rooms.push(entry.key().clone());
        }
    }
    for room_id in humanless_rooms {
        abort_humanless_room(state, &room_id);
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
        remove_room_and_clear_sessions(state, &room_id, GameEndReason::StaleExpired);
    }
}

fn abort_humanless_room(state: &Arc<ServerState>, room_id: &str) {
    let Some((info, notify)) = lobby::reset_room_to_lobby(state, room_id, GameEndReason::Abandoned)
    else {
        return;
    };
    info!(
        "[cleanup] in-game room {} had no connected human players -- reset to lobby",
        &room_id[..8.min(room_id.len())]
    );
    broadcast_to_room(state, room_id, &ServerMessage::RoomUpdate { room: info });
    let aborted = ServerMessage::GameAborted {
        room_id: room_id.to_string(),
    };
    if let Ok(json) = serde_json::to_string(&aborted) {
        for pid in &notify {
            emit_to(state, pid, &aborted, &json);
        }
    }
}

pub fn schedule_host_resume_abort(
    state: Arc<ServerState>,
    room_id: String,
    host_player_id: String,
) {
    let Some(timeout_s) = state
        .rooms
        .get(&room_id)
        .map(|room| room.reconnect_timeout_s)
    else {
        return;
    };
    let timeout = Duration::from_secs(timeout_s as u64) + RECONNECT_ABORT_MARGIN;

    tokio::spawn(async move {
        let started = Instant::now();
        let handoff_after = HOST_HANDOFF_GRACE.min(timeout);
        tokio::time::sleep(handoff_after).await;
        let mut tried = Vec::new();
        let mut candidate_missing = false;
        while tried.len() < HOST_HANDOFF_ATTEMPTS
            && (tried.is_empty() || started.elapsed() < handoff_after + HOST_HANDOFF_SEARCH)
            && host_still_gone(&state, &room_id, &host_player_id)
        {
            let offer = match offer_host_handoff(&state, &room_id, &host_player_id, &tried).await {
                HandoffAttempt::Offered(offer) => offer,
                HandoffAttempt::NoCandidate => {
                    if !candidate_missing {
                        metrics::record_host_handoff(metrics::HANDOFF_NO_CANDIDATE);
                        candidate_missing = true;
                    }
                    if started.elapsed() >= timeout {
                        break;
                    }
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    continue;
                }
                HandoffAttempt::Impossible => break,
            };
            candidate_missing = false;
            let deadline = Instant::now() + offer.window;
            while Instant::now() < deadline
                && host_still_gone(&state, &room_id, &host_player_id)
                && offer_open(&state, &room_id, &offer.token)
            {
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            if let Some(mut room) = state.rooms.get_mut(&room_id) {
                if room.resume_token == offer.token && room.host_player_id == host_player_id {
                    room.resume_token = uuid::Uuid::new_v4().to_string();
                    metrics::record_host_handoff(metrics::HANDOFF_UNCLAIMED);
                }
            }
            tried.push(offer.candidate);
        }
        tokio::time::sleep(timeout.saturating_sub(started.elapsed())).await;
        if !host_still_gone(&state, &room_id, &host_player_id) {
            return;
        }

        info!(
            "[cleanup] hosted in-game room {} host never resumed -- removing",
            &room_id[..8.min(room_id.len())]
        );
        broadcast_to_room(
            &state,
            &room_id,
            &ServerMessage::GameAborted {
                room_id: room_id.clone(),
            },
        );
        remove_room_and_clear_sessions(&state, &room_id, GameEndReason::HostLost);
    });
}

pub fn schedule_peer_host_loss(state: Arc<ServerState>, room_id: String, player_id: String) {
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

        let still_hosting = state
            .rooms
            .get(&room_id)
            .map(|room| room.status == RoomStatus::InGame && room.host_player_id == player_id)
            .unwrap_or(false);
        let still_gone = state
            .players
            .get(&player_id)
            .map(|player| !player.connected)
            .unwrap_or(true);
        if !still_hosting || !still_gone {
            return;
        }

        let Some((info, notify)) =
            lobby::reset_room_to_lobby(&state, &room_id, GameEndReason::HostLost)
        else {
            return;
        };
        info!(
            "[cleanup] room {} lost the seat holding its engine -- game ended, room reset to lobby",
            &room_id[..8.min(room_id.len())]
        );
        broadcast_to_room(&state, &room_id, &ServerMessage::RoomUpdate { room: info });
        let aborted = ServerMessage::GameAborted {
            room_id: room_id.clone(),
        };
        if let Ok(json) = serde_json::to_string(&aborted) {
            for pid in &notify {
                emit_to(&state, pid, &aborted, &json);
            }
        }
    });
}

/// ResumeRoom rotates host_player_id and session reclaim flips the player
/// back to connected; either one means the game has a host again.
fn host_still_gone(state: &Arc<ServerState>, room_id: &str, host_player_id: &str) -> bool {
    state
        .rooms
        .get(room_id)
        .map(|room| room.status == RoomStatus::InGame && room.host_player_id == host_player_id)
        .unwrap_or(false)
        && state
            .players
            .get(host_player_id)
            .map(|player| !player.connected)
            .unwrap_or(true)
}

enum HandoffAttempt {
    Offered(HandoffOffer),
    NoCandidate,
    Impossible,
}

struct HandoffOffer {
    candidate: String,
    token: String,
    window: Duration,
}

fn offer_open(state: &Arc<ServerState>, room_id: &str, token: &str) -> bool {
    state
        .rooms
        .get(room_id)
        .is_some_and(|room| room.resume_token == token)
}

/// Offers the game to an idle pod, from its journal if it has one, else from a
/// checkpoint. The fresh resume token is the only authorisation.
async fn offer_host_handoff(
    state: &Arc<ServerState>,
    room_id: &str,
    old_host_pid: &str,
    tried: &[String],
) -> HandoffAttempt {
    let Some(game_id) = state
        .rooms
        .get(room_id)
        .and_then(|room| room.replay.as_ref().map(|replay| replay.game_id.clone()))
    else {
        return HandoffAttempt::Impossible;
    };
    let journal = match crate::journal_transport::handoff_status(state, room_id, &game_id).await {
        Ok(Some(position)) if position.unavailable_reason.is_some() => {
            metrics::record_host_handoff(metrics::HANDOFF_JOURNAL_UNAVAILABLE);
            return HandoffAttempt::Impossible;
        }
        Ok(position) => position.is_some(),
        Err(error) => {
            warn!("[handoff] journal status for room {room_id} unavailable: {error}");
            metrics::record_host_handoff(metrics::HANDOFF_JOURNAL_UNAVAILABLE);
            return HandoffAttempt::Impossible;
        }
    };
    if !journal && !state.host_handoff {
        return HandoffAttempt::Impossible;
    }
    let feature = if journal {
        FEATURE_JOURNAL_HANDOFF
    } else {
        FEATURE_HOST_HANDOFF
    };
    let Some(candidate) = handoff_candidate(state, room_id, old_host_pid, feature, tried) else {
        return HandoffAttempt::NoCandidate;
    };
    let token = uuid::Uuid::new_v4().to_string();
    let offer = {
        let Some(mut room) = state.rooms.get_mut(room_id) else {
            return HandoffAttempt::Impossible;
        };
        let Some(replay) = room
            .replay
            .as_ref()
            .filter(|replay| replay.game_id == game_id)
        else {
            return HandoffAttempt::Impossible;
        };
        let request =
            lobby::handoff_request(&room, replay, token.clone(), state.official_key.clone());
        let offer = if journal {
            ServerMessage::HostHandoff {
                request,
                turn: 0,
                checkpoint: String::new(),
                journal: true,
            }
        } else {
            let Some(held) = replay.checkpoint.as_ref() else {
                metrics::record_host_handoff(metrics::HANDOFF_NO_CHECKPOINT);
                return HandoffAttempt::Impossible;
            };
            ServerMessage::HostHandoff {
                request,
                turn: held.turn,
                checkpoint: held.checkpoint.clone(),
                journal: false,
            }
        };
        room.resume_token = token.clone();
        offer
    };
    let Ok(json) = serde_json::to_string(&offer) else {
        return HandoffAttempt::Impossible;
    };
    info!(
        "[handoff] room {} offered to session {} (journal: {})",
        &room_id[..8.min(room_id.len())],
        &candidate[..8.min(candidate.len())],
        journal
    );
    emit_to(state, &candidate, &offer, &json);
    metrics::record_host_handoff(metrics::HANDOFF_OFFERED);
    HandoffAttempt::Offered(HandoffOffer {
        candidate,
        token,
        window: if journal {
            JOURNAL_HANDOFF_WINDOW
        } else {
            HOST_HANDOFF_WINDOW
        },
    })
}

/// A connected service session hosting an empty lobby table that said it can
/// take this kind of game over and has not been asked already.
fn handoff_candidate(
    state: &Arc<ServerState>,
    room_id: &str,
    old_host_pid: &str,
    feature: &str,
    tried: &[String],
) -> Option<String> {
    state.rooms.iter().find_map(|entry| {
        let room = entry.value();
        if entry.key() == room_id
            || !room.hosted
            || room.status != RoomStatus::Lobby
            || !room.players.is_empty()
            || room.host_player_id == old_host_pid
            || tried.contains(&room.host_player_id)
        {
            return None;
        }
        let host = state.players.get(&room.host_player_id)?;
        (host.connected && host.is_service && host.client.supports(feature))
            .then(|| host.player_id.clone())
    })
}

pub fn schedule_seat_forfeit(state: Arc<ServerState>, room_id: String, player_id: String) {
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

        // A reconnect flips the player back to connected; a rejoin re-keys the
        // seat's player_id (disarming via the seat check below). No player
        // entry at all means a pending-rejoin seat resurrected after a relay
        // restart — nobody is connected under that id, so it counts as gone.
        let still_gone = state
            .players
            .get(&player_id)
            .map(|player| !player.connected)
            .unwrap_or(true);
        let seat_in_live_game = state
            .rooms
            .get(&room_id)
            .map(|room| {
                room.status == RoomStatus::InGame
                    && room.players.iter().any(|slot| slot.player_id == player_id)
            })
            .unwrap_or(false);
        if !still_gone || !seat_in_live_game {
            return;
        }
        forfeit_seat(&state, &room_id, &player_id);
    });
}

fn forfeit_seat(state: &Arc<ServerState>, room_id: &str, player_id: &str) {
    let (username, info) = {
        let Some(mut room) = state.rooms.get_mut(room_id) else {
            return;
        };
        let Some(slot) = room.remove_player(player_id) else {
            return;
        };
        (slot.username, room.to_room_info())
    };
    state.players.remove(player_id);
    info!(
        "[cleanup] '{}' did not reconnect within grace -- forfeiting seat in room {}",
        username,
        &room_id[..8.min(room_id.len())]
    );
    broadcast_to_room(
        state,
        room_id,
        &ServerMessage::PlayerLeft {
            room_id: room_id.to_string(),
            username,
        },
    );
    broadcast_to_room(state, room_id, &ServerMessage::RoomUpdate { room: info });
}

fn in_game_room_expired(state: &Arc<ServerState>, room: &Room, now: Instant) -> bool {
    if !room.all_disconnected() {
        return false;
    }

    room.players
        .iter()
        .map(|slot| slot.player_id.as_str())
        .chain(
            room.observers
                .iter()
                .map(|observer| observer.player_id.as_str()),
        )
        .filter_map(|player_id| state.players.get(player_id).and_then(|p| p.disconnected_at))
        .max()
        .is_some_and(|latest| now.duration_since(latest) >= IN_GAME_DISCONNECTED_GRACE)
}

pub fn mark_disconnected(state: &Arc<ServerState>, player_id: &str, our_generation: u64) {
    mark_disconnected_inner(state, player_id, our_generation);
    crate::connection::broadcast_player_list(state);
}

fn mark_disconnected_inner(state: &Arc<ServerState>, player_id: &str, our_generation: u64) {
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
                    // Give the host the same reconnect grace as a player: it can
                    // come back via session reclaim or ResumeRoom. Killing the
                    // room here would abort every guest's game on a host blip.
                    if let Some(mut room) = state.rooms.get_mut(rid) {
                        room.set_connected(player_id, false);
                    } else {
                        return;
                    }
                    info!(
                        "[disconnect] hosted in-game room {} lost its non-playing host -- awaiting resume",
                        &rid[..8]
                    );
                    broadcast_to_room(
                        state,
                        rid,
                        &ServerMessage::PlayerDisconnected {
                            username: username.clone(),
                        },
                    );
                    schedule_host_resume_abort(state.clone(), rid.clone(), player_id.to_string());
                    return;
                }

                let peer_host_lost = state
                    .rooms
                    .get(rid)
                    .map(|room| !room.hosted && room.is_host(player_id) && room.host_is_player())
                    .unwrap_or(false);

                let holds_seat = {
                    if let Some(mut room) = state.rooms.get_mut(rid) {
                        room.set_connected(player_id, false);
                        room.players.iter().any(|slot| slot.player_id == player_id)
                    } else {
                        return;
                    }
                };

                if peer_host_lost {
                    info!(
                        "[disconnect] in-game room {} lost the seat holding its engine -- awaiting resume",
                        &rid[..8]
                    );
                    broadcast_to_room(
                        state,
                        rid,
                        &ServerMessage::PlayerDisconnected {
                            username: username.clone(),
                        },
                    );
                    schedule_peer_host_loss(state.clone(), rid.clone(), player_id.to_string());
                    return;
                }

                info!(
                    "[disconnect] '{}' marked disconnected in in-game room {} (session preserved)",
                    username,
                    &rid[..8]
                );
                if holds_seat {
                    schedule_seat_forfeit(state.clone(), rid.clone(), player_id.to_string());
                }
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
                    remove_room_and_clear_sessions(state, rid, GameEndReason::HostLost);
                    return;
                }

                let room_empty = {
                    if let Some(mut room) = state.rooms.get_mut(rid) {
                        room.remove_participant(player_id);
                        let empty = room.is_empty();
                        if !empty && room.players.is_empty() {
                            room.reset_lobby_settings();
                        }
                        empty
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
                    remove_room_and_clear_sessions(state, rid, GameEndReason::Abandoned);
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
                    broadcast_room_transport(state, rid);
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

pub fn remove_room_and_clear_sessions(
    state: &Arc<ServerState>,
    room_id: &str,
    reason: GameEndReason,
) {
    if let Some((_, room)) = state.rooms.remove(room_id) {
        if let Some(replay) = room.replay.as_ref() {
            analytics::emit_game_ended(&state.analytics, &room, replay, reason);
        }
    }
    release_room_sessions(state, room_id);
}

fn release_room_sessions(state: &Arc<ServerState>, room_id: &str) {
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
        let connected = state
            .players
            .get(&player_id)
            .map(|player| player.connected)
            .unwrap_or(false);
        if connected {
            if let Some(mut player) = state.players.get_mut(&player_id) {
                player.room_id = None;
            }
        } else {
            state.players.remove(&player_id);
        }
    }
}
