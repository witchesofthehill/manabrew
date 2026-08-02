mod auth;
mod config;
mod preset_decks;
mod rate_limit;
mod routes;
mod stats;
mod storage;
mod validate;

use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use manabrew_hub::dto::AdminTopDeckSnapshotEntry;
use tracing_subscriber::EnvFilter;

use crate::config::HubConfig;
use crate::rate_limit::RateLimiter;
use crate::routes::{build_router, AppState};
use crate::stats::StatsCache;
use crate::storage::{ReplaceSnapshotOutcome, Storage};

const RANKING_QUERY_LIMIT: u32 = 100;
const RANKING_RESULT_LIMIT: usize = 25;
const MIN_WIN_RATE_GAMES: u32 = 20;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("manabrew_hub=info")),
        )
        .init();
    let config = HubConfig::from_env();
    let ranking_refresh_interval = Duration::from_secs(config.ranking_refresh_seconds);
    if let Some(parent) = std::path::Path::new(&config.db_path).parent() {
        std::fs::create_dir_all(parent).expect("create hub db directory");
    }
    let storage = Storage::open(&config.db_path).expect("open hub db");
    let presets = preset_decks::load_preset_decks(std::path::Path::new(&config.preset_decks_dir))
        .expect("load preset decks");
    storage
        .sync_preset_decks(&presets, &chrono::Utc::now().to_rfc3339())
        .expect("sync preset decks");
    let state = Arc::new(AppState {
        storage: Mutex::new(storage),
        stats: StatsCache::new(config.events_db_path.clone()),
        limiter: RateLimiter::new(config.publish_per_hour),
        play_limiter: RateLimiter::new(config.play_reports_per_hour),
        deck_hub_enabled: config.deck_hub_enabled,
        publish_per_day: config.publish_per_day,
        auth_email_limiter: RateLimiter::new(config.auth.auth_emails_per_hour),
        auth_code_limiter: RateLimiter::new(config.auth.auth_attempts_per_hour),
        auth: config.auth.clone(),
        http: reqwest::Client::new(),
        identity: auth::IdentityKeys::load_or_generate(&config.jwt_key_path)
            .expect("load jwt signing key"),
    });
    refresh_top_deck_snapshots(&state);
    let ranking_state = Arc::clone(&state);
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(ranking_refresh_interval);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        interval.tick().await;
        loop {
            interval.tick().await;
            refresh_top_deck_snapshots(&ranking_state);
        }
    });
    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("bind hub listener");
    tracing::info!(%addr, db = %config.db_path, "manabrew-hub listening");
    axum::serve(
        listener,
        build_router(state).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .expect("serve hub");
}

fn refresh_top_deck_snapshots(state: &AppState) {
    for (bucket, format) in [("trending", None), ("commander", Some("commander"))] {
        let online_candidates = state
            .stats
            .top_publications("30d", format, RANKING_QUERY_LIMIT);
        let storage = state.storage.lock().unwrap();
        let cutoff = (chrono::Utc::now() - chrono::Duration::days(30))
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let offline_candidates =
            match storage.reported_publications(&cutoff, format, RANKING_QUERY_LIMIT) {
                Ok(candidates) => candidates,
                Err(error) => {
                    tracing::warn!(%error, bucket, "could not query offline deck plays");
                    Vec::new()
                }
            };
        if online_candidates.is_none() && offline_candidates.is_empty() {
            continue;
        }
        let mut candidates = BTreeMap::<(String, String), (u32, u32, u32)>::new();
        for candidate in online_candidates.unwrap_or_default() {
            candidates.insert(
                (candidate.published_deck_id, candidate.deck_fingerprint),
                (candidate.plays, candidate.completed_games, candidate.wins),
            );
        }
        for candidate in offline_candidates {
            let totals = candidates
                .entry((candidate.published_deck_id, candidate.deck_fingerprint))
                .or_default();
            totals.0 = totals.0.saturating_add(candidate.plays);
        }
        let mut candidates = candidates.into_iter().collect::<Vec<_>>();
        candidates.sort_by(
            |((left_id, _), left_totals), ((right_id, _), right_totals)| {
                right_totals
                    .0
                    .cmp(&left_totals.0)
                    .then_with(|| right_totals.1.cmp(&left_totals.1))
                    .then_with(|| left_id.cmp(right_id))
            },
        );
        let mut entries = Vec::new();
        for ((published_deck_id, deck_fingerprint), (plays, completed_games, wins)) in candidates {
            match storage.published_deck_matches(&published_deck_id, &deck_fingerprint) {
                Ok(true) => entries.push(AdminTopDeckSnapshotEntry {
                    deckhub_entry_id: published_deck_id,
                    rank: entries.len() as u32 + 1,
                    score: Some(f64::from(plays)),
                    reason: Some(ranking_reason(plays, completed_games, wins)),
                }),
                Ok(false) => {}
                Err(error) => {
                    tracing::warn!(%error, bucket, "could not validate ranked publication");
                }
            }
            if entries.len() == RANKING_RESULT_LIMIT {
                break;
            }
        }
        let now = chrono::Utc::now();
        let snapshot_date = now.format("%Y-%m-%d").to_string();
        match storage.replace_top_deck_snapshot(bucket, &snapshot_date, &entries, &now.to_rfc3339())
        {
            Ok(ReplaceSnapshotOutcome::Replaced) => {}
            Ok(outcome) => tracing::warn!(?outcome, bucket, "could not refresh top decks"),
            Err(error) => tracing::warn!(%error, bucket, "could not refresh top decks"),
        }
    }
}

fn ranking_reason(plays: u32, completed_games: u32, wins: u32) -> String {
    let mut reason = if plays == 1 {
        "Played once in the last 30 days".to_string()
    } else {
        format!("Played {} times in the last 30 days", format_count(plays))
    };
    if completed_games >= MIN_WIN_RATE_GAMES {
        let win_rate = f64::from(wins) * 100.0 / f64::from(completed_games);
        reason.push_str(&format!(
            " · {win_rate:.0}% win rate across {} completed online matches",
            format_count(completed_games)
        ));
    }
    reason
}

fn format_count(mut value: u32) -> String {
    let mut groups = Vec::new();
    loop {
        groups.push(value % 1_000);
        value /= 1_000;
        if value == 0 {
            break;
        }
    }
    let mut groups = groups.into_iter().rev();
    let mut formatted = groups.next().unwrap_or_default().to_string();
    for group in groups {
        formatted.push_str(&format!(",{group:03}"));
    }
    formatted
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("install ctrl-c handler");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install sigterm handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
