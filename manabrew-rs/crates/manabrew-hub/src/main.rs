mod assets;
mod auth;
mod config;
mod preset_decks;
mod rate_limit;
mod routes;
mod scryfall_api;
mod scryfall_bulk;
mod storage;
mod validate;

use std::cmp::Ordering;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use manabrew_hub::dto::AdminTopDeckSnapshotEntry;
use tracing_subscriber::EnvFilter;

use crate::assets::AssetService;
use crate::config::HubConfig;
use crate::rate_limit::RateLimiter;
use crate::routes::{build_router, AppState};
use crate::scryfall_api::ScryfallApi;
use crate::scryfall_bulk::ScryfallBulkIndex;
use crate::storage::{AnalyticsImportOutcome, ReplaceSnapshotOutcome, Storage};

const ASSET_SWEEP_INTERVAL: Duration = Duration::from_secs(5 * 60);
const ASSET_SWEEP_BATCH: u32 = 200;
const RANKING_QUERY_LIMIT: u32 = 100;
const RANKING_RESULT_LIMIT: usize = 25;
const MIN_WIN_RATE_GAMES: u32 = 20;
const RISING_MINIMUM_PLAYS: u32 = 3;
const NEW_NOTABLE_MINIMUM_PLAYS: u32 = 3;
const NEW_NOTABLE_FAVORITE_WEIGHT: u32 = 2;

struct SnapshotCandidate {
    deckhub_entry_id: String,
    deck_fingerprint: Option<String>,
    score: f64,
    reason: String,
}

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
    let storage = Storage::open(
        &config.db_path,
        config.assets.as_ref().map(|it| it.public_base_url.clone()),
    )
    .expect("open hub db");
    let presets = preset_decks::load_preset_decks(std::path::Path::new(&config.preset_decks_dir))
        .expect("load preset decks");
    storage
        .sync_preset_decks(&presets, &chrono::Utc::now().to_rfc3339())
        .expect("sync preset decks");
    if let Some(path) = config.analytics_import_db_path.as_deref() {
        for hosted in [false, true] {
            match storage.import_analytics_deck_plays(
                path,
                &chrono::Utc::now().to_rfc3339(),
                hosted,
            ) {
                Ok(AnalyticsImportOutcome::AlreadyCompleted) => {}
                Ok(AnalyticsImportOutcome::SourceUnavailable) => {
                    tracing::warn!(%path, "analytics deck-play import source unavailable");
                }
                Ok(AnalyticsImportOutcome::Imported { imported, skipped }) => {
                    tracing::info!(
                        hosted,
                        imported,
                        skipped,
                        "analytics deck-play import completed"
                    );
                }
                Err(error) => {
                    tracing::warn!(%error, %path, hosted, "analytics deck-play import failed")
                }
            }
        }
    }
    let http = reqwest::Client::builder()
        .user_agent("Manabrew/1.0 (+https://manabrew.app)")
        .default_headers({
            let mut headers = reqwest::header::HeaderMap::new();
            headers.insert(
                reqwest::header::ACCEPT,
                reqwest::header::HeaderValue::from_static("application/json;q=0.9,*/*;q=0.8"),
            );
            headers
        })
        .build()
        .expect("build HTTP client");
    let scryfall_bulk = Arc::new(ScryfallBulkIndex::new(config.scryfall_bulk_path.into()));
    let state = Arc::new(AppState {
        storage: Mutex::new(storage),
        limiter: RateLimiter::new(config.publish_per_hour),
        play_limiter: RateLimiter::new(config.play_reports_per_hour),
        collection_limiter: RateLimiter::new(300),
        deck_hub_enabled: config.deck_hub_enabled,
        publish_per_day: config.publish_per_day,
        relay_deck_plays_token: config.relay_deck_plays_token,
        auth_email_limiter: RateLimiter::new(config.auth.auth_emails_per_hour),
        auth_code_limiter: RateLimiter::new(config.auth.auth_attempts_per_hour),
        auth: config.auth.clone(),
        http: http.clone(),
        scryfall_bulk: Arc::clone(&scryfall_bulk),
        scryfall_api: ScryfallApi::new(),
        identity: auth::IdentityKeys::load_or_generate(&config.jwt_key_path)
            .expect("load jwt signing key"),
        assets: config.assets.as_ref().map(AssetService::new),
    });
    tokio::spawn(scryfall_bulk::refresh_loop(scryfall_bulk, http));
    if state.assets.is_some() {
        let sweep_state = Arc::clone(&state);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(ASSET_SWEEP_INTERVAL);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                interval.tick().await;
                sweep_expired_assets(&sweep_state).await;
            }
        });
    }
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

