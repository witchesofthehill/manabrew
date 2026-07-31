use std::collections::BTreeSet;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::extract::{ConnectInfo, DefaultBodyLimit, Path, Query, State};
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use chrono::{SecondsFormat, Utc};
use manabrew_hub::dto::{
    AccountDeckList, AdminTopDeckSnapshotRequest, CreateAccountDeckRequest, DeckHubEntryList,
    HubCapabilities, HubDeckList, HubDeckSummary, PublishDeckHubEntryRequest, PublishDeckRequest,
    PublishDeckResponse, SaveDeckVersionRequest, UpdateDeckHubEntryRequest,
};
use manabrew_protocol::deck_dto::{Deck, DeckCard};
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::auth;
use crate::config::AuthConfig;
use crate::rate_limit::RateLimiter;
use crate::stats::StatsCache;
use crate::storage::{
    DeckHubColorMatch, DeckHubEntryUpdate, DeckHubListParams, DeckHubSortOrder, DeckHubTagMatch,
    DeleteOutcome, ListParams, NewDeckHubEntry, NewHubDeck, ReplaceSnapshotOutcome,
    SaveVersionOutcome, SortOrder, Storage,
};
use crate::validate;

const MAX_BODY_BYTES: usize = 1024 * 1024;
const DEFAULT_PAGE_SIZE: u32 = 20;
const MAX_PAGE_SIZE: u32 = 50;
const DEFAULT_TOP_DECKS: u32 = 25;
const MAX_TOP_DECKS: u32 = 100;
const MANAGEMENT_TOKEN_HEADER: &str = "x-management-token";
const FORWARDED_FOR_HEADER: &str = "x-forwarded-for";
const MANAGEMENT_TOKEN_BYTES: usize = 32;
const COLOR_ORDER: &str = "WUBRG";

pub struct AppState {
    pub storage: Mutex<Storage>,
    pub stats: StatsCache,
    pub limiter: RateLimiter,
    pub publish_per_day: u32,
    pub auth: AuthConfig,
    pub auth_email_limiter: RateLimiter,
    pub auth_code_limiter: RateLimiter,
    pub http: reqwest::Client,
    pub identity: auth::IdentityKeys,
}

// The Tauri shells load from fixed webview origins; the web app origin comes
// from WEB_APP_URL per environment.
fn cors_origins(web_app_url: &str) -> AllowOrigin {
    let mut origins = vec![
        HeaderValue::from_static("tauri://localhost"),
        HeaderValue::from_static("http://tauri.localhost"),
    ];
    if let Some(origin) = reqwest::Url::parse(web_app_url)
        .ok()
        .map(|url| url.origin().ascii_serialization())
        .and_then(|origin| HeaderValue::from_str(&origin).ok())
    {
        origins.push(origin);
    }
    AllowOrigin::list(origins)
}

pub fn build_router(state: Arc<AppState>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(cors_origins(&state.auth.web_app_url))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::PATCH,
        ])
        .allow_headers([
            CONTENT_TYPE,
            AUTHORIZATION,
            HeaderName::from_static(MANAGEMENT_TOKEN_HEADER),
        ]);
    Router::new()
        .route("/health", get(health_handler))
        .route("/api/hub/capabilities", get(capabilities_handler))
        .route(
            "/api/decks",
            get(account_decks_handler).post(create_account_deck_handler),
        )
        .route(
            "/api/decks/:id",
            get(account_deck_handler)
                .patch(save_account_deck_handler)
                .delete(delete_account_deck_handler),
        )
        .route("/api/decks/:id/versions", get(deck_versions_handler))
        .route(
            "/api/decks/:id/versions/:version_no",
            get(deck_version_handler),
        )
        .route(
            "/api/deckhub/entries",
            get(deckhub_entries_handler).post(create_deckhub_entry_handler),
        )
        .route(
            "/api/deckhub/entries/:entry_ref",
            get(deckhub_entry_handler)
                .patch(update_deckhub_entry_handler)
                .delete(unpublish_deckhub_entry_handler),
        )
        .route(
            "/api/deckhub/entries/:id/favorite",
            put(favorite_deckhub_entry_handler).delete(unfavorite_deckhub_entry_handler),
        )
        .route("/api/deckhub/tags", get(deckhub_tags_handler))
        .route("/api/deckhub/facets", get(deckhub_facets_handler))
        .route("/api/deckhub/top/buckets", get(top_deck_buckets_handler))
        .route("/api/deckhub/top/:bucket", get(top_deck_snapshot_handler))
        .route(
            "/admin/deckhub/top/:bucket",
            post(replace_top_deck_snapshot_handler),
        )
        .route("/api/hub/decks", get(list_handler).post(publish_handler))
        .route(
            "/api/hub/decks/:id",
            get(detail_handler).delete(delete_handler),
        )
        .route("/api/hub/my-decks", get(my_decks_handler))
        .route("/admin/decks/:id", delete(admin_delete_handler))
        .route("/admin/decks/:id/unlist", post(admin_unlist_handler))
        .route("/api/stats/top-decks", get(top_decks_handler))
        .route("/api/auth/providers", get(auth::providers_handler))
        .route(
            "/api/auth/oauth/:provider/start",
            post(auth::oauth_start_handler),
        )
        .route(
            "/api/auth/callback/:provider",
            get(auth::oauth_callback_handler),
        )
        .route("/api/auth/exchange", post(auth::exchange_handler))
        .route("/api/auth/email/request", post(auth::email_request_handler))
        .route("/api/auth/email/verify", post(auth::email_verify_handler))
        .route(
            "/api/auth/me",
            get(auth::me_handler).patch(auth::update_handle_handler),
        )
        .route("/api/auth/logout", post(auth::logout_handler))
        .route("/api/auth/token", post(auth::token_handler))
        .route("/api/auth/jwks", get(auth::jwks_handler))
        .route(
            "/api/auth/identities/:provider",
            delete(auth::unlink_identity_handler),
        )
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(cors)
        .with_state(state)
}

async fn health_handler() -> &'static str {
    "ok"
}

async fn capabilities_handler() -> Json<HubCapabilities> {
    Json(HubCapabilities {
        domain_version: 2,
        account_decks: true,
        tags: true,
        favorites: true,
        top_deck_snapshots: true,
    })
}

