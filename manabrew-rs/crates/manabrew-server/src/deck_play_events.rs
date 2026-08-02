use std::time::Duration;

use serde::Serialize;
use tokio::sync::mpsc;

use crate::config::ServerConfig;
use crate::lobby::StartedGame;
use crate::metrics;
use crate::protocol::GameFormat;
use crate::replay::GameReplayCache;

const CHANNEL_CAPACITY: usize = 8192;

#[derive(Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
enum DeckPlayEvent {
    GameStarted {
        ts: String,
        game_id: String,
        format: GameFormat,
        hosted: bool,
        players: Vec<DeckPlayEventPlayer>,
    },
    GameEnded {
        game_id: String,
        game_over: bool,
        winner: Option<String>,
    },
}

#[derive(Serialize)]
struct DeckPlayEventPlayer {
    username: String,
    is_bot: bool,
    published_deck_id: Option<String>,
    deck_fingerprint: Option<String>,
}

#[derive(Clone)]
pub struct DeckPlayEventHandle {
    events: Option<mpsc::Sender<DeckPlayEvent>>,
}

impl DeckPlayEventHandle {
    pub fn disabled() -> Self {
        Self { events: None }
    }

    pub fn from_config(config: &ServerConfig) -> Self {
        if !config.deck_hub_enabled {
            return Self::disabled();
        }
        let events = config
            .hub_deck_plays_url
            .clone()
            .zip(config.hub_deck_plays_token.clone())
            .map(|(base_url, token)| {
                let (tx, rx) = mpsc::channel(CHANNEL_CAPACITY);
                spawn_writer(rx, base_url, token);
                tx
            });
        Self { events }
    }

    pub fn game_started(&self, started: &StartedGame) {
        let Some(events) = &self.events else {
            return;
        };
        let players = started
            .player_order
            .iter()
            .map(|username| {
                let deck = started
                    .player_decks
                    .iter()
                    .find(|deck| &deck.username == username);
                DeckPlayEventPlayer {
                    username: username.clone(),
                    is_bot: started
                        .room_info
                        .players
                        .iter()
                        .any(|player| &player.username == username && player.is_bot),
                    published_deck_id: deck.and_then(|deck| deck.published_deck_id.clone()),
                    deck_fingerprint: deck
                        .map(|deck| manabrew_protocol::deck_dto::deck_fingerprint(&deck.deck)),
                }
            })
            .collect();
        emit(
            events,
            DeckPlayEvent::GameStarted {
                ts: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                game_id: started.game_id.clone(),
                format: started.room_info.format.clone(),
                hosted: started.room_info.hosted,
                players,
            },
        );
    }

    pub fn game_ended(&self, replay: &GameReplayCache) {
        let Some(events) = &self.events else {
            return;
        };
        let winner = replay
            .outcome
            .winner_slot
            .as_deref()
            .and_then(|slot| replay.username_for_slot(slot));
        emit(
            events,
            DeckPlayEvent::GameEnded {
                game_id: replay.game_id.clone(),
                game_over: replay.outcome.game_over,
                winner,
            },
        );
    }
}

fn emit(events: &mpsc::Sender<DeckPlayEvent>, event: DeckPlayEvent) {
    if events.try_send(event).is_err() {
        metrics::record_deck_play_event_dropped();
    }
}

fn spawn_writer(mut events: mpsc::Receiver<DeckPlayEvent>, base_url: String, token: String) {
    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let url = format!(
            "{}/internal/deckhub/relay-games",
            base_url.trim_end_matches('/')
        );
        while let Some(event) = events.recv().await {
            let mut delivered = false;
            for attempt in 0..3 {
                match client
                    .post(&url)
                    .bearer_auth(&token)
                    .json(&event)
                    .send()
                    .await
                {
                    Ok(response) if response.status().is_success() => {
                        delivered = true;
                        break;
                    }
                    Ok(response) => {
                        tracing::warn!(status = %response.status(), "Hub deck event rejected");
                    }
                    Err(error) => tracing::warn!(%error, "Hub deck event delivery failed"),
                }
                tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
            }
            if !delivered {
                tracing::warn!("Hub deck event dropped after retries");
            }
        }
    });
}