/// Reservations outlive the presigned URL, so an expiring one is only garbage if
/// the object never landed. The bucket is the source of truth for that, which is
/// why nothing asks the client to confirm its own upload.
async fn sweep_expired_assets(state: &AppState) {
    let Some(assets) = state.assets.as_ref() else {
        return;
    };
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let expired = state
        .storage
        .lock()
        .unwrap()
        .expired_pending_assets(&now, ASSET_SWEEP_BATCH);
    let expired = match expired {
        Ok(expired) => expired,
        Err(error) => {
            tracing::warn!(%error, "could not list expired asset reservations");
            return;
        }
    };
    for expired in expired {
        let asset_id = expired.id;
        let object_key = assets::object_key(&expired.account_id, expired.kind, &asset_id);
        let reconciled = match assets.store.size(&object_key).await {
            Ok(Some(byte_size)) => state
                .storage
                .lock()
                .unwrap()
                .confirm_pending_asset(&asset_id, byte_size),
            Ok(None) => state
                .storage
                .lock()
                .unwrap()
                .discard_pending_asset(&asset_id),
            Err(error) => {
                tracing::warn!(%error, asset_id, "could not read the uploaded asset");
                continue;
            }
        };
        if let Err(error) = reconciled {
            tracing::warn!(%error, asset_id, "could not reconcile the asset reservation");
        }
    }
}

