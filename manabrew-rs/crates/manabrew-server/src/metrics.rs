use std::collections::HashSet;

use metrics::{counter, gauge};
use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};

use crate::analytics::GameEndReason;
use crate::protocol::{EngineKind, RoomStatus};
use crate::state::ServerState;

const CONNECTIONS: &str = "manabrew_relay_connections";
const ROOMS: &str = "manabrew_relay_rooms";
const GAMES_STARTED: &str = "manabrew_relay_games_started_total";
const GAMES_ENDED: &str = "manabrew_relay_games_ended_total";
const CLIENT_REJECTIONS: &str = "manabrew_relay_client_rejections_total";
const RECONNECT_RESYNCS: &str = "manabrew_relay_reconnect_resyncs_total";
const ANALYTICS_DROPPED: &str = "manabrew_relay_analytics_dropped_total";

const LABEL_KIND: &str = "kind";
const LABEL_STATUS: &str = "status";
const LABEL_HOSTED: &str = "hosted";
const LABEL_ENGINE: &str = "engine";
const LABEL_REASON: &str = "reason";

pub const REJECTION_OUTDATED_WIRE: &str = "outdated_wire";

#[derive(Clone, Copy)]
enum ConnectionKind {
    Human,
    Service,
    Bot,
}

impl ConnectionKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Human => "human",
            Self::Service => "service",
            Self::Bot => "bot",
        }
    }
}

pub fn install() -> PrometheusHandle {
    PrometheusBuilder::new()
        .install_recorder()
        .expect("failed to install metrics recorder")
}

pub fn detached_handle() -> PrometheusHandle {
    PrometheusBuilder::new().build_recorder().handle()
}

pub fn record_game_started(engine: EngineKind) {
    counter!(GAMES_STARTED, LABEL_ENGINE => engine_label(engine)).increment(1);
}

pub fn record_game_ended(reason: GameEndReason) {
    counter!(GAMES_ENDED, LABEL_REASON => reason.as_str()).increment(1);
}

pub fn record_rejection(reason: &'static str) {
    counter!(CLIENT_REJECTIONS, LABEL_REASON => reason).increment(1);
}

pub fn record_resync() {
    counter!(RECONNECT_RESYNCS).increment(1);
}

pub fn record_analytics_dropped() {
    counter!(ANALYTICS_DROPPED).increment(1);
}

pub fn refresh_gauges(state: &ServerState) {
    let mut bot_usernames = HashSet::new();
    let mut lobby_player = 0u32;
    let mut lobby_hosted = 0u32;
    let mut in_game_player = 0u32;
    let mut in_game_hosted = 0u32;
    for entry in state.rooms.iter() {
        let room = entry.value();
        for slot in room.players.iter().filter(|slot| slot.is_bot) {
            bot_usernames.insert(slot.username.clone());
        }
        match (&room.status, room.hosted) {
            (RoomStatus::Lobby, false) => lobby_player += 1,
            (RoomStatus::Lobby, true) => lobby_hosted += 1,
            (RoomStatus::InGame, false) => in_game_player += 1,
            (RoomStatus::InGame, true) => in_game_hosted += 1,
        }
    }

    let mut human = 0u32;
    let mut service = 0u32;
    let mut bot = 0u32;
    for entry in state.players.iter() {
        let player = entry.value();
        if !player.connected {
            continue;
        }
        if player.is_service {
            service += 1;
        } else if bot_usernames.contains(&player.username) {
            bot += 1;
        } else {
            human += 1;
        }
    }

    set_connections(ConnectionKind::Human, human);
    set_connections(ConnectionKind::Service, service);
    set_connections(ConnectionKind::Bot, bot);
    set_rooms(RoomStatus::Lobby, false, lobby_player);
    set_rooms(RoomStatus::Lobby, true, lobby_hosted);
    set_rooms(RoomStatus::InGame, false, in_game_player);
    set_rooms(RoomStatus::InGame, true, in_game_hosted);
}

fn set_connections(kind: ConnectionKind, count: u32) {
    gauge!(CONNECTIONS, LABEL_KIND => kind.as_str()).set(count as f64);
}

fn set_rooms(status: RoomStatus, hosted: bool, count: u32) {
    gauge!(ROOMS, LABEL_STATUS => status_label(status), LABEL_HOSTED => bool_label(hosted))
        .set(count as f64);
}

fn engine_label(engine: EngineKind) -> &'static str {
    match engine {
        EngineKind::Manabrew => "manabrew",
        EngineKind::Forge => "forge",
    }
}

fn status_label(status: RoomStatus) -> &'static str {
    match status {
        RoomStatus::Lobby => "lobby",
        RoomStatus::InGame => "in_game",
    }
}

fn bool_label(value: bool) -> &'static str {
    if value {
        "true"
    } else {
        "false"
    }
}
