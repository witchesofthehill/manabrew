mod capture;
mod event;
mod writer;

use std::collections::HashMap;
use std::path::PathBuf;

use serde_json::Value;
use tokio::sync::mpsc;

pub use event::{AnalyticsEvent, CardEntry, GameEndReason, SeatInfo};

use crate::config::ServerConfig;
use crate::lobby::StartedGame;
use crate::metrics;
use crate::replay::GameReplayCache;
use crate::room::Room;
use manabrew_protocol::deck_dto::Deck;

const CHANNEL_CAPACITY: usize = 8192;

#[derive(Clone)]
pub struct AnalyticsHandle {
    events: Option<mpsc::Sender<AnalyticsEvent>>,
    capture: Option<std::sync::mpsc::SyncSender<capture::CaptureMessage>>,
}

impl AnalyticsHandle {
    pub fn from_config(config: &ServerConfig) -> Self {
        let events = config.events_dir.clone().map(|dir| {
            let (tx, rx) = mpsc::channel(CHANNEL_CAPACITY);
            writer::spawn(rx, PathBuf::from(dir));
            tx
        });
        let capture = config.capture_dir.clone().map(|dir| {
            let (tx, rx) = std::sync::mpsc::sync_channel(CHANNEL_CAPACITY);
            capture::spawn(rx, PathBuf::from(dir), config.capture_max_bytes());
            tx
        });
        AnalyticsHandle { events, capture }
    }

    pub fn events_enabled(&self) -> bool {
        self.events.is_some()
    }

    pub fn capture_enabled(&self) -> bool {
        self.capture.is_some()
    }

    pub fn emit(&self, event: AnalyticsEvent) {
        match &event {
            AnalyticsEvent::GameStarted { game_id, .. } => {
                self.send_capture(capture::CaptureMessage::Open {
                    game_id: game_id.clone(),
                    header: json_line(&event),
                });
            }
            AnalyticsEvent::GameEnded { game_id, .. } => {
                self.send_capture(capture::CaptureMessage::Close {
                    game_id: game_id.clone(),
                    footer: json_line(&event),
                });
            }
            _ => {}
        }
        if let Some(tx) = &self.events {
            if tx.try_send(event).is_err() {
                metrics::record_analytics_dropped();
            }
        }
    }

    pub fn capture_envelope(&self, game_id: &str, from_player: &str, envelope: &Value) {
        if self.capture.is_none() {
            return;
        }
        let line = json_line(&event::CaptureLine {
            ts: now_ts(),
            from: from_player,
            envelope,
        });
        self.send_capture(capture::CaptureMessage::Line {
            game_id: game_id.to_string(),
            line,
        });
    }

    fn send_capture(&self, message: capture::CaptureMessage) {
        if let Some(tx) = &self.capture {
            if tx.try_send(message).is_err() {
                metrics::record_analytics_dropped();
            }
        }
    }
}

pub fn now_ts() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn json_line<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_default()
}

pub fn game_started_event(started: &StartedGame) -> AnalyticsEvent {
    let players = started
        .player_order
        .iter()
        .map(|username| {
            let deck = started
                .player_decks
                .iter()
                .find(|deck| &deck.username == username);
            let is_bot = started
                .room_info
                .players
                .iter()
                .any(|player| &player.username == username && player.is_bot);
            SeatInfo {
                username: username.clone(),
                is_bot,
                deck_name: deck.map(|deck| deck.deck_name.clone()),
                commander: deck.and_then(|deck| deck.commander_name.clone()),
            }
        })
        .collect();
    AnalyticsEvent::GameStarted {
        ts: now_ts(),
        game_id: started.game_id.clone(),
        room_id: started.room_id.clone(),
        format: started.room_info.format.clone(),
        engine: started.room_info.engine,
        hosted: started.room_info.hosted,
        official: started.room_info.official,
        starting_life: started.starting_life,
        players,
    }
}

pub fn emit_game_ended(
    handle: &AnalyticsHandle,
    room: &Room,
    replay: &GameReplayCache,
    fallback: GameEndReason,
) {
    let reason = if replay.outcome.game_over {
        GameEndReason::GameOver
    } else if replay.outcome.fatal_message.is_some() {
        GameEndReason::EngineFatal
    } else {
        fallback
    };
    metrics::record_game_ended(reason);
    let winner = replay
        .outcome
        .winner_slot
        .as_deref()
        .and_then(|slot| replay.username_for_slot(slot));
    let conceded = replay
        .outcome
        .conceded_slots
        .iter()
        .filter_map(|slot| replay.username_for_slot(slot))
        .collect();
    handle.emit(AnalyticsEvent::GameEnded {
        ts: now_ts(),
        game_id: replay.game_id.clone(),
        room_id: room.room_id.clone(),
        reason,
        duration_s: replay.started_at.elapsed().as_secs_f64(),
        game_over: replay.outcome.game_over,
        winner,
        conceded,
        fatal_message: replay.outcome.fatal_message.clone(),
    });
}

pub fn aggregate_deck_cards(deck: &Deck) -> Vec<CardEntry> {
    let mut counts: HashMap<(String, String), u32> = HashMap::new();
    for card in &deck.cards {
        *counts
            .entry((card.identity.name.clone(), card.identity.set_code.clone()))
            .or_insert(0) += 1;
    }
    let mut cards: Vec<CardEntry> = counts
        .into_iter()
        .map(|((name, set_code), count)| CardEntry {
            name,
            set_code,
            count,
        })
        .collect();
    cards.sort_by(|a, b| a.name.cmp(&b.name));
    cards
}