fn refresh_top_deck_snapshots(state: &AppState) {
    let now = chrono::Utc::now();
    let thirty_days_ago =
        (now - chrono::Duration::days(30)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let seven_days_ago =
        (now - chrono::Duration::days(7)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let fourteen_days_ago =
        (now - chrono::Duration::days(14)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let snapshot_date = now.format("%Y-%m-%d").to_string();
    let created_at = now.to_rfc3339();
    let storage = state.storage.lock().unwrap();

    refresh_snapshot(
        &storage,
        "trending",
        &snapshot_date,
        &created_at,
        storage
            .ranked_publications(&thirty_days_ago, None, RANKING_QUERY_LIMIT)
            .map(|rows| {
                rows.into_iter()
                    .map(|row| SnapshotCandidate {
                        deckhub_entry_id: row.published_deck_id,
                        deck_fingerprint: Some(row.deck_fingerprint),
                        score: f64::from(row.plays),
                        reason: play_count_reason(
                            row.plays,
                            row.completed_games,
                            row.wins,
                            "in the last 30 days",
                        ),
                    })
                    .collect()
            }),
    );
    refresh_snapshot(
        &storage,
        "commander",
        &snapshot_date,
        &created_at,
        storage
            .ranked_publications(&thirty_days_ago, Some("commander"), RANKING_QUERY_LIMIT)
            .map(|rows| {
                rows.into_iter()
                    .map(|row| SnapshotCandidate {
                        deckhub_entry_id: row.published_deck_id,
                        deck_fingerprint: Some(row.deck_fingerprint),
                        score: f64::from(row.plays),
                        reason: play_count_reason(
                            row.plays,
                            row.completed_games,
                            row.wins,
                            "in the last 30 days",
                        ),
                    })
                    .collect()
            }),
    );
    refresh_snapshot(
        &storage,
        "rising",
        &snapshot_date,
        &created_at,
        storage
            .rising_publications(&seven_days_ago, &fourteen_days_ago, RISING_MINIMUM_PLAYS)
            .map(rising_candidates),
    );
    refresh_snapshot(
        &storage,
        "win-rate",
        &snapshot_date,
        &created_at,
        storage
            .win_rate_publications(&thirty_days_ago, MIN_WIN_RATE_GAMES)
            .map(win_rate_candidates),
    );
    refresh_snapshot(
        &storage,
        "favorites",
        &snapshot_date,
        &created_at,
        storage
            .most_favorited_publications(RANKING_QUERY_LIMIT)
            .map(|rows| {
                rows.into_iter()
                    .map(|row| SnapshotCandidate {
                        deckhub_entry_id: row.published_deck_id,
                        deck_fingerprint: None,
                        score: f64::from(row.favorites),
                        reason: favorite_reason(row.favorites),
                    })
                    .collect()
            }),
    );
    refresh_snapshot(
        &storage,
        "new-notable",
        &snapshot_date,
        &created_at,
        storage
            .new_notable_publications(
                &thirty_days_ago,
                &thirty_days_ago,
                NEW_NOTABLE_MINIMUM_PLAYS,
                NEW_NOTABLE_FAVORITE_WEIGHT,
                RANKING_QUERY_LIMIT,
            )
            .map(|rows| {
                rows.into_iter()
                    .map(|row| SnapshotCandidate {
                        deckhub_entry_id: row.published_deck_id,
                        deck_fingerprint: None,
                        score: f64::from(row.plays)
                            + f64::from(row.favorites) * f64::from(NEW_NOTABLE_FAVORITE_WEIGHT),
                        reason: new_notable_reason(row.plays, row.favorites),
                    })
                    .collect()
            }),
    );
}

fn refresh_snapshot(
    storage: &Storage,
    bucket: &str,
    snapshot_date: &str,
    created_at: &str,
    candidates: rusqlite::Result<Vec<SnapshotCandidate>>,
) {
    let candidates = match candidates {
        Ok(candidates) => candidates,
        Err(error) => {
            tracing::warn!(%error, bucket, "could not query top decks");
            return;
        }
    };
    let mut entries = Vec::new();
    for candidate in candidates {
        let available = match candidate.deck_fingerprint.as_deref() {
            Some(fingerprint) => {
                storage.published_deck_matches(&candidate.deckhub_entry_id, fingerprint)
            }
            None => Ok(true),
        };
        match available {
            Ok(true) => entries.push(AdminTopDeckSnapshotEntry {
                deckhub_entry_id: candidate.deckhub_entry_id,
                rank: entries.len() as u32 + 1,
                score: Some(candidate.score),
                reason: Some(candidate.reason),
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
    match storage.replace_top_deck_snapshot(bucket, snapshot_date, &entries, created_at) {
        Ok(ReplaceSnapshotOutcome::Replaced) => {}
        Ok(outcome) => tracing::warn!(?outcome, bucket, "could not refresh top decks"),
        Err(error) => tracing::warn!(%error, bucket, "could not refresh top decks"),
    }
}

fn rising_candidates(rows: Vec<crate::storage::RisingPublication>) -> Vec<SnapshotCandidate> {
    let mut candidates = rows
        .into_iter()
        .filter(|row| row.recent_plays > row.previous_plays)
        .map(|row| {
            let score = (f64::from(row.recent_plays) + 2.0) / (f64::from(row.previous_plays) + 2.0);
            let reason = if row.previous_plays == 0 {
                format!(
                    "Played {} times this week after no plays the week before",
                    format_count(row.recent_plays)
                )
            } else {
                let growth = ((f64::from(row.recent_plays) / f64::from(row.previous_plays) - 1.0)
                    * 100.0)
                    .round() as u32;
                format!(
                    "Played {} times this week · up {}% from the week before",
                    format_count(row.recent_plays),
                    format_count(growth)
                )
            };
            SnapshotCandidate {
                deckhub_entry_id: row.published_deck_id,
                deck_fingerprint: Some(row.deck_fingerprint),
                score,
                reason,
            }
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.deckhub_entry_id.cmp(&right.deckhub_entry_id))
    });
    candidates.truncate(RANKING_QUERY_LIMIT as usize);
    candidates
}

fn win_rate_candidates(rows: Vec<crate::storage::RankedPublication>) -> Vec<SnapshotCandidate> {
    let mut candidates = rows
        .into_iter()
        .map(|row| {
            let win_rate = f64::from(row.wins) * 100.0 / f64::from(row.completed_games);
            SnapshotCandidate {
                deckhub_entry_id: row.published_deck_id,
                deck_fingerprint: Some(row.deck_fingerprint),
                score: wilson_lower_bound(row.wins, row.completed_games) * 100.0,
                reason: format!(
                    "{win_rate:.0}% win rate across {} completed online matches",
                    format_count(row.completed_games)
                ),
            }
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.deckhub_entry_id.cmp(&right.deckhub_entry_id))
    });
    candidates.truncate(RANKING_QUERY_LIMIT as usize);
    candidates
}

fn play_count_reason(plays: u32, completed_games: u32, wins: u32, period: &str) -> String {
    let mut reason = if plays == 1 {
        format!("Played once {period}")
    } else {
        format!("Played {} times {period}", format_count(plays))
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

fn favorite_reason(favorites: u32) -> String {
    if favorites == 1 {
        "One Community favorite".to_string()
    } else {
        format!("{} Community favorites", format_count(favorites))
    }
}

fn new_notable_reason(plays: u32, favorites: u32) -> String {
    match (plays, favorites) {
        (0, favorites) => favorite_reason(favorites),
        (plays, 0) => play_count_reason(plays, 0, 0, "since publication"),
        (plays, favorites) => format!(
            "Played {} times · {}",
            format_count(plays),
            favorite_reason(favorites)
        ),
    }
}

fn wilson_lower_bound(wins: u32, games: u32) -> f64 {
    let games = f64::from(games);
    let win_rate = f64::from(wins) / games;
    let z = 1.96;
    let z_squared = z * z;
    (win_rate + z_squared / (2.0 * games)
        - z * ((win_rate * (1.0 - win_rate) + z_squared / (4.0 * games)) / games).sqrt())
        / (1.0 + z_squared / games)
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
