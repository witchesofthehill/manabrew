use std::sync::Arc;
use std::time::{Duration, Instant};

use tracing::{info, warn};

use crate::analytics::{self, GameEndReason};
use crate::connection::{broadcast_room_transport, broadcast_to_room, emit_to};
use crate::lobby;
use crate::metrics;
use crate::protocol::{RoomStatus, ServerMessage, FEATURE_HOST_HANDOFF};
use crate::room::Room;
use crate::state::ServerState;

const CLEANUP_INTERVAL: Duration = Duration::from_secs(60);
const STALE_CONNECTED_TIMEOUT: Duration = Duration::from_secs(180);
const IN_GAME_DISCONNECTED_GRACE: Duration = Duration::from_secs(3600);
const RECONNECT_ABORT_MARGIN: Duration = Duration::from_secs(5);
const HOST_HANDOFF_GRACE: Duration = Duration::from_secs(20);
const HOST_HANDOFF_WINDOW: Duration = Duration::from_secs(45);

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
        if !matches!(room.status, RoomStatus::InGame | RoomStatus::Finished)
            || room.has_connected_human()
        {
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
        .filter_map(|entry| room_is_stale(state, entry.value(), now).then(|| entry.key().clone()))
        .collect::<Vec<_>>();

    for room_id in rooms_to_remove {
        info!(
            "[cleanup] removing stale room {}",
            &room_id[..8.min(room_id.len())]
        );
        remove_room_and_clear_sessions(state, &room_id, GameEndReason::StaleExpired);
    }
}

fn room_is_stale(state: &Arc<ServerState>, room: &Room, now: Instant) -> bool {
    if room.parent_limited_room.is_some() {
        return !paired_room_has_participants(state, room, now);
    }
    match room.status {
        RoomStatus::Lobby => room.all_disconnected(),
        RoomStatus::InGame => in_game_room_expired(state, room, now),
        RoomStatus::Finished => in_game_room_expired(state, room, now),
    }
}

pub(crate) fn paired_room_has_participants(
    state: &Arc<ServerState>,
    room: &Room,
    now: Instant,
) -> bool {
    let grace = Duration::from_secs(room.reconnect_timeout_s as u64) + RECONNECT_ABORT_MARGIN;
    room.players
        .iter()
        .filter(|seat| !seat.is_bot)
        .map(|seat| seat.player_id.as_str())
        .chain(
            room.observers
                .iter()
                .map(|observer| observer.player_id.as_str()),
        )
        .any(|player_id| {
            state.players.get(player_id).is_some_and(|player| {
                player.room_id.as_deref() == Some(room.room_id.as_str())
                    && (player.connected
                        || player
                            .disconnected_at
                            .is_some_and(|since| now.duration_since(since) < grace))
            })
        })
}

