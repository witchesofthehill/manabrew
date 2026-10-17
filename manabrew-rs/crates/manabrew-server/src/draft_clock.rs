use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::chat::unix_time_ms;
use crate::connection::{broadcast_to_room, send_to_room_player};
use crate::protocol::ServerMessage;
use crate::room::Room;
use crate::state::ServerState;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClockSeat {
    pub seat: u8,
    pub revision: String,
    pub remaining_ms: u64,
    pub deadline_ms: Option<u64>,
    #[serde(skip)]
    deadline: Option<Instant>,
    #[serde(skip)]
    expired: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClockSync {
    #[serde(rename = "type")]
    kind: String,
    session_id: String,
    sequence: u64,
    paused: bool,
    seats: Vec<ClockSeat>,
}

#[derive(Debug)]
pub struct DraftClock {
    session_id: String,
    sequence: u64,
    paused: bool,
    seats: Vec<ClockSeat>,
}

fn envelope(room: &Room, payload: serde_json::Value, target: Option<&str>) -> ServerMessage {
    ServerMessage::StateUpdate {
        from_player: room.host_username.clone(),
        state: serde_json::json!({
            "kind": "roomRelay", "protocol": "draft-v1", "version": 1,
            "messageId": uuid::Uuid::new_v4().to_string(),
            "roomId": room.room_id, "fromPlayer": room.host_username,
            "targetPlayer": target, "payload": payload,
        }),
    }
}

fn state_message(room: &Room) -> Option<ServerMessage> {
    let clock = room.draft_clock.as_ref()?;
    Some(envelope(
        room,
        serde_json::json!({
            "type": "clockState", "sessionId": clock.session_id,
            "sequence": clock.sequence, "paused": clock.paused,
            "serverNowMs": unix_time_ms(), "seats": clock.seats,
        }),
        None,
    ))
}

pub fn synchronize(state: &Arc<ServerState>, room_id: &str, payload: &serde_json::Value) {
    let Ok(sync) = serde_json::from_value::<ClockSync>(payload.clone()) else {
        return;
    };
    if sync.kind != "clockSync" || sync.seats.len() > 8 {
        return;
    }
    let (message, timers) = {
        let Some(mut room) = state.rooms.get_mut(room_id) else {
            return;
        };
        if room.limited_session_id.as_deref() != Some(sync.session_id.as_str())
            || !room.host_connected()
            || room
                .draft_config
                .as_ref()
                .and_then(|config| config.pick_seconds)
                .is_none()
        {
            return;
        }
        if let Some(clock) = &room.draft_clock {
            if sync.sequence <= clock.sequence {
                let message = state_message(&room);
                drop(room);
                if let Some(message) = message {
                    broadcast_to_room(state, room_id, &message);
                }
                return;
            }
        }
        let duration = u64::from(
            room.draft_config
                .as_ref()
                .and_then(|config| config.pick_seconds)
                .unwrap(),
        ) * 1000;
        let mut seen = [false; 8];
        if sync.seats.iter().any(|seat| {
            seat.seat >= room.max_players
                || seat.revision.len() > 64
                || seat.revision.is_empty()
                || seat.remaining_ms > duration
                || std::mem::replace(&mut seen[usize::from(seat.seat)], true)
        }) {
            return;
        }
        let now = Instant::now();
        let wall_now = unix_time_ms();
        let mut seats = sync.seats;
        let mut timers = Vec::with_capacity(seats.len());
        for seat in &mut seats {
            if let Some(previous) = room.draft_clock.as_ref().and_then(|clock| {
                clock
                    .seats
                    .iter()
                    .find(|entry| entry.seat == seat.seat && entry.revision == seat.revision)
            }) {
                let retained = previous
                    .deadline
                    .map(|deadline| deadline.saturating_duration_since(now).as_millis() as u64)
                    .unwrap_or(previous.remaining_ms);
                seat.remaining_ms = seat.remaining_ms.min(retained);
            }
            seat.expired = false;
            seat.deadline = (!sync.paused).then(|| now + Duration::from_millis(seat.remaining_ms));
            seat.deadline_ms = (!sync.paused).then(|| wall_now + seat.remaining_ms);
            if !sync.paused {
                timers.push((seat.seat, seat.revision.clone(), seat.remaining_ms));
            }
        }
        room.draft_clock = Some(DraftClock {
            session_id: sync.session_id.clone(),
            sequence: sync.sequence,
            paused: sync.paused,
            seats,
        });
        (state_message(&room), timers)
    };
    if let Some(message) = message {
        broadcast_to_room(state, room_id, &message);
    }
    for (seat, revision, delay) in timers {
        let state = state.clone();
        let room_id = room_id.to_string();
        let session_id = sync.session_id.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            let message = {
                let Some(mut room) = state.rooms.get_mut(&room_id) else {
                    return;
                };
                if !room.host_connected() {
                    return;
                }
                let Some(clock) = room.draft_clock.as_mut() else {
                    return;
                };
                if clock.session_id != session_id || clock.sequence != sync.sequence || clock.paused
                {
                    return;
                }
                let Some(current) = clock
                    .seats
                    .iter_mut()
                    .find(|entry| entry.seat == seat && entry.revision == revision)
                else {
                    return;
                };
                if current.expired
                    || current
                        .deadline
                        .is_none_or(|deadline| deadline > Instant::now())
                {
                    return;
                }
                current.expired = true;
                current.remaining_ms = 0;
                current.deadline = None;
                current.deadline_ms = None;
                envelope(
                    &room,
                    serde_json::json!({ "type": "clockExpired", "sessionId": session_id, "sequence": sync.sequence, "seat": seat, "revision": revision }),
                    Some(&room.host_username),
                )
            };
            let host = state
                .rooms
                .get(&room_id)
                .map(|room| room.host_username.clone());
            if let Some(host) = host {
                send_to_room_player(&state, &room_id, &host, &message);
            }
        });
    }
}

pub fn pause_disconnected_host(state: &Arc<ServerState>, room_id: &str, player_id: &str) {
    let message = {
        let Some(mut room) = state.rooms.get_mut(room_id) else {
            return;
        };
        if !room.is_host(player_id) {
            return;
        }
        let Some(clock) = room.draft_clock.as_mut() else {
            return;
        };
        if clock.paused {
            return;
        }
        clock.paused = true;
        let now = Instant::now();
        for seat in &mut clock.seats {
            seat.remaining_ms = seat
                .deadline
                .map(|deadline| deadline.saturating_duration_since(now).as_millis() as u64)
                .unwrap_or(seat.remaining_ms);
            seat.deadline = None;
            seat.deadline_ms = None;
        }
        state_message(&room)
    };
    if let Some(message) = message {
        broadcast_to_room(state, room_id, &message);
    }
}

pub fn replay(state: &Arc<ServerState>, room_id: &str, username: &str) {
    let message = state
        .rooms
        .get(room_id)
        .and_then(|room| state_message(&room));
    if let Some(message) = message {
        send_to_room_player(state, room_id, username, &message);
    }
}
