use std::collections::{BTreeMap, HashSet};

use metrics::{counter, gauge, histogram};
use metrics_exporter_prometheus::{Matcher, PrometheusBuilder, PrometheusHandle};

use crate::analytics::GameEndReason;
use crate::protocol::{EngineKind, LocalGameKind, RoomStatus};
use crate::state::ServerState;

const CONNECTIONS: &str = "manabrew_relay_connections";
const PLAYERS: &str = "manabrew_relay_players";
const ROOMS: &str = "manabrew_relay_rooms";
const LOCAL_GAMES: &str = "manabrew_relay_local_games";
const GAMES_STARTED: &str = "manabrew_relay_games_started_total";
const GAMES_ENDED: &str = "manabrew_relay_games_ended_total";
const CLIENT_REJECTIONS: &str = "manabrew_relay_client_rejections_total";
const RECONNECT_RESYNCS: &str = "manabrew_relay_reconnect_resyncs_total";
const SESSION_TAKEOVERS: &str = "manabrew_relay_session_takeovers_total";
const ANALYTICS_DROPPED: &str = "manabrew_relay_analytics_dropped_total";
const DECK_PLAY_EVENTS_DROPPED: &str = "manabrew_relay_deck_play_events_dropped_total";
const STATE_PATCH_DOWNGRADES: &str = "manabrew_relay_state_patch_downgrades_total";
const ENGINE_REPORTS: &str = "manabrew_relay_engine_reports_total";
const TRANSPORT_ANNOUNCEMENTS: &str = "manabrew_relay_transport_announcements_total";
const CLIENT_RTT: &str = "manabrew_relay_client_rtt_ms";
const STATE_HANDLING: &str = "manabrew_relay_state_handling_seconds";
const SOCKET_WRITE: &str = "manabrew_relay_socket_write_seconds";
const OUTBOUND_BACKLOG: &str = "manabrew_relay_outbound_backlog";

const LABEL_KIND: &str = "kind";
const LABEL_STATUS: &str = "status";
const LABEL_HOSTED: &str = "hosted";
const LABEL_ENGINE: &str = "engine";
const LABEL_REASON: &str = "reason";
const LABEL_SEATS: &str = "seats";
const LABEL_OUTCOME: &str = "outcome";

pub const REJECTION_OUTDATED_WIRE: &str = "outdated_wire";

pub const ENGINE_REPORT_ACCEPTED: &str = "accepted";
/// Accepted, but the seat had already left the room it played in. Normal at
/// game over rather than a fault; kept apart from `accepted` because a sharp
/// rise in it means seats are leaving earlier than they used to.
pub const ENGINE_REPORT_ROOMLESS: &str = "accepted_roomless";
pub const ENGINE_REPORT_IMPLAUSIBLE: &str = "implausible";

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

// Only the state-handling metric gets buckets. Everything else stays a summary,
// whose quantiles are per process and cannot be aggregated.
const STATE_HANDLING_BUCKETS: &[f64] = &[
    0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0,
];

const BACKLOG_BUCKETS: &[f64] = &[1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 64.0, 128.0, 512.0, 2048.0];

fn builder() -> PrometheusBuilder {
    PrometheusBuilder::new()
        .set_buckets_for_metric(
            Matcher::Full(STATE_HANDLING.to_string()),
            STATE_HANDLING_BUCKETS,
        )
        .expect("state handling buckets are a non-empty literal")
        .set_buckets_for_metric(
            Matcher::Full(SOCKET_WRITE.to_string()),
            STATE_HANDLING_BUCKETS,
        )
        .expect("socket write buckets are a non-empty literal")
        .set_buckets_for_metric(Matcher::Full(OUTBOUND_BACKLOG.to_string()), BACKLOG_BUCKETS)
        .expect("backlog buckets are a non-empty literal")
}

pub fn install() -> PrometheusHandle {
    builder()
        .install_recorder()
        .expect("failed to install metrics recorder")
}

pub fn detached_handle() -> PrometheusHandle {
    builder().build_recorder().handle()
}

/// How long the relay itself spends on one state envelope: folding the patch
/// into the cached board, deciding whether a full board is needed, and handing
/// it to the audience. Labelled by seat count because the node emits one
/// envelope per seat plus an observer, so the work per decision scales with the
/// room even when the engine's own time does not.
///
/// This interval had no metric at all. Replaying captures put a four-seat room
/// at a p99 of 2.3s outside the rules engine against 0.27s for two seats, and
/// the only way to see that was to subtract `engineMs` from capture timestamps
/// in a script, after the fact, on a box.
pub fn record_state_handling(seats: usize, elapsed: std::time::Duration) {
    histogram!(STATE_HANDLING, LABEL_SEATS => seats.to_string()).record(elapsed.as_secs_f64());
}