fn abort_humanless_room(state: &Arc<ServerState>, room_id: &str) {
    let Some((info, notify)) = lobby::reset_room_to_lobby(state, room_id, GameEndReason::Abandoned)
    else {
        return;
    };
    info!(
        "[cleanup] room {} had no connected human players -- reset to lobby",
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
    let disconnected_at = state
        .players
        .get(&host_player_id)
        .and_then(|p| p.disconnected_at);

    tokio::spawn(async move {
        let handoff_after = HOST_HANDOFF_GRACE.min(timeout);
        tokio::time::sleep(handoff_after).await;
        if !host_still_gone(&state, &room_id, &host_player_id, disconnected_at) {
            return;
        }
        let offered = offer_host_handoff(&state, &room_id, &host_player_id);
        if !offered {
            release_handoff_slot(&state, &room_id);
        }
        tokio::time::sleep(if offered {
            HOST_HANDOFF_WINDOW
        } else {
            timeout.saturating_sub(handoff_after)
        })
        .await;
        release_handoff_slot(&state, &room_id);
        let restore_stalled = offered
            && state.rooms.get(&room_id).is_some_and(|room| {
                room.replay
                    .as_ref()
                    .and_then(|r| r.handoff.as_ref())
                    .is_some_and(|h| h.claimed && !h.completed)
            });
        if !restore_stalled && !host_still_gone(&state, &room_id, &host_player_id, disconnected_at)
        {
            if offered {
                if let Some(mut room) = state.rooms.get_mut(&room_id) {
                    if room.host_player_id == host_player_id {
                        if let Some(replay) = room.replay.as_mut() {
                            analytics::emit_host_handoff(
                                &state.analytics,
                                &room_id,
                                replay,
                                "host_resumed",
                            );
                            replay.handoff = None;
                        }
                    }
                }
            }
            return;
        }
        if offered && !restore_stalled {
            if let Some(mut room) = state.rooms.get_mut(&room_id) {
                if let Some(replay) = room.replay.as_mut() {
                    analytics::emit_host_handoff(&state.analytics, &room_id, replay, "timed_out");
                    replay.handoff = None;
                }
            }
            metrics::record_host_handoff(metrics::HANDOFF_UNCLAIMED);
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

fn host_still_gone(
    state: &Arc<ServerState>,
    room_id: &str,
    host_player_id: &str,
    disconnected_at: Option<Instant>,
) -> bool {
    state
        .rooms
        .get(room_id)
        .map(|room| {
            matches!(room.status, RoomStatus::InGame | RoomStatus::Finished)
                && room.host_player_id == host_player_id
        })
        .unwrap_or(false)
        && state
            .players
            .get(host_player_id)
            .map(|player| !player.connected && player.disconnected_at == disconnected_at)
            .unwrap_or(true)
}

fn release_handoff_slot(state: &Arc<ServerState>, source_room: &str) {
    for mut room in state.rooms.iter_mut() {
        if room.handoff_for.as_deref() == Some(source_room) {
            room.handoff_for = None;
        }
    }
}

fn offer_host_handoff(state: &Arc<ServerState>, room_id: &str, old_host_pid: &str) -> bool {
    let busy: Vec<String> = state
        .rooms
        .iter()
        .filter_map(|room| {
            room.replay
                .as_ref()?
                .handoff
                .as_ref()
                .map(|h| h.candidate.clone())
        })
        .collect();
    let candidate = state.rooms.iter_mut().find_map(|mut room| {
        if room.room_id == room_id
            || room.handoff_for.is_some()
            || !room.hosted
            || !room.official
            || room.status != RoomStatus::Lobby
            || !room.players.is_empty()
            || busy.contains(&room.host_player_id)
            || room.engine != crate::protocol::EngineKind::Forge
        {
            return None;
        }
        let host = state.players.get(&room.host_player_id)?;
        if !host.connected || !host.is_service || !host.client.supports(FEATURE_HOST_HANDOFF) {
            return None;
        }
        let id = host.player_id.clone();
        drop(host);
        room.handoff_for = Some(room_id.to_string());
        Some(id)
    });
    let offer = {
        let Some(mut room) = state.rooms.get_mut(room_id) else {
            return false;
        };
        if room.status != RoomStatus::InGame
            || room.host_player_id != old_host_pid
            || room.engine != crate::protocol::EngineKind::Forge
            || !room.hosted
            || room.is_limited_session()
            || room.parent_limited_room.is_some()
            || !room.has_connected_human()
        {
            return false;
        }
        let compatible = room.players.iter().filter(|seat| !seat.is_bot).all(|seat| {
            state
                .players
                .get(&seat.player_id)
                .is_some_and(|player| player.client.supports(FEATURE_HOST_HANDOFF))
        });
        let host_type = if room.official
            || state
                .players
                .get(old_host_pid)
                .is_some_and(|p| p.client.supports(FEATURE_HOST_HANDOFF))
        {
            "pod"
        } else {
            "native_desktop"
        };
        let Some(replay) = room.replay.as_ref() else {
            return false;
        };
        if !compatible {
            state
                .analytics
                .emit(crate::analytics::AnalyticsEvent::HostHandoff {
                    ts: analytics::now_ts(),
                    room_id: room_id.to_string(),
                    game_id: replay.game_id.clone(),
                    attempt_id: uuid::Uuid::new_v4().to_string(),
                    outcome: "unsupported_clients".to_string(),
                    turn: None,
                    seconds_lost: None,
                    host_type: host_type.to_string(),
                    target_host_type: "pod".to_string(),
                });
            return false;
        }
        let Some(held) = replay
            .checkpoint
            .as_ref()
            .filter(|h| h.host_player_id == old_host_pid)
        else {
            state
                .analytics
                .emit(crate::analytics::AnalyticsEvent::HostHandoff {
                    ts: analytics::now_ts(),
                    room_id: room_id.to_string(),
                    game_id: replay.game_id.clone(),
                    attempt_id: uuid::Uuid::new_v4().to_string(),
                    outcome: "no_checkpoint".to_string(),
                    turn: None,
                    seconds_lost: None,
                    host_type: host_type.to_string(),
                    target_host_type: "pod".to_string(),
                });
            metrics::record_host_handoff(metrics::HANDOFF_NO_CHECKPOINT);
            return false;
        };
        let turn = held.turn;
        let disconnected_at = state
            .players
            .get(old_host_pid)
            .and_then(|p| p.disconnected_at)
            .unwrap_or_else(Instant::now);
        let seconds_lost = disconnected_at
            .saturating_duration_since(held.received_at)
            .as_secs_f64();
        let token = uuid::Uuid::new_v4().to_string();
        let request = lobby::handoff_request(&room, replay, token.clone(), None);
        let checkpoint = held.checkpoint.clone();
        let replay = room.replay.as_mut().unwrap();
        replay.handoff = Some(crate::replay::HostHandoff {
            attempt_id: uuid::Uuid::new_v4().to_string(),
            token,
            candidate: candidate.clone().unwrap_or_default(),
            offered_at: Instant::now(),
            seconds_lost,
            host_type,
            turn,
            claimed: false,
            completed: false,
        });
        if candidate.is_none() {
            analytics::emit_host_handoff(&state.analytics, room_id, replay, "no_candidate");
            replay.handoff = None;
            metrics::record_host_handoff(metrics::HANDOFF_NO_CANDIDATE);
            return false;
        }
        analytics::emit_host_handoff(&state.analytics, room_id, replay, "offered");
        ServerMessage::HostHandoff {
            request,
            turn,
            checkpoint,
        }
    };
    let Ok(json) = serde_json::to_string(&offer) else {
        return false;
    };
    emit_to(state, &candidate.unwrap(), &offer, &json);
    metrics::record_host_handoff(metrics::HANDOFF_OFFERED);
    true
}

pub fn schedule_peer_host_loss(state: Arc<ServerState>, room_id: String, player_id: String) {
    let Some(timeout_s) = state
        .rooms
        .get(&room_id)
        .filter(|room| room.parent_limited_room.is_some() || !room.is_limited_session())
        .map(|room| room.reconnect_timeout_s)
    else {
        return;
    };
    let timeout = Duration::from_secs(timeout_s as u64);
    let disconnected_at = state
        .players
        .get(&player_id)
        .and_then(|p| p.disconnected_at);

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
            .map(|player| !player.connected && player.disconnected_at == disconnected_at)
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

pub fn schedule_seat_forfeit(state: Arc<ServerState>, room_id: String, player_id: String) {
    let Some(timeout_s) = state
        .rooms
        .get(&room_id)
        .filter(|room| room.parent_limited_room.is_some() || !room.is_limited_session())
        .map(|room| room.reconnect_timeout_s)
    else {
        return;
    };
    let timeout = Duration::from_secs(timeout_s as u64);
    let disconnected_at = state
        .players
        .get(&player_id)
        .and_then(|p| p.disconnected_at);

    tokio::spawn(async move {
        tokio::time::sleep(timeout + RECONNECT_ABORT_MARGIN).await;

        // A reconnect flips the player back to connected; a rejoin re-keys the
        // seat's player_id (disarming via the seat check below). No player
        // entry at all means a pending-rejoin seat resurrected after a relay
        // restart — nobody is connected under that id, so it counts as gone.
        let still_gone = state
            .players
            .get(&player_id)
            .map(|player| {
                !player.connected
                    && player.room_id.as_deref() == Some(room_id.as_str())
                    && player.disconnected_at == disconnected_at
            })
            .unwrap_or(disconnected_at.is_none());
        let retained_seat = state
            .rooms
            .get(&room_id)
            .map(|room| {
                (matches!(room.status, RoomStatus::InGame | RoomStatus::Finished)
                    || room.parent_limited_room.is_some())
                    && room.players.iter().any(|slot| slot.player_id == player_id)
            })
            .unwrap_or(false);
        if !still_gone || !retained_seat {
            return;
        }
        forfeit_seat(&state, &room_id, &player_id);
    });
}

fn forfeit_seat(state: &Arc<ServerState>, room_id: &str, player_id: &str) {
    let (username, info, parent_id) = {
        let Some(mut room) = state.rooms.get_mut(room_id) else {
            return;
        };
        let Some(slot) = room.remove_player(player_id) else {
            return;
        };
        (
            slot.username,
            room.to_room_info(),
            room.parent_limited_room.clone(),
        )
    };
    release_room_session(state, room_id, player_id, parent_id.as_deref());
    let abandoned = state.rooms.get(room_id).is_some_and(|room| {
        room.parent_limited_room.is_some()
            && !paired_room_has_participants(state, &room, Instant::now())
    });
    if abandoned {
        remove_room_and_clear_sessions(state, room_id, GameEndReason::Abandoned);
        return;
    }
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
    let parent_id = room_id.as_ref().and_then(|id| {
        crate::draft_clock::pause_disconnected_host(state, id, player_id);
        state
            .rooms
            .get(id)
            .and_then(|room| room.parent_limited_room.clone())
    });
    if let Some(parent_id) = parent_id {
        let lost_host = state
            .rooms
            .get_mut(&parent_id)
            .map(|mut room| {
                room.set_connected(player_id, false);
                room.is_host(player_id)
            })
            .unwrap_or(false);
        let info = state.rooms.get(&parent_id).map(|room| room.to_room_info());
        if let Some(room) = info {
            broadcast_to_room(state, &parent_id, &ServerMessage::RoomUpdate { room });
        }
        if lost_host {
            schedule_peer_host_loss(state.clone(), parent_id, player_id.to_string());
        }
    }

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

                let paired_limited = state
                    .rooms
                    .get(rid)
                    .is_some_and(|room| room.parent_limited_room.is_some());
                let holds_seat = {
                    if let Some(mut room) = state.rooms.get_mut(rid) {
                        room.set_connected(player_id, false);
                        room.players.iter().any(|slot| slot.player_id == player_id)
                    } else {
                        return;
                    }
                };

                // A replicated engine does not die with its host: another
                // seat takes over at once and the lost host becomes an
                // ordinary disconnected seat.
                let migrated = peer_host_lost
                    && state.rooms.get_mut(rid).is_some_and(|mut room| {
                        room.engine_survives_host_loss() && room.migrate_host()
                    });
                if migrated {
                    info!(
                        "[disconnect] in-game room {} lost its host -- another seat took over",
                        &rid[..8]
                    );
                    broadcast_to_room(
                        state,
                        rid,
                        &ServerMessage::PlayerDisconnected {
                            username: username.clone(),
                        },
                    );
                    if holds_seat {
                        schedule_seat_forfeit(state.clone(), rid.clone(), player_id.to_string());
                    }
                    let info = state.rooms.get(rid).map(|room| room.to_room_info());
                    if let Some(room) = info {
                        broadcast_to_room(state, rid, &ServerMessage::RoomUpdate { room });
                    }
                    return;
                }

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
                    if paired_limited {
                        schedule_seat_forfeit(state.clone(), rid.clone(), player_id.to_string());
                    }
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

                let info = state.rooms.get(rid).map(|room| room.to_room_info());
                if let Some(room) = info {
                    broadcast_to_room(state, rid, &ServerMessage::RoomUpdate { room });
                }
            }
            Some(RoomStatus::Finished) => {
                let host = state
                    .rooms
                    .get_mut(rid)
                    .map(|mut room| {
                        room.set_connected(player_id, false);
                        room.is_host(player_id)
                    })
                    .unwrap_or(false);
                broadcast_to_room(
                    state,
                    rid,
                    &ServerMessage::PlayerDisconnected {
                        username: username.clone(),
                    },
                );
                let room = state.rooms.get(rid).map(|room| room.to_room_info());
                if let Some(room) = room {
                    broadcast_to_room(state, rid, &ServerMessage::RoomUpdate { room });
                }
                if host {
                    schedule_host_resume_abort(state.clone(), rid.clone(), player_id.to_string());
                } else {
                    schedule_seat_forfeit(state.clone(), rid.clone(), player_id.to_string());
                }
            }
            Some(RoomStatus::Lobby) => {
                let paired_limited = state
                    .rooms
                    .get(rid)
                    .is_some_and(|room| room.parent_limited_room.is_some());
                if paired_limited {
                    if let Some(mut room) = state.rooms.get_mut(rid) {
                        room.set_connected(player_id, false);
                    }
                    schedule_seat_forfeit(state.clone(), rid.clone(), player_id.to_string());
                    broadcast_to_room(
                        state,
                        rid,
                        &ServerMessage::PlayerDisconnected {
                            username: username.clone(),
                        },
                    );
                    let info = state.rooms.get(rid).map(|room| room.to_room_info());
                    if let Some(info) = info {
                        broadcast_to_room(state, rid, &ServerMessage::RoomUpdate { room: info });
                    }
                    return;
                }
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
                    let room = state.rooms.get(rid).map(|room| room.to_room_info());
                    if let Some(room) = room {
                        broadcast_to_room(state, rid, &ServerMessage::RoomUpdate { room });
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
    let Some((_, room)) = state.rooms.remove_if(room_id, |_, room| {
        reason != GameEndReason::StaleExpired || room_is_stale(state, room, Instant::now())
    }) else {
        return;
    };
    clear_removed_room(state, room, reason);
}

fn clear_removed_room(state: &Arc<ServerState>, room: Room, reason: GameEndReason) {
    if let Some(replay) = room
        .replay
        .as_ref()
        .filter(|_| room.status != RoomStatus::Finished)
    {
        analytics::emit_game_ended(&state.analytics, &room, replay, reason);
    }
    if let Some(parent_id) = &room.parent_limited_room {
        if let Some(mut parent) = state.rooms.get_mut(parent_id) {
            parent.limited_matches.retain(|id| id != &room.room_id);
        }
    }
    for child_id in &room.limited_matches {
        let active = state
            .rooms
            .get(child_id)
            .is_some_and(|child| child.status == RoomStatus::InGame);
        if active {
            broadcast_to_room(
                state,
                child_id,
                &ServerMessage::GameAborted {
                    room_id: child_id.clone(),
                },
            );
        }
        if let Some((_, child)) = state.rooms.remove(child_id) {
            clear_removed_room(state, child, reason);
        }
    }
    release_room_sessions(state, &room.room_id, room.parent_limited_room.as_deref());
}

fn release_room_sessions(state: &Arc<ServerState>, room_id: &str, parent_id: Option<&str>) {
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
        release_room_session(state, room_id, &player_id, parent_id);
    }
}

fn release_room_session(
    state: &Arc<ServerState>,
    room_id: &str,
    player_id: &str,
    parent_id: Option<&str>,
) {
    let parent = parent_id.and_then(|id| state.rooms.get(id)).filter(|room| {
        room.is_limited_session() && room.players.iter().any(|seat| seat.player_id == player_id)
    });
    state.players.remove_if_mut(player_id, |_, player| {
        if player.room_id.as_deref() != Some(room_id) {
            return false;
        }
        if let Some(parent) = &parent {
            player.room_id = Some(parent.room_id.clone());
            false
        } else if player.connected {
            player.room_id = None;
            false
        } else {
            true
        }
    });
}
