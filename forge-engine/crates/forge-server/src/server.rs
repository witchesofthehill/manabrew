use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::net::TcpListener;
use tracing::{debug, error, info, warn};

use crate::connection::{handle_connection, mark_disconnected, remove_room_and_clear_sessions};
use crate::protocol::RoomStatus;
use crate::state::ServerState;

const CLEANUP_INTERVAL: Duration = Duration::from_secs(60);
const STALE_CONNECTED_TIMEOUT: Duration = Duration::from_secs(180);
const IN_GAME_DISCONNECTED_GRACE: Duration = Duration::from_secs(3600);

pub async fn run_server(state: Arc<ServerState>, addr: SocketAddr) {
    let listener = TcpListener::bind(addr)
        .await
        .expect("Failed to bind to address");

    info!("[server] Forge Server listening on ws://{}", addr);
    info!("[server] Server key: {}", mask_key(&state.server_key));
    info!("[server] Max rooms: {}", state.max_rooms);

    tokio::spawn(cleanup_loop(state.clone()));

    loop {
        match listener.accept().await {
            Ok((stream, peer_addr)) => {
                debug!("[server] accepted connection from {}", peer_addr);
                let state = state.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(stream, peer_addr, state).await {
                        error!("[server] connection error from {}: {}", peer_addr, e);
                    }
                });
            }
            Err(e) => {
                error!("[server] accept error: {}", e);
            }
        }
    }
}

async fn cleanup_loop(state: Arc<ServerState>) {
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
                    in_game_room_expired(state, entry.key(), now).then(|| entry.key().clone())
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

fn in_game_room_expired(state: &Arc<ServerState>, room_id: &str, now: Instant) -> bool {
    let disconnected_at = state
        .players
        .iter()
        .filter_map(|entry| {
            (entry.value().room_id.as_deref() == Some(room_id)).then(|| {
                if entry.value().connected {
                    None
                } else {
                    entry.value().disconnected_at
                }
            })
        })
        .collect::<Option<Vec<_>>>();

    disconnected_at
        .filter(|times| !times.is_empty())
        .and_then(|times| times.into_iter().max())
        .is_some_and(|latest| now.duration_since(latest) >= IN_GAME_DISCONNECTED_GRACE)
}

fn mask_key(key: &str) -> String {
    if key.len() <= 2 {
        "*".repeat(key.len())
    } else {
        format!(
            "{}{}{}",
            &key[..1],
            "*".repeat(key.len() - 2),
            &key[key.len() - 1..]
        )
    }
}