/// The websocket write itself, and how many messages were already waiting when
/// this one was taken off the queue.
///
/// Everything else between the engine and the player is now measured; this was
/// the last gap. The outbound channel is unbounded and the writer awaits the
/// sink, so a client that stops draining applies backpressure and every later
/// message queues behind it. That is invisible in the handling metric, which
/// stops at the hand-off, and it grows with seat count because a four-seat room
/// enqueues five envelopes per decision where a two-seat room enqueues three.
pub fn record_socket_write(backlog: usize, elapsed: std::time::Duration) {
    histogram!(SOCKET_WRITE).record(elapsed.as_secs_f64());
    histogram!(OUTBOUND_BACKLOG).record(backlog as f64);
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

/// A state patch was expanded back into a full state because a recipient's
/// client is too old to apply it. Reaching zero is the signal that
/// `SELF_HOSTED_NODE_STATE_DELTA` is saving bandwidth for everyone.
pub fn record_state_patch_downgrade() {
    counter!(STATE_PATCH_DOWNGRADES).increment(1);
}

/// What became of a client's end-of-game engine report. Both drop paths are
/// silent by design — a report is not worth an error to a player — so without
/// a count the only visible symptom is a dashboard that undercounts games and
/// no way to tell a client that never sent from a relay that threw it away.
pub fn record_engine_report(outcome: &'static str) {
    counter!(ENGINE_REPORTS, LABEL_OUTCOME => outcome).increment(1);
}

/// Round trip from the relay to a client and back, taken from the websocket
/// heartbeat. The heartbeat carries the send time and RFC 6455 requires the
/// peer to echo a ping's payload, so this is measured entirely on the relay's
/// own clock and needs nothing from the client.
pub fn record_client_rtt(ms: f64) {
    histogram!(CLIENT_RTT).record(ms);
}

pub fn record_transport_announcement(withdrawn: bool) {
    let kind = if withdrawn { "withdraw" } else { "announce" };
    counter!(TRANSPORT_ANNOUNCEMENTS, LABEL_KIND => kind).increment(1);
}

pub fn record_resync() {
    counter!(RECONNECT_RESYNCS).increment(1);
}

pub fn record_session_takeover(identity: &'static str) {
    counter!(SESSION_TAKEOVERS, LABEL_KIND => identity).increment(1);
}

pub fn record_analytics_dropped() {
    counter!(ANALYTICS_DROPPED).increment(1);
}

pub fn record_deck_play_event_dropped() {
    counter!(DECK_PLAY_EVENTS_DROPPED).increment(1);
}

pub fn refresh_gauges(state: &ServerState) {
    let mut bot_usernames = HashSet::new();
    let mut lobby_player = 0u32;
    let mut lobby_hosted = 0u32;
    let mut in_game_player = 0u32;
    let mut in_game_hosted = 0u32;
    let mut lobby_human_players = 0u32;
    let mut lobby_bot_players = 0u32;
    let mut in_game_human_players = 0u32;
    let mut in_game_bot_players = 0u32;
    for entry in state.rooms.iter() {
        let room = entry.value();
        for slot in &room.players {
            if slot.is_bot {
                bot_usernames.insert(slot.username.clone());
            }
            if !slot.connected {
                continue;
            }
            match (&room.status, slot.is_bot) {
                (RoomStatus::Lobby, false) => lobby_human_players += 1,
                (RoomStatus::Lobby, true) => lobby_bot_players += 1,
                (RoomStatus::InGame, false) => in_game_human_players += 1,
                (RoomStatus::InGame, true) => in_game_bot_players += 1,
            }
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
    let mut local_games: BTreeMap<&'static str, u32> = BTreeMap::new();
    for entry in state.players.iter() {
        let player = entry.value();
        if !player.connected {
            continue;
        }
        // A seat in a room is counted by the room gauges; this is the play the
        // relay would otherwise never see.
        if let Some(kind) = player.local_game.filter(|_| player.room_id.is_none()) {
            *local_games.entry(kind.as_str()).or_insert(0) += 1;
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
    set_players(
        RoomStatus::Lobby,
        ConnectionKind::Human,
        lobby_human_players,
    );
    set_players(RoomStatus::Lobby, ConnectionKind::Bot, lobby_bot_players);
    set_players(
        RoomStatus::InGame,
        ConnectionKind::Human,
        in_game_human_players,
    );
    set_players(RoomStatus::InGame, ConnectionKind::Bot, in_game_bot_players);
    set_rooms(RoomStatus::Lobby, false, lobby_player);
    set_rooms(RoomStatus::Lobby, true, lobby_hosted);
    set_rooms(RoomStatus::InGame, false, in_game_player);
    set_rooms(RoomStatus::InGame, true, in_game_hosted);
    for kind in LocalGameKind::ALL {
        let count = local_games.get(kind.as_str()).copied().unwrap_or(0);
        gauge!(LOCAL_GAMES, LABEL_KIND => kind.as_str()).set(count as f64);
    }
}

fn set_connections(kind: ConnectionKind, count: u32) {
    gauge!(CONNECTIONS, LABEL_KIND => kind.as_str()).set(count as f64);
}

fn set_players(status: RoomStatus, kind: ConnectionKind, count: u32) {
    gauge!(PLAYERS, LABEL_STATUS => status_label(status), LABEL_KIND => kind.as_str())
        .set(count as f64);
}

fn set_rooms(status: RoomStatus, hosted: bool, count: u32) {
    gauge!(ROOMS, LABEL_STATUS => status_label(status), LABEL_HOSTED => bool_label(hosted))
        .set(count as f64);
}

fn engine_label(engine: EngineKind) -> &'static str {
    match engine {
        EngineKind::Manabrew => "manabrew",
        EngineKind::Forge => "forge",
        EngineKind::Ironsmith => "ironsmith",
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