async fn account_decks_handler(
    State(state): State<Arc<AppState>>,
    auth::SessionAccount(account): auth::SessionAccount,
) -> Response {
    match state.storage.lock().unwrap().list_owned_decks(&account.id) {
        Ok(decks) => Json(AccountDeckList { decks }).into_response(),
        Err(error) => internal_error(error),
    }
}

async fn create_account_deck_handler(
    State(state): State<Arc<AppState>>,
    auth::SessionAccount(account): auth::SessionAccount,
    Json(request): Json<CreateAccountDeckRequest>,
) -> Response {
    let validation = PublishDeckRequest {
        author: account.handle,
        deck: request.deck.clone(),
    };
    if let Err(message) = validate::validate(&validation) {
        return (StatusCode::UNPROCESSABLE_ENTITY, message).into_response();
    }
    let mut deck = request.deck;
    validate::sanitize(&mut deck);
    match state.storage.lock().unwrap().create_account_deck(
        &account.id,
        &deck,
        request.notes.as_deref(),
        &now_string(),
    ) {
        Ok(detail) => (StatusCode::CREATED, Json(detail)).into_response(),
        Err(error) => internal_error(error),
    }
}

async fn account_deck_handler(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    auth::SessionAccount(account): auth::SessionAccount,
) -> Response {
    match state
        .storage
        .lock()
        .unwrap()
        .get_account_deck(&account.id, &id)
    {
        Ok(Some(detail)) => Json(detail).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal_error(error),
    }
}

async fn save_account_deck_handler(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    auth::SessionAccount(account): auth::SessionAccount,
    Json(request): Json<SaveDeckVersionRequest>,
) -> Response {
    let validation = PublishDeckRequest {
        author: account.handle,
        deck: request.deck.clone(),
    };
    if let Err(message) = validate::validate(&validation) {
        return (StatusCode::UNPROCESSABLE_ENTITY, message).into_response();
    }
    let mut deck = request.deck;
    validate::sanitize(&mut deck);
    match state.storage.lock().unwrap().save_account_deck(
        &account.id,
        &id,
        request.expected_version_no,
        &deck,
        request.notes.as_deref(),
        &now_string(),
    ) {
        Ok(SaveVersionOutcome::Saved(detail) | SaveVersionOutcome::Unchanged(detail)) => {
            Json(detail).into_response()
        }
        Ok(SaveVersionOutcome::Conflict) => StatusCode::CONFLICT.into_response(),
        Ok(SaveVersionOutcome::Forbidden) => StatusCode::FORBIDDEN.into_response(),
        Ok(SaveVersionOutcome::NotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal_error(error),
    }
}

async fn delete_account_deck_handler(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    auth::SessionAccount(account): auth::SessionAccount,
) -> Response {
    match state
        .storage
        .lock()
        .unwrap()
        .delete_account_deck(&account.id, &id, &now_string())
    {
        Ok(DeleteOutcome::Deleted) => StatusCode::NO_CONTENT.into_response(),
        Ok(DeleteOutcome::Forbidden) => StatusCode::FORBIDDEN.into_response(),
        Ok(DeleteOutcome::NotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal_error(error),
    }
}

async fn deck_versions_handler(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    auth::SessionAccount(account): auth::SessionAccount,
) -> Response {
    match state
        .storage
        .lock()
        .unwrap()
        .list_deck_versions(&account.id, &id)
    {
        Ok(Some(versions)) => Json(versions).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal_error(error),
    }
}

async fn deck_version_handler(
    State(state): State<Arc<AppState>>,
    Path((id, version_no)): Path<(String, u32)>,
    auth::SessionAccount(account): auth::SessionAccount,
) -> Response {
    match state
        .storage
        .lock()
        .unwrap()
        .get_deck_version(&account.id, &id, version_no)
    {
        Ok(Some(version)) => Json(version).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal_error(error),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeckHubListQuery {
    search: Option<String>,
    format: Option<String>,
    formats: Option<String>,
    tag: Option<String>,
    tags: Option<String>,
    colors: Option<String>,
    color_match: Option<String>,
    tag_match: Option<String>,
    commander: Option<String>,
    card: Option<String>,
    favorites: Option<bool>,
    sort: Option<String>,
    page: Option<u32>,
    page_size: Option<u32>,
}

async fn deckhub_entries_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<DeckHubListQuery>,
) -> Response {
    let viewer_account_id = match auth::bearer_account(&state, &headers) {
        Ok(account) => account.map(|account| account.id),
        Err(error) => return internal_error(error),
    };
    let page_size = query
        .page_size
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(1, MAX_PAGE_SIZE);
    let params = DeckHubListParams {
        search: query.search,
        formats: csv_values(query.formats.or(query.format)),
        colors: query.colors.as_deref().and_then(normalize_colors),
        color_match: match query.color_match.as_deref() {
            Some("includes") => DeckHubColorMatch::Includes,
            _ => DeckHubColorMatch::Exact,
        },
        tags: csv_values(query.tags.or(query.tag)),
        tag_match: match query.tag_match.as_deref() {
            Some("all") => DeckHubTagMatch::All,
            _ => DeckHubTagMatch::Any,
        },
        commander: query.commander,
        card: query.card,
        favorites_only: query.favorites.unwrap_or(false),
        sort: match query.sort.as_deref() {
            Some("name") => DeckHubSortOrder::Name,
            Some("favorites") => DeckHubSortOrder::Favorites,
            _ => DeckHubSortOrder::Newest,
        },
        page: query.page.unwrap_or(1).max(1),
        page_size,
        viewer_account_id,
    };
    match state.storage.lock().unwrap().list_deckhub_entries(&params) {
        Ok((entries, total)) => Json(DeckHubEntryList {
            entries,
            total,
            page: params.page,
            page_size,
        })
        .into_response(),
        Err(error) => internal_error(error),
    }
}

async fn deckhub_entry_handler(
    State(state): State<Arc<AppState>>,
    Path(entry_ref): Path<String>,
    headers: HeaderMap,
) -> Response {
    let viewer_account_id = match auth::bearer_account(&state, &headers) {
        Ok(account) => account.map(|account| account.id),
        Err(error) => return internal_error(error),
    };
    match state
        .storage
        .lock()
        .unwrap()
        .get_deckhub_entry(&entry_ref, viewer_account_id.as_deref())
    {
        Ok(Some(entry)) => Json(entry).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal_error(error),
    }
}

async fn create_deckhub_entry_handler(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    auth::SessionAccount(account): auth::SessionAccount,
    Json(request): Json<PublishDeckHubEntryRequest>,
) -> Response {
    if let Err(message) =
        validate_entry_metadata(&request.title, request.summary.as_deref(), &request.tags)
    {
        return (StatusCode::UNPROCESSABLE_ENTITY, message).into_response();
    }
    let ip = client_ip(&headers, addr);
    if !state.limiter.allow(&ip) {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    let day_ago =
        (Utc::now() - chrono::Duration::hours(24)).to_rfc3339_opts(SecondsFormat::Secs, true);
    match state.storage.lock().unwrap().publishes_since(&ip, &day_ago) {
        Ok(count) if count >= state.publish_per_day => {
            return StatusCode::TOO_MANY_REQUESTS.into_response();
        }
        Ok(_) => {}
        Err(error) => return internal_error(error),
    }
    let entry = NewDeckHubEntry {
        deck_id: request.deck_id,
        published_version_id: request.published_version_id,
        title: request.title.trim().to_string(),
        summary: request.summary.map(|summary| summary.trim().to_string()),
        tags: request.tags,
        cover_card_id: request.cover_card_id,
        cover_card_name: request.cover_card_name,
        publish_ip: ip,
        created_at: now_string(),
    };
    match state
        .storage
        .lock()
        .unwrap()
        .create_deckhub_entry(&account.id, &entry)
    {
        Ok(Some(detail)) => (StatusCode::CREATED, Json(detail)).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal_error(error),
    }
}

async fn update_deckhub_entry_handler(
    State(state): State<Arc<AppState>>,
    Path(entry_id): Path<String>,
    auth::SessionAccount(account): auth::SessionAccount,
    Json(request): Json<UpdateDeckHubEntryRequest>,
) -> Response {
    if let Err(message) =
        validate_entry_metadata(&request.title, request.summary.as_deref(), &request.tags)
    {
        return (StatusCode::UNPROCESSABLE_ENTITY, message).into_response();
    }
    let update = DeckHubEntryUpdate {
        title: request.title.trim().to_string(),
        summary: request.summary.map(|summary| summary.trim().to_string()),
        tags: request.tags,
        cover_card_id: request.cover_card_id,
        cover_card_name: request.cover_card_name,
        updated_at: now_string(),
    };
    let outcome =
        state
            .storage
            .lock()
            .unwrap()
            .update_deckhub_entry(&account.id, &entry_id, &update);
    match outcome {
        Ok(DeleteOutcome::Deleted) => match state
            .storage
            .lock()
            .unwrap()
            .get_deckhub_entry(&entry_id, Some(&account.id))
        {
            Ok(Some(detail)) => Json(detail).into_response(),
            Ok(None) => StatusCode::NOT_FOUND.into_response(),
            Err(error) => internal_error(error),
        },
        Ok(DeleteOutcome::Forbidden) => StatusCode::FORBIDDEN.into_response(),
        Ok(DeleteOutcome::NotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal_error(error),
    }
}

async fn unpublish_deckhub_entry_handler(
    State(state): State<Arc<AppState>>,
    Path(entry_id): Path<String>,
    auth::SessionAccount(account): auth::SessionAccount,
) -> Response {
    match state.storage.lock().unwrap().unpublish_deckhub_entry(
        &account.id,
        &entry_id,
        &now_string(),
    ) {
        Ok(DeleteOutcome::Deleted) => StatusCode::NO_CONTENT.into_response(),
        Ok(DeleteOutcome::Forbidden) => StatusCode::FORBIDDEN.into_response(),
        Ok(DeleteOutcome::NotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal_error(error),
    }
}

async fn favorite_deckhub_entry_handler(
    State(state): State<Arc<AppState>>,
    Path(entry_id): Path<String>,
    auth::SessionAccount(account): auth::SessionAccount,
) -> Response {
    set_favorite_response(&state, &account.id, &entry_id, true)
}

async fn unfavorite_deckhub_entry_handler(
    State(state): State<Arc<AppState>>,
    Path(entry_id): Path<String>,
    auth::SessionAccount(account): auth::SessionAccount,
) -> Response {
    set_favorite_response(&state, &account.id, &entry_id, false)
}

fn set_favorite_response(
    state: &AppState,
    account_id: &str,
    entry_id: &str,
    favorite: bool,
) -> Response {
    match state
        .storage
        .lock()
        .unwrap()
        .set_favorite(account_id, entry_id, favorite, &now_string())
    {
        Ok(Some(response)) => Json(response).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal_error(error),
    }
}

async fn deckhub_tags_handler(State(state): State<Arc<AppState>>) -> Response {
    match state.storage.lock().unwrap().list_tags() {
        Ok(tags) => Json(tags).into_response(),
        Err(error) => internal_error(error),
    }
}

async fn deckhub_facets_handler(State(state): State<Arc<AppState>>) -> Response {
    match state.storage.lock().unwrap().deckhub_facets() {
        Ok(facets) => Json(facets).into_response(),
        Err(error) => internal_error(error),
    }
}

async fn top_deck_buckets_handler(State(state): State<Arc<AppState>>) -> Response {
    match state.storage.lock().unwrap().list_top_deck_buckets() {
        Ok(buckets) => Json(buckets).into_response(),
        Err(error) => internal_error(error),
    }
}

#[derive(Deserialize)]
struct SnapshotQuery {
    date: Option<String>,
}

async fn top_deck_snapshot_handler(
    State(state): State<Arc<AppState>>,
    Path(bucket): Path<String>,
    headers: HeaderMap,
    Query(query): Query<SnapshotQuery>,
) -> Response {
    let viewer_account_id = match auth::bearer_account(&state, &headers) {
        Ok(account) => account.map(|account| account.id),
        Err(error) => return internal_error(error),
    };
    match state.storage.lock().unwrap().get_top_deck_snapshot(
        &bucket,
        query.date.as_deref(),
        viewer_account_id.as_deref(),
    ) {
        Ok(Some(snapshot)) => Json(snapshot).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal_error(error),
    }
}

async fn replace_top_deck_snapshot_handler(
    State(state): State<Arc<AppState>>,
    Path(bucket): Path<String>,
    Json(request): Json<AdminTopDeckSnapshotRequest>,
) -> Response {
    let unique_ranks = request
        .entries
        .iter()
        .map(|entry| entry.rank)
        .collect::<BTreeSet<_>>();
    let unique_entries = request
        .entries
        .iter()
        .map(|entry| entry.deckhub_entry_id.as_str())
        .collect::<BTreeSet<_>>();
    if !valid_snapshot_date(&request.snapshot_date)
        || request.entries.iter().any(|entry| entry.rank == 0)
        || unique_ranks.len() != request.entries.len()
        || unique_entries.len() != request.entries.len()
    {
        return StatusCode::UNPROCESSABLE_ENTITY.into_response();
    }
    match state.storage.lock().unwrap().replace_top_deck_snapshot(
        &bucket,
        &request.snapshot_date,
        &request.entries,
        &now_string(),
    ) {
        Ok(ReplaceSnapshotOutcome::Replaced) => StatusCode::NO_CONTENT.into_response(),
        Ok(ReplaceSnapshotOutcome::BucketNotFound) => StatusCode::NOT_FOUND.into_response(),
        Ok(ReplaceSnapshotOutcome::EntryUnavailable) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "top decks require published DeckHub entries",
        )
            .into_response(),
        Err(error) => internal_error(error),
    }
}

fn csv_values(value: Option<String>) -> Vec<String> {
    let mut values = Vec::new();
    for item in value
        .iter()
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let normalized = item.to_lowercase();
        if !values.contains(&normalized) {
            values.push(normalized);
        }
    }
    values
}

fn normalize_colors(value: &str) -> Option<String> {
    let value = value.to_ascii_uppercase();
    let normalized = "WUBRGC"
        .chars()
        .filter(|color| value.contains(*color))
        .collect::<String>();
    (!normalized.is_empty()).then_some(normalized)
}

fn validate_entry_metadata(
    title: &str,
    summary: Option<&str>,
    tags: &[String],
) -> Result<(), String> {
    let title_len = title.trim().chars().count();
    if !(1..=100).contains(&title_len) {
        return Err("title must be 1-100 characters".into());
    }
    if summary.is_some_and(|summary| summary.chars().count() > 500) {
        return Err("summary exceeds 500 characters".into());
    }
    if tags.len() > 10 {
        return Err("more than 10 tags".into());
    }
    if tags.iter().any(|tag| {
        let len = tag.trim().chars().count();
        !(1..=32).contains(&len) || tag.chars().any(char::is_control)
    }) {
        return Err("tags must be 1-32 characters".into());
    }
    Ok(())
}

fn valid_snapshot_date(value: &str) -> bool {
    chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
}

fn now_string() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListQuery {
    search: Option<String>,
    format: Option<String>,
    sort: Option<String>,
    page: Option<u32>,
    page_size: Option<u32>,
}

async fn list_handler(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ListQuery>,
) -> Response {
    let page_size = query
        .page_size
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(1, MAX_PAGE_SIZE);
    let params = ListParams {
        search: query.search,
        format: query.format,
        sort: match query.sort.as_deref() {
            Some("name") => SortOrder::Name,
            _ => SortOrder::Newest,
        },
        page: query.page.unwrap_or(1).max(1),
        page_size,
    };
    match state.storage.lock().unwrap().list_decks(&params) {
        Ok((decks, total)) => Json(HubDeckList {
            decks,
            total,
            page: params.page,
            page_size,
        })
        .into_response(),
        Err(error) => internal_error(error),
    }
}

async fn detail_handler(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    match state.storage.lock().unwrap().get_deck(&id) {
        Ok(Some(detail)) => Json(detail).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal_error(error),
    }
}

async fn publish_handler(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    auth::SessionAccount(account): auth::SessionAccount,
    Json(request): Json<PublishDeckRequest>,
) -> Response {
    let ip = client_ip(&headers, addr);
    let request = PublishDeckRequest {
        author: account.handle.clone(),
        deck: request.deck,
    };
    if let Err(message) = validate::validate(&request) {
        return (StatusCode::UNPROCESSABLE_ENTITY, message).into_response();
    }
    if !state.limiter.allow(&ip) {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    let day_ago =
        (Utc::now() - chrono::Duration::hours(24)).to_rfc3339_opts(SecondsFormat::Secs, true);
    let published_today = match state.storage.lock().unwrap().publishes_since(&ip, &day_ago) {
        Ok(count) => count,
        Err(error) => return internal_error(error),
    };
    if published_today >= state.publish_per_day {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    let mut deck = request.deck;
    validate::sanitize(&mut deck);
    let summary = build_summary(&deck, request.author.trim());
    let deck_json = match serde_json::to_string(&deck) {
        Ok(json) => json,
        Err(error) => return internal_error(error),
    };
    let token = generate_token();
    let record = NewHubDeck {
        summary,
        deck_json,
        management_token_hash: hash_token(&token),
        publish_ip: ip,
        account_id: account.id,
    };
    if let Err(error) = state.storage.lock().unwrap().insert_deck(&record) {
        return internal_error(error);
    }
    (
        StatusCode::CREATED,
        Json(PublishDeckResponse {
            id: record.summary.id,
            management_token: token,
        }),
    )
        .into_response()
}

async fn delete_handler(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    match auth::bearer_account(&state, &headers) {
        Ok(Some(account)) => {
            let outcome = state
                .storage
                .lock()
                .unwrap()
                .delete_deck_owned(&id, &account.id);
            match outcome {
                Ok(DeleteOutcome::Deleted) => return StatusCode::NO_CONTENT.into_response(),
                Ok(DeleteOutcome::NotFound) => return StatusCode::NOT_FOUND.into_response(),
                Ok(DeleteOutcome::Forbidden) => {}
                Err(error) => return internal_error(error),
            }
        }
        Ok(None) => {}
        Err(error) => return internal_error(error),
    }
    let Some(token) = headers
        .get(MANAGEMENT_TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .filter(|token| !token.is_empty())
    else {
        return StatusCode::FORBIDDEN.into_response();
    };
    match state
        .storage
        .lock()
        .unwrap()
        .delete_deck(&id, &hash_token(token))
    {
        Ok(DeleteOutcome::Deleted) => StatusCode::NO_CONTENT.into_response(),
        Ok(DeleteOutcome::Forbidden) => StatusCode::FORBIDDEN.into_response(),
        Ok(DeleteOutcome::NotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal_error(error),
    }
}

const MY_DECKS_LIMIT: u32 = 200;

async fn my_decks_handler(
    State(state): State<Arc<AppState>>,
    auth::SessionAccount(account): auth::SessionAccount,
) -> Response {
    match state
        .storage
        .lock()
        .unwrap()
        .list_account_decks(&account.id, MY_DECKS_LIMIT)
    {
        Ok(decks) => {
            let total = decks.len() as u32;
            Json(HubDeckList {
                decks,
                total,
                page: 1,
                page_size: MY_DECKS_LIMIT,
            })
            .into_response()
        }
        Err(error) => internal_error(error),
    }
}

async fn admin_delete_handler(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Response {
    match state.storage.lock().unwrap().admin_delete(&id) {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal_error(error),
    }
}

async fn admin_unlist_handler(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Response {
    match state.storage.lock().unwrap().admin_unlist(&id) {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal_error(error),
    }
}

#[derive(Deserialize)]
struct TopDecksQuery {
    window: Option<String>,
    limit: Option<u32>,
}

async fn top_decks_handler(
    State(state): State<Arc<AppState>>,
    Query(query): Query<TopDecksQuery>,
) -> Response {
    let window = match query.window.as_deref() {
        Some("7d") => "7d",
        Some("30d") => "30d",
        _ => "all",
    };
    let limit = query
        .limit
        .unwrap_or(DEFAULT_TOP_DECKS)
        .clamp(1, MAX_TOP_DECKS);
    let ranked = state.stats.top_decks(window, limit);
    let storage = state.storage.lock().unwrap();
    let mut stats = Vec::with_capacity(ranked.len());
    for mut deck in ranked {
        let linked = match (
            deck.stat.published_deck_id.as_deref(),
            deck.deck_fingerprint.as_deref(),
        ) {
            (Some(id), Some(fingerprint)) => {
                match storage.published_deck_matches(id, fingerprint) {
                    Ok(matches) => matches,
                    Err(error) => return internal_error(error),
                }
            }
            _ => false,
        };
        if !linked {
            deck.stat.published_deck_id = None;
        }
        stats.push(deck.stat);
    }
    Json(stats).into_response()
}

// Last hop only: earlier entries are client-supplied and spoofable; the final
// one is appended by our own Caddy in front of this service.
pub(crate) fn client_ip(headers: &HeaderMap, addr: SocketAddr) -> String {
    headers
        .get(FORWARDED_FOR_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next_back())
        .map(|ip| ip.trim().to_string())
        .filter(|ip| !ip.is_empty())
        .unwrap_or_else(|| addr.ip().to_string())
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub(crate) fn generate_token() -> String {
    let mut bytes = [0u8; MANAGEMENT_TOKEN_BYTES];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex_encode(&bytes)
}

pub(crate) fn hash_token(token: &str) -> String {
    hex_encode(&Sha256::digest(token.as_bytes()))
}

pub(crate) fn internal_error(error: impl std::fmt::Display) -> Response {
    tracing::error!(%error, "hub request failed");
    StatusCode::INTERNAL_SERVER_ERROR.into_response()
}

fn build_summary(deck: &Deck, author: &str) -> HubDeckSummary {
    let commanders: Vec<String> = deck
        .commanders
        .as_deref()
        .unwrap_or_default()
        .iter()
        .map(|card| card.identity.name.clone())
        .collect();
    HubDeckSummary {
        id: uuid::Uuid::new_v4().to_string(),
        name: deck.name.trim().to_string(),
        author: author.to_string(),
        description: deck
            .description
            .as_deref()
            .map(|d| d.trim().to_string())
            .filter(|d| !d.is_empty()),
        format: deck.format,
        commanders,
        colors: deck_colors(deck),
        card_count: deck.cards.len() as u32,
        cover_card_name: deck.cover_card_name.clone(),
        cover_image_url: resolve_cover(deck),
        created_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
    }
}

fn display_cards(deck: &Deck) -> impl Iterator<Item = &DeckCard> {
    deck.commanders
        .as_deref()
        .unwrap_or_default()
        .iter()
        .chain(deck.cards.iter())
}

fn deck_colors(deck: &Deck) -> String {
    COLOR_ORDER
        .chars()
        .filter(|color| {
            display_cards(deck).any(|card| {
                card.rules
                    .color_identity
                    .iter()
                    .any(|c| c == &color.to_string())
            })
        })
        .collect()
}

fn resolve_cover(deck: &Deck) -> Option<String> {
    let named = deck
        .cover_card_name
        .as_deref()
        .and_then(|name| display_cards(deck).find(|card| card.identity.name == name));
    let card = named.or_else(|| display_cards(deck).next())?;
    [
        &card.uris.art_crop,
        &card.uris.normal,
        &card.uris.large,
        &card.uris.small,
    ]
    .into_iter()
    .find(|uri| !uri.is_empty())
    .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use manabrew_hub::dto::{
        AccountDeckDetail, AuthAccount, AuthSessionResponse, DeckHubEntryDetail, DeckHubEntryList,
        DeckHubFacets, FavoriteResponse, HubDeckDetail, MeResponse, TopDeckSnapshot,
    };
    use tower::ServiceExt;

    fn test_state(per_hour: u32, per_day: u32) -> Arc<AppState> {
        Arc::new(AppState {
            storage: Mutex::new(Storage::open_memory().unwrap()),
            stats: StatsCache::new(None),
            limiter: RateLimiter::new(per_hour),
            publish_per_day: per_day,
            auth: AuthConfig {
                public_url: "http://localhost:9500".into(),
                web_app_url: "http://localhost:5173".into(),
                github: None,
                discord: None,
                resend_api_key: None,
                email_from: "Manabrew <login@manabrew.test>".into(),
                auth_emails_per_hour: 100,
                auth_attempts_per_hour: 100,
            },
            auth_email_limiter: RateLimiter::new(100),
            auth_code_limiter: RateLimiter::new(100),
            http: reqwest::Client::new(),
            identity: auth::token_tests::ephemeral(),
        })
    }

    fn sign_up(state: &Arc<AppState>, handle: &str, email: &str) -> String {
        let token = generate_token();
        let storage = state.storage.lock().unwrap();
        let account_id = uuid::Uuid::new_v4().to_string();
        storage
            .create_account(&crate::storage::AccountRow {
                id: account_id.clone(),
                handle: handle.into(),
                handle_set: false,
                created_at: "2026-07-01T00:00:00Z".into(),
            })
            .unwrap();
        storage
            .insert_identity(
                &account_id,
                "email",
                email,
                Some(email),
                true,
                "2026-07-01T00:00:00Z",
            )
            .unwrap();
        storage
            .insert_session(
                &hash_token(&token),
                &account_id,
                "2026-07-01T00:00:00Z",
                "2999-01-01T00:00:00Z",
            )
            .unwrap();
        token
    }

    fn with_ip(mut request: Request<Body>) -> Request<Body> {
        request
            .extensions_mut()
            .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 4000))));
        request
    }

    fn publish_request(token: &str, cards: usize) -> Request<Body> {
        let payload = crate::validate::tests::request("ignored", cards);
        with_ip(
            Request::post("/api/hub/decks")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                .unwrap(),
        )
    }

    fn json_post(uri: &str, token: Option<&str>, payload: serde_json::Value) -> Request<Body> {
        let mut builder = Request::post(uri).header("content-type", "application/json");
        if let Some(token) = token {
            builder = builder.header("authorization", format!("Bearer {token}"));
        }
        with_ip(builder.body(Body::from(payload.to_string())).unwrap())
    }

    async fn body_json<T: serde::de::DeserializeOwned>(response: Response) -> T {
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn publish_list_get_delete_happy_path() {
        let state = test_state(100, 100);
        let token = sign_up(&state, "tester", "tester@example.com");
        let router = build_router(state);
        let response = router
            .clone()
            .oneshot(publish_request(&token, 60))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let published: PublishDeckResponse = body_json(response).await;

        let response = router
            .clone()
            .oneshot(with_ip(
                Request::get("/api/hub/decks?search=test")
                    .body(Body::empty())
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let list: HubDeckList = body_json(response).await;
        assert_eq!(list.total, 1);
        assert_eq!(list.decks[0].card_count, 60);
        assert_eq!(list.decks[0].author, "tester");

        let response = router
            .clone()
            .oneshot(with_ip(
                Request::get(format!("/api/hub/decks/{}", published.id))
                    .body(Body::empty())
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let detail: HubDeckDetail = body_json(response).await;
        assert_eq!(detail.deck.cards.len(), 60);
        assert!(detail.deck.playmat.is_none());

        let response = router
            .clone()
            .oneshot(with_ip(
                Request::delete(format!("/api/hub/decks/{}", published.id))
                    .header(MANAGEMENT_TOKEN_HEADER, "wrong")
                    .body(Body::empty())
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);

        let response = router
            .clone()
            .oneshot(with_ip(
                Request::delete(format!("/api/hub/decks/{}", published.id))
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        let response = router
            .oneshot(with_ip(
                Request::get("/api/hub/decks").body(Body::empty()).unwrap(),
            ))
            .await
            .unwrap();
        let list: HubDeckList = body_json(response).await;
        assert_eq!(list.total, 0);
    }

    #[tokio::test]
    async fn account_deck_versions_publication_favorites_and_snapshot_roundtrip() {
        let state = test_state(100, 100);
        let token = sign_up(&state, "tester", "tester@example.com");
        let router = build_router(state);
        let deck = crate::validate::tests::request("ignored", 60).deck;

        let response = router
            .clone()
            .oneshot(json_post(
                "/api/decks",
                Some(&token),
                serde_json::json!({"deck": deck, "notes": "Initial version"}),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let created: AccountDeckDetail = body_json(response).await;
        assert_eq!(created.summary.current_version_no, 1);

        let mut changed = created.deck.clone();
        changed.name = "Updated Deck".into();
        let response = router
            .clone()
            .oneshot(with_ip(
                Request::patch(format!("/api/decks/{}", created.summary.id))
                    .header("content-type", "application/json")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::from(
                        serde_json::json!({
                            "deck": changed,
                            "expectedVersionNo": 1,
                            "notes": "Second version"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let updated: AccountDeckDetail = body_json(response).await;
        assert_eq!(updated.summary.current_version_no, 2);

        let response = router
            .clone()
            .oneshot(json_post(
                "/api/deckhub/entries",
                Some(&token),
                serde_json::json!({
                    "deckId": updated.summary.id,
                    "publishedVersionId": updated.summary.current_version_id,
                    "title": "Public Updated Deck",
                    "summary": "A stable publication",
                    "tags": ["Control", "Budget"]
                }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let published: DeckHubEntryDetail = body_json(response).await;
        assert_eq!(published.entry.tags.len(), 2);
        assert_eq!(published.deck.name, "Updated Deck");

        let response = router
            .clone()
            .oneshot(json_post(
                "/api/deckhub/entries",
                Some(&token),
                serde_json::json!({
                    "deckId": updated.summary.id,
                    "publishedVersionId": updated.summary.current_version_id,
                    "title": "Alternate Public Listing",
                    "tags": ["Featured"]
                }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let alternate: DeckHubEntryDetail = body_json(response).await;
        assert_ne!(alternate.entry.id, published.entry.id);
        assert_eq!(alternate.entry.deck_id, published.entry.deck_id);
        assert_eq!(
            alternate.entry.published_version_id,
            published.entry.published_version_id
        );

        let response = router
            .clone()
            .oneshot(with_ip(
                Request::put(format!(
                    "/api/deckhub/entries/{}/favorite",
                    published.entry.id
                ))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let favorite: FavoriteResponse = body_json(response).await;
        assert_eq!(favorite.favorite_count, 1);
        assert!(favorite.favorited);

        let response = router
            .clone()
            .oneshot(with_ip(
                Request::get("/api/deckhub/entries?tag=control&sort=favorites")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let entries: DeckHubEntryList = body_json(response).await;
        assert_eq!(entries.total, 1);
        assert!(entries.entries[0].favorited);
        assert_eq!(entries.entries[0].published_version_no, 2);

        let response = router
            .clone()
            .oneshot(with_ip(
                Request::get(
                    "/api/deckhub/entries?colors=C&colorMatch=exact&tags=control,budget&tagMatch=all&card=Card%2012&favorites=true",
                )
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let filtered: DeckHubEntryList = body_json(response).await;
        assert_eq!(filtered.total, 1);
        assert_eq!(filtered.entries[0].id, published.entry.id);

        let response = router
            .clone()
            .oneshot(with_ip(
                Request::get("/api/deckhub/facets")
                    .body(Body::empty())
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let facets: DeckHubFacets = body_json(response).await;
        assert_eq!(facets.total, 2);
        assert_eq!(
            facets
                .colors
                .iter()
                .find(|facet| facet.key == "C")
                .map(|facet| facet.count),
            Some(2)
        );

        let response = router
            .clone()
            .oneshot(with_ip(
                Request::delete(format!("/api/deckhub/entries/{}", alternate.entry.id))
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        let response = router
            .clone()
            .oneshot(json_post(
                "/admin/deckhub/top/trending",
                None,
                serde_json::json!({
                    "snapshotDate": "2026-07-30",
                    "entries": [{
                        "deckhubEntryId": alternate.entry.id,
                        "rank": 1
                    }]
                }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);

        let response = router
            .clone()
            .oneshot(json_post(
                "/admin/deckhub/top/trending",
                None,
                serde_json::json!({
                    "snapshotDate": "2026-07-31",
                    "entries": [{
                        "deckhubEntryId": published.entry.id,
                        "rank": 1,
                        "score": 42.0,
                        "reason": "Featured"
                    }]
                }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        let response = router
            .oneshot(with_ip(
                Request::get("/api/deckhub/top/trending")
                    .body(Body::empty())
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let snapshot: TopDeckSnapshot = body_json(response).await;
        assert_eq!(snapshot.snapshot_date.as_deref(), Some("2026-07-31"));
        assert_eq!(snapshot.entries[0].rank, 1);
    }

    #[tokio::test]
    async fn publish_requires_bearer() {
        let router = build_router(test_state(100, 100));
        let payload = crate::validate::tests::request("tester", 60);
        let request = with_ip(
            Request::post("/api/hub/decks")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                .unwrap(),
        );
        let response = router.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn legacy_management_token_still_deletes() {
        let state = test_state(100, 100);
        let token = sign_up(&state, "tester", "tester@example.com");
        let router = build_router(state);
        let response = router
            .clone()
            .oneshot(publish_request(&token, 60))
            .await
            .unwrap();
        let published: PublishDeckResponse = body_json(response).await;
        let response = router
            .oneshot(with_ip(
                Request::delete(format!("/api/hub/decks/{}", published.id))
                    .header(MANAGEMENT_TOKEN_HEADER, published.management_token)
                    .body(Body::empty())
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn foreign_bearer_cannot_delete() {
        let state = test_state(100, 100);
        let owner = sign_up(&state, "owner", "owner@example.com");
        let other = sign_up(&state, "other", "other@example.com");
        let router = build_router(state);
        let response = router
            .clone()
            .oneshot(publish_request(&owner, 60))
            .await
            .unwrap();
        let published: PublishDeckResponse = body_json(response).await;
        let response = router
            .oneshot(with_ip(
                Request::delete(format!("/api/hub/decks/{}", published.id))
                    .header("authorization", format!("Bearer {other}"))
                    .body(Body::empty())
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn rejected_publishes_do_not_burn_rate_limit_tokens() {
        let state = test_state(1, 100);
        let token = sign_up(&state, "tester", "tester@example.com");
        let router = build_router(state);
        for _ in 0..3 {
            let response = router
                .clone()
                .oneshot(publish_request(&token, 0))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        }
        let response = router.oneshot(publish_request(&token, 60)).await.unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
    }

    #[tokio::test]
    async fn publish_rate_limited_per_ip() {
        let state = test_state(2, 100);
        let token = sign_up(&state, "tester", "tester@example.com");
        let router = build_router(state);
        for _ in 0..2 {
            let response = router
                .clone()
                .oneshot(publish_request(&token, 60))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::CREATED);
        }
        let response = router.oneshot(publish_request(&token, 60)).await.unwrap();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn publish_daily_cap_from_storage() {
        let state = test_state(100, 1);
        let token = sign_up(&state, "tester", "tester@example.com");
        let router = build_router(state);
        let response = router
            .clone()
            .oneshot(publish_request(&token, 60))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let response = router.oneshot(publish_request(&token, 60)).await.unwrap();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn publish_rejects_oversized_body() {
        let state = test_state(100, 100);
        let token = sign_up(&state, "tester", "tester@example.com");
        let router = build_router(state);
        let mut payload = crate::validate::tests::request("tester", 1);
        payload.deck.description = Some("x".repeat(MAX_BODY_BYTES + 1));
        let request = with_ip(
            Request::post("/api/hub/decks")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                .unwrap(),
        );
        let response = router.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[tokio::test]
    async fn top_decks_empty_without_events_db() {
        let router = build_router(test_state(100, 100));
        let response = router
            .oneshot(with_ip(
                Request::get("/api/stats/top-decks?window=7d")
                    .body(Body::empty())
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let stats: Vec<manabrew_hub::dto::TopDeckStat> = body_json(response).await;
        assert!(stats.is_empty());
    }

    #[tokio::test]
    async fn email_code_flow_signs_in_and_owns_decks() {
        let state = test_state(100, 100);
        state
            .storage
            .lock()
            .unwrap()
            .insert_login_token(
                &hash_token("ABCD2345"),
                "new@example.com",
                "2026-07-01T00:00:00Z",
                "2999-01-01T00:00:00Z",
                "127.0.0.1",
            )
            .unwrap();
        let router = build_router(state);

        let response = router
            .clone()
            .oneshot(json_post(
                "/api/auth/email/verify",
                None,
                serde_json::json!({"email": "New@Example.com", "code": "abcd2345"}),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let session: AuthSessionResponse = body_json(response).await;
        assert!(session.account.handle.starts_with("brewer-"));
        assert!(session.account.handle_pending);

        let response = router
            .clone()
            .oneshot(with_ip(
                Request::get("/api/auth/me")
                    .header("authorization", format!("Bearer {}", session.token))
                    .body(Body::empty())
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let me: MeResponse = body_json(response).await;
        assert_eq!(me.identities.len(), 1);
        assert_eq!(me.identities[0].provider, "email");

        let response = router
            .clone()
            .oneshot(with_ip(
                Request::patch("/api/auth/me")
                    .header("content-type", "application/json")
                    .header("authorization", format!("Bearer {}", session.token))
                    .body(Body::from(
                        serde_json::json!({"handle": "neheb-fan"}).to_string(),
                    ))
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let account: AuthAccount = body_json(response).await;
        assert_eq!(account.handle, "neheb-fan");
        assert!(!account.handle_pending);

        let response = router
            .clone()
            .oneshot(publish_request(&session.token, 60))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);

        let response = router
            .clone()
            .oneshot(with_ip(
                Request::get("/api/hub/my-decks")
                    .header("authorization", format!("Bearer {}", session.token))
                    .body(Body::empty())
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let mine: HubDeckList = body_json(response).await;
        assert_eq!(mine.total, 1);
        assert_eq!(mine.decks[0].author, "neheb-fan");
    }

    #[tokio::test]
    async fn wrong_email_code_rejected() {
        let state = test_state(100, 100);
        state
            .storage
            .lock()
            .unwrap()
            .insert_login_token(
                &hash_token("ABCD2345"),
                "new@example.com",
                "2026-07-01T00:00:00Z",
                "2999-01-01T00:00:00Z",
                "127.0.0.1",
            )
            .unwrap();
        let router = build_router(state);
        let response = router
            .oneshot(json_post(
                "/api/auth/email/verify",
                None,
                serde_json::json!({"email": "new@example.com", "code": "WRONG234"}),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn exchange_code_is_single_use() {
        let state = test_state(100, 100);
        {
            let storage = state.storage.lock().unwrap();
            storage
                .create_account(&crate::storage::AccountRow {
                    id: "acct-x".into(),
                    handle: "tester".into(),
                    handle_set: true,
                    created_at: "2026-07-01T00:00:00Z".into(),
                })
                .unwrap();
            storage
                .insert_auth_code(
                    &hash_token("CODE2345"),
                    "acct-x",
                    "2026-07-01T00:00:00Z",
                    "2999-01-01T00:00:00Z",
                )
                .unwrap();
        }
        let router = build_router(state);
        let response = router
            .clone()
            .oneshot(json_post(
                "/api/auth/exchange",
                None,
                serde_json::json!({"code": "CODE2345"}),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let session: AuthSessionResponse = body_json(response).await;
        assert_eq!(session.account.handle, "tester");
        let response = router
            .oneshot(json_post(
                "/api/auth/exchange",
                None,
                serde_json::json!({"code": "CODE2345"}),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn handle_conflict_is_409() {
        let state = test_state(100, 100);
        sign_up(&state, "taken", "a@example.com");
        let token = sign_up(&state, "second", "b@example.com");
        let router = build_router(state);
        let response = router
            .oneshot(with_ip(
                Request::patch("/api/auth/me")
                    .header("content-type", "application/json")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::from(
                        serde_json::json!({"handle": "Taken"}).to_string(),
                    ))
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn last_identity_unlink_refused() {
        let state = test_state(100, 100);
        let token = sign_up(&state, "tester", "tester@example.com");
        let router = build_router(state);
        let response = router
            .oneshot(with_ip(
                Request::delete("/api/auth/identities/email")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn logout_invalidates_session() {
        let state = test_state(100, 100);
        let token = sign_up(&state, "tester", "tester@example.com");
        let router = build_router(state);
        let response = router
            .clone()
            .oneshot(with_ip(
                Request::post("/api/auth/logout")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        let response = router
            .oneshot(with_ip(
                Request::get("/api/auth/me")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn oauth_start_unconfigured_provider_is_503() {
        let router = build_router(test_state(100, 100));
        let response = router
            .oneshot(json_post(
                "/api/auth/oauth/github/start",
                None,
                serde_json::json!({"mode": "signin", "client": "web"}),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn identity_token_requires_session_and_verifies_against_jwks() {
        let state = test_state(100, 100);
        let router = build_router(state.clone());
        let response = router
            .clone()
            .oneshot(with_ip(
                Request::post("/api/auth/token")
                    .body(Body::empty())
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        let session = sign_up(&state, "brewer", "brewer@example.com");
        let response = router
            .clone()
            .oneshot(with_ip(
                Request::post("/api/auth/token")
                    .header("authorization", format!("Bearer {session}"))
                    .body(Body::empty())
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let minted: manabrew_hub::dto::IdentityTokenResponse =
            serde_json::from_slice(&bytes).unwrap();

        let response = router
            .oneshot(with_ip(
                Request::get("/api/auth/jwks").body(Body::empty()).unwrap(),
            ))
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let jwks: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let claims =
            auth::token_tests::verify(&minted.token, jwks["keys"][0]["x"].as_str().unwrap())
                .unwrap();
        assert_eq!(claims.handle, "brewer");
        assert_eq!(claims.exp - claims.iat, i64::from(minted.expires_in));
    }

    #[test]
    fn summary_derives_colors_commanders_and_cover() {
        let mut deck = crate::validate::tests::request("tester", 2).deck;
        deck.cards[0].rules.color_identity = vec!["R".into()];
        deck.cards[1].rules.color_identity = vec!["W".into()];
        let mut commander = crate::validate::tests::card("Neheb, the Worthy");
        commander.rules.color_identity = vec!["B".into(), "R".into()];
        commander.uris.art_crop = "https://cards.scryfall.io/art_crop/neheb.jpg".into();
        deck.commanders = Some(vec![commander]);
        let summary = build_summary(&deck, "tester");
        assert_eq!(summary.colors, "WBR");
        assert_eq!(summary.commanders, vec!["Neheb, the Worthy".to_string()]);
        assert_eq!(
            summary.cover_image_url.as_deref(),
            Some("https://cards.scryfall.io/art_crop/neheb.jpg")
        );
        assert_eq!(summary.card_count, 2);
    }
}
