use std::collections::BTreeSet;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::extract::{ConnectInfo, DefaultBodyLimit, Path, Query, Request, State};
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use chrono::{SecondsFormat, Utc};
use manabrew_hub::dto::{
    AccountAsset, AccountAssetList, AccountDeckList, AdminTopDeckSnapshotRequest,
    AssetCapabilities, AssetQuota, AssetUpload, Capability, CardCollection, CardCollectionEntry,
    CreateAccountDeckRequest, CreateAssetUploadRequest, DeckHubEntryList, DeckPlayReportRequest,
    EnginePlayStats, HubCapabilities, MissingCapabilityError, PublishDeckHubEntryRequest,
    SaveDeckVersionRequest, SetAccountAvatarRequest, UpdateDeckHubEntryRequest,
    VerifyCardPrintingsRequest, VerifyCardPrintingsResponse, MAX_AVATAR_BYTES, MAX_PLAYMAT_BYTES,
};
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::assets::AssetService;
use crate::auth;
use crate::config::AuthConfig;
use crate::rate_limit::RateLimiter;
use crate::scryfall_api::ScryfallApi;
use crate::scryfall_bulk::ScryfallBulkIndex;
use crate::storage::{
    AssetReservation, CreateDeckOutcome, DeckHubColorMatch, DeckHubEntryUpdate, DeckHubListParams,
    DeckHubSortOrder, DeckHubTagMatch, DeleteOutcome, NewDeckHubEntry, RecordDeckPlayOutcome,
    RelayDeckPlay, ReplaceSnapshotOutcome, ReserveAssetOutcome, SaveVersionOutcome, Storage,
};
use crate::validate;

const MAX_BODY_BYTES: usize = 1024 * 1024;
const MAX_COLLECTION_BODY_BYTES: usize = 8 * 1024 * 1024;
const MAX_COLLECTION_ENTRIES: usize = 25_000;
const MAX_VERIFY_BODY_BYTES: usize = 4 * 1024 * 1024;
const MAX_VERIFY_IDENTIFIERS: usize = 5_000;
const DEFAULT_PAGE_SIZE: u32 = 20;
const MAX_PAGE_SIZE: u32 = 50;
const FORWARDED_FOR_HEADER: &str = "x-forwarded-for";
const MANAGEMENT_TOKEN_BYTES: usize = 32;

pub struct AppState {
    pub storage: Mutex<Storage>,
    pub limiter: RateLimiter,
    pub play_limiter: RateLimiter,
    pub collection_limiter: RateLimiter,
    pub deck_hub_enabled: bool,
    pub publish_per_day: u32,
    pub relay_deck_plays_token: Option<String>,
    pub auth: AuthConfig,
    pub auth_email_limiter: RateLimiter,
    pub auth_code_limiter: RateLimiter,
    pub http: reqwest::Client,
    pub scryfall_bulk: Arc<ScryfallBulkIndex>,
    pub scryfall_api: ScryfallApi,
    pub identity: auth::IdentityKeys,
    pub assets: Option<AssetService>,
}

// The Tauri shells load from fixed webview origins; the web app origin comes
// from WEB_APP_URL per environment. Keep the asset-server origin in sync with
// ASSET_SERVER_PORT in src-tauri/src/asset_server.rs — macOS and Linux packaged
// builds serve the frontend from there, not from a tauri:// scheme.
fn cors_origins(web_app_url: &str) -> AllowOrigin {
    let mut origins = vec![
        HeaderValue::from_static("tauri://localhost"),
        HeaderValue::from_static("http://tauri.localhost"),
        HeaderValue::from_static("http://localhost:9527"),
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
        .allow_headers([CONTENT_TYPE, AUTHORIZATION]);
    let asset_routes = Router::new()
        .route(
            "/",
            get(account_assets_handler).post(create_asset_upload_handler),
        )
        .route("/:id", delete(delete_asset_handler))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_assets_capability,
        ));
    Router::new()
        .route("/health", get(health_handler))
        .route("/api/hub/capabilities", get(capabilities_handler))
        .route(
            "/api/collection",
            get(card_collection_handler)
                .put(replace_card_collection_handler)
                .layer(DefaultBodyLimit::max(MAX_COLLECTION_BODY_BYTES)),
        )
        .route(
            "/api/cards/verify",
            post(verify_card_printings_handler).layer(DefaultBodyLimit::max(MAX_VERIFY_BODY_BYTES)),
        )
        .route(
            "/api/scryfall/*path",
            get(crate::scryfall_api::handler).post(crate::scryfall_api::handler),
        )
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
        .nest("/api/assets", asset_routes)
        .route("/api/presets/:preset_key/fork", post(fork_preset_handler))
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
        .route("/api/deckhub/plays", post(record_deck_play_handler))
        .route("/api/stats/engine", post(record_engine_stats_handler))
        .route(
            "/internal/deckhub/relay-games",
            post(relay_deck_game_handler),
        )
        .route(
            "/admin/deckhub/top/:bucket",
            post(replace_top_deck_snapshot_handler),
        )
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
            get(auth::me_handler)
                .patch(auth::update_handle_handler)
                .delete(auth::delete_account_handler),
        )
        .route("/api/auth/me/avatar", put(set_account_avatar_handler))
        .route("/api/auth/export", get(auth::export_account_handler))
        .route("/api/auth/logout", post(auth::logout_handler))
        .route("/api/auth/token", post(auth::token_handler))
        .route("/api/auth/guest-token", post(auth::guest_token_handler))
        .route("/api/auth/jwks", get(auth::jwks_handler))
        .route(
            "/api/auth/identities/:provider",
            delete(auth::unlink_identity_handler),
        )
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(cors)
        .with_state(state)
}

async fn require_assets_capability(
    State(state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Response {
    if state.assets.is_some() {
        next.run(request).await
    } else {
        missing_capability(Capability::Assets)
    }
}

fn missing_capability(capability: Capability) -> Response {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(MissingCapabilityError { capability }),
    )
        .into_response()
}

async fn verify_card_printings_handler(
    State(state): State<Arc<AppState>>,
    auth::SessionAccount(_account): auth::SessionAccount,
    Json(request): Json<VerifyCardPrintingsRequest>,
) -> Response {
    if request.identifiers.len() > MAX_VERIFY_IDENTIFIERS
        || request.identifiers.iter().any(|identifier| {
            identifier.name.is_empty()
                || identifier.name.len() > 300
                || identifier.set_code.is_empty()
                || identifier.set_code.len() > 20
                || identifier.collector_number.is_empty()
                || identifier.collector_number.len() > 30
        })
    {
        return StatusCode::UNPROCESSABLE_ENTITY.into_response();
    }
    match state.scryfall_bulk.verify(&request.identifiers) {
        Some(matched) => Json(VerifyCardPrintingsResponse { matched }).into_response(),
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            "Card verification data is still loading. Try again shortly.",
        )
            .into_response(),
    }
}

async fn card_collection_handler(
    State(state): State<Arc<AppState>>,
    auth::SessionAccount(account): auth::SessionAccount,
) -> Response {
    match state.storage.lock().unwrap().card_collection(&account.id) {
        Ok((version, cards)) => Json(CardCollection {
            version: Some(version),
            cards: cards
                .into_iter()
                .map(|(card_key, quantity)| CardCollectionEntry { card_key, quantity })
                .collect(),
        })
        .into_response(),
        Err(error) => internal_error(error),
    }
}

async fn replace_card_collection_handler(
    State(state): State<Arc<AppState>>,
    auth::SessionAccount(account): auth::SessionAccount,
    Json(collection): Json<CardCollection>,
) -> Response {
    if !state.collection_limiter.allow(&account.id) {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    if collection.cards.len() > MAX_COLLECTION_ENTRIES
        || collection
            .cards
            .iter()
            .any(|card| card.card_key.is_empty() || card.card_key.len() > 200)
    {
        return StatusCode::UNPROCESSABLE_ENTITY.into_response();
    }
    let cards = collection
        .cards
        .into_iter()
        .map(|card| (card.card_key, card.quantity))
        .collect::<Vec<_>>();
    match state.storage.lock().unwrap().replace_card_collection(
        &account.id,
        &cards,
        collection.version,
    ) {
        Ok(Some(version)) => Json(CardCollection {
            version: Some(version),
            cards: cards
                .into_iter()
                .map(|(card_key, quantity)| CardCollectionEntry { card_key, quantity })
                .collect(),
        })
        .into_response(),
        Ok(None) => (
            StatusCode::CONFLICT,
            "This collection changed on another device. Reload it and try again.",
        )
            .into_response(),
        Err(error) => internal_error(error),
    }
}

async fn health_handler() -> &'static str {
    "ok"
}

async fn capabilities_handler(State(state): State<Arc<AppState>>) -> Json<HubCapabilities> {
    Json(HubCapabilities {
        account_decks: true,
        tags: true,
        favorites: true,
        top_deck_snapshots: true,
        assets: state.assets.as_ref().map(|_| AssetCapabilities {
            max_avatar_bytes: MAX_AVATAR_BYTES,
            max_playmat_bytes: MAX_PLAYMAT_BYTES,
        }),
    })
}

async fn create_asset_upload_handler(
    State(state): State<Arc<AppState>>,
    auth::SessionAccount(account): auth::SessionAccount,
    Json(request): Json<CreateAssetUploadRequest>,
) -> Response {
    let Some(assets) = state.assets.as_ref() else {
        return missing_capability(Capability::Assets);
    };
    if request.byte_size == 0 || request.byte_size > request.kind.max_bytes() {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    }
    if !assets.limiter.allow(&account.id) {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    let now = Utc::now();
    let expires_at = (now + chrono::Duration::seconds(assets.reservation_ttl_seconds))
        .to_rfc3339_opts(SecondsFormat::Secs, true);
    let asset_id = uuid::Uuid::new_v4().to_string();
    let object_key = crate::assets::object_key(&account.id, request.kind, &asset_id);
    let reserved = state
        .storage
        .lock()
        .unwrap()
        .reserve_asset(AssetReservation {
            account_id: &account.id,
            asset_id: &asset_id,
            kind: request.kind,
            byte_size: request.byte_size,
            default_quota_bytes: assets.quota_bytes,
            expires_at: &expires_at,
            now: &now_string(),
        });
    match reserved {
        Ok(ReserveAssetOutcome::Reserved) => {}
        Ok(ReserveAssetOutcome::QuotaExceeded {
            used_bytes,
            quota_bytes,
        }) => {
            return (
                StatusCode::INSUFFICIENT_STORAGE,
                Json(AssetQuota {
                    used_bytes,
                    quota_bytes,
                }),
            )
                .into_response()
        }
        Err(error) => return internal_error(error),
    }
    match assets
        .store
        .presign_put(&object_key, request.byte_size)
        .await
    {
        Ok(upload) => (
            StatusCode::CREATED,
            Json(AssetUpload {
                asset_id,
                upload_url: upload.url,
                public_url: upload.public_url,
                headers: upload.headers,
            }),
        )
            .into_response(),
        Err(error) => {
            let released = state
                .storage
                .lock()
                .unwrap()
                .discard_pending_asset(&asset_id);
            if let Err(error) = released {
                tracing::error!(%error, asset_id, "could not release the reservation");
            }
            internal_error(error)
        }
    }
}

async fn account_assets_handler(
    State(state): State<Arc<AppState>>,
    auth::SessionAccount(account): auth::SessionAccount,
) -> Response {
    let Some(assets) = state.assets.as_ref() else {
        return missing_capability(Capability::Assets);
    };
    match state
        .storage
        .lock()
        .unwrap()
        .account_assets(&account.id, assets.quota_bytes)
    {
        Ok((rows, quota)) => Json(AccountAssetList {
            assets: rows
                .into_iter()
                .map(|row| AccountAsset {
                    url: assets.store.public_url(&crate::assets::object_key(
                        &account.id,
                        row.kind,
                        &row.id,
                    )),
                    id: row.id,
                    kind: row.kind,
                    byte_size: row.byte_size,
                    state: row.state,
                    created_at: row.created_at,
                })
                .collect(),
            quota,
        })
        .into_response(),
        Err(error) => internal_error(error),
    }
}

// The object goes first: a failed row delete leaves the asset owned and billed,
// which the account can retry, while a failed object delete after the row is
// gone would leak bytes nothing references.
async fn delete_asset_handler(
    State(state): State<Arc<AppState>>,
    Path(asset_id): Path<String>,
    auth::SessionAccount(account): auth::SessionAccount,
) -> Response {
    let Some(assets) = state.assets.as_ref() else {
        return missing_capability(Capability::Assets);
    };
    let kind = state
        .storage
        .lock()
        .unwrap()
        .owned_asset_kind(&account.id, &asset_id);
    let object_key = match kind {
        Ok(Some(kind)) => crate::assets::object_key(&account.id, kind, &asset_id),
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(error) => return internal_error(error),
    };
    if let Err(error) = assets.store.delete(&object_key).await {
        return internal_error(error);
    }
    match state
        .storage
        .lock()
        .unwrap()
        .delete_account_asset(&account.id, &asset_id)
    {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => internal_error(error),
    }
}

async fn set_account_avatar_handler(
    State(state): State<Arc<AppState>>,
    auth::SessionAccount(account): auth::SessionAccount,
    Json(request): Json<SetAccountAvatarRequest>,
) -> Response {
    if state.assets.is_none() {
        return missing_capability(Capability::Assets);
    }
    match state
        .storage
        .lock()
        .unwrap()
        .set_account_avatar_asset(&account.id, request.asset_id.as_deref())
    {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => StatusCode::UNPROCESSABLE_ENTITY.into_response(),
        Err(error) => internal_error(error),
    }
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

async fn fork_preset_handler(
    State(state): State<Arc<AppState>>,
    Path(preset_key): Path<String>,
    auth::SessionAccount(account): auth::SessionAccount,
) -> Response {
    match state
        .storage
        .lock()
        .unwrap()
        .fork_preset_deck(&account.id, &preset_key, &now_string())
    {
        Ok(Some(detail)) => Json(detail).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal_error(error),
    }
}

async fn create_account_deck_handler(
    State(state): State<Arc<AppState>>,
    auth::SessionAccount(account): auth::SessionAccount,
    Json(request): Json<CreateAccountDeckRequest>,
) -> Response {
    if let Err(message) = validate::validate(&account.handle, &request.deck) {
        return (StatusCode::UNPROCESSABLE_ENTITY, message).into_response();
    }
    let mut deck = request.deck;
    validate::sanitize(&mut deck);
    match state.storage.lock().unwrap().create_account_deck(
        &account.id,
        deck,
        request.notes.as_deref(),
        &now_string(),
    ) {
        Ok(CreateDeckOutcome::Created(detail)) => {
            (StatusCode::CREATED, Json(*detail)).into_response()
        }
        Ok(CreateDeckOutcome::UnknownPlaymatAsset) => {
            (StatusCode::UNPROCESSABLE_ENTITY, "unknown playmat asset").into_response()
        }
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
    if let Err(message) = validate::validate(&account.handle, &request.deck) {
        return (StatusCode::UNPROCESSABLE_ENTITY, message).into_response();
    }
    let mut deck = request.deck;
    validate::sanitize(&mut deck);
    match state.storage.lock().unwrap().save_account_deck(
        &account.id,
        &id,
        request.expected_version_no,
        deck,
        request.notes.as_deref(),
        &now_string(),
    ) {
        Ok(SaveVersionOutcome::Saved(detail) | SaveVersionOutcome::Unchanged(detail)) => {
            Json(detail).into_response()
        }
        Ok(SaveVersionOutcome::UnknownPlaymatAsset) => {
            (StatusCode::UNPROCESSABLE_ENTITY, "unknown playmat asset").into_response()
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
    source: Option<String>,
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
    owned: Option<bool>,
    engines: Option<String>,
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
        source_kind: match query.source.as_deref() {
            Some("community") => Some("user".into()),
            Some("presets") => Some("preset".into()),
            _ => None,
        },
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
        owned_only: query.owned.unwrap_or(false),
        engines: Some(csv_values(query.engines)).filter(|values| !values.is_empty()),
        sort: match query.sort.as_deref() {
            Some("name") => DeckHubSortOrder::Name,
            Some("favorites") => DeckHubSortOrder::Favorites,
            Some("newest") => DeckHubSortOrder::Newest,
            _ => DeckHubSortOrder::CommunityFirst,
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
    if !state.deck_hub_enabled {
        return StatusCode::NOT_FOUND.into_response();
    }
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
    if !state.deck_hub_enabled {
        return StatusCode::NOT_FOUND.into_response();
    }
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
    let storage = state.storage.lock().unwrap();
    let outcome = storage.update_deckhub_entry(&account.id, &entry_id, &update);
    match outcome {
        Ok(DeleteOutcome::Deleted) => match storage.get_deckhub_entry(&entry_id, Some(&account.id))
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
    if !state.deck_hub_enabled {
        return StatusCode::NOT_FOUND.into_response();
    }
    set_favorite_response(&state, &account.id, &entry_id, true)
}

async fn unfavorite_deckhub_entry_handler(
    State(state): State<Arc<AppState>>,
    Path(entry_id): Path<String>,
    auth::SessionAccount(account): auth::SessionAccount,
) -> Response {
    if !state.deck_hub_enabled {
        return StatusCode::NOT_FOUND.into_response();
    }
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

/// Engine timings for one finished game, from the client that ran it.
///
/// Unauthenticated on purpose: the interesting case is offline play, which has
/// no session and no server in the loop at all. Nothing here identifies a
/// player, the report id is the client's own so a retry cannot double-count,
/// and the same per-IP limiter as the deck-play endpoint keeps a loop from
/// filling the table.
async fn record_engine_stats_handler(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<EnginePlayStats>,
) -> Response {
    if !request.is_plausible() {
        return StatusCode::UNPROCESSABLE_ENTITY.into_response();
    }
    if !state.play_limiter.allow(&client_ip(&headers, addr)) {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    match state
        .storage
        .lock()
        .unwrap()
        .record_engine_play_stats(&request, &now_string())
    {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => internal_error(error),
    }
}

async fn record_deck_play_handler(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<DeckPlayReportRequest>,
) -> Response {
    if !state.deck_hub_enabled {
        return StatusCode::NOT_FOUND.into_response();
    }
    if uuid::Uuid::parse_str(&request.report_id).is_err()
        || request.deckhub_entry_id.is_empty()
        || request.deckhub_entry_id.len() > 200
        || request.deck_fingerprint.len() != 64
        || !request
            .deck_fingerprint
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return StatusCode::UNPROCESSABLE_ENTITY.into_response();
    }
    if !state.play_limiter.allow(&client_ip(&headers, addr)) {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    match state.storage.lock().unwrap().record_deck_play(
        &request.report_id,
        &request.deckhub_entry_id,
        &request.deck_fingerprint,
        request.format,
        &now_string(),
    ) {
        Ok(RecordDeckPlayOutcome::Recorded | RecordDeckPlayOutcome::Duplicate) => {
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(RecordDeckPlayOutcome::EntryUnavailable) => {
            StatusCode::UNPROCESSABLE_ENTITY.into_response()
        }
        Err(error) => internal_error(error),
    }
}

#[derive(Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
enum RelayDeckGame {
    GameStarted {
        ts: String,
        game_id: String,
        format: String,
        hosted: bool,
        players: Vec<RelayDeckGamePlayer>,
    },
    GameEnded {
        game_id: String,
        game_over: bool,
        winner: Option<String>,
    },
}

#[derive(Deserialize)]
struct RelayDeckGamePlayer {
    username: String,
    is_bot: bool,
    published_deck_id: Option<String>,
    deck_fingerprint: Option<String>,
}

async fn relay_deck_game_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(event): Json<RelayDeckGame>,
) -> Response {
    if !state.deck_hub_enabled {
        return StatusCode::NOT_FOUND.into_response();
    }
    let authorized = state
        .relay_deck_plays_token
        .as_deref()
        .is_some_and(|expected| {
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.strip_prefix("Bearer "))
                == Some(expected)
        });
    if !authorized {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    match event {
        RelayDeckGame::GameStarted {
            ts,
            game_id,
            format,
            hosted,
            players,
        } => {
            let plays = players
                .iter()
                .filter_map(|player| {
                    if player.is_bot {
                        return None;
                    }
                    Some(RelayDeckPlay {
                        username: &player.username,
                        deckhub_entry_id: player.published_deck_id.as_deref()?,
                        deck_fingerprint: player.deck_fingerprint.as_deref()?,
                    })
                })
                .collect::<Vec<_>>();
            match state
                .storage
                .lock()
                .unwrap()
                .record_relay_game_started(&game_id, &format, &ts, hosted, &plays)
            {
                Ok(_) => StatusCode::NO_CONTENT.into_response(),
                Err(error) => internal_error(error),
            }
        }
        RelayDeckGame::GameEnded {
            game_id,
            game_over,
            winner,
        } => match state.storage.lock().unwrap().record_relay_game_ended(
            &game_id,
            game_over,
            winner.as_deref(),
        ) {
            Ok(_) => StatusCode::NO_CONTENT.into_response(),
            Err(error) => internal_error(error),
        },
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
        || request.entries.iter().any(|entry| {
            entry
                .reason
                .as_deref()
                .map(str::trim)
                .filter(|reason| !reason.is_empty())
                .is_none()
        })
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
            "top decks require published Community entries",
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use manabrew_hub::dto::{
        AccountDeckDetail, AuthSessionResponse, DeckHubEntryDetail, DeckHubEntryList,
        DeckHubFacets, FavoriteResponse, TopDeckSnapshot,
    };
    use tower::ServiceExt;

    fn test_state(per_hour: u32, per_day: u32) -> Arc<AppState> {
        Arc::new(AppState {
            storage: Mutex::new(Storage::open_memory().unwrap()),
            limiter: RateLimiter::new(per_hour),
            play_limiter: RateLimiter::new(100),
            collection_limiter: RateLimiter::new(100),
            deck_hub_enabled: true,
            publish_per_day: per_day,
            relay_deck_plays_token: Some("relay-deck-plays-token".into()),
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
            scryfall_bulk: Arc::new(ScryfallBulkIndex::from_test_cards(&[
                ("Blind Obedience", "rvr", "303"),
                ("Delver of Secrets", "isd", "51"),
            ])),
            scryfall_api: ScryfallApi::new(),
            identity: auth::token_tests::ephemeral(),
            assets: None,
        })
    }

    fn sign_up(state: &Arc<AppState>, handle: &str, email: &str) -> (String, String) {
        let token = generate_token();
        let storage = state.storage.lock().unwrap();
        let account_id = uuid::Uuid::new_v4().to_string();
        storage
            .create_account(&crate::storage::AccountRow {
                id: account_id.clone(),
                handle: handle.into(),
                handle_set: false,
                created_at: "2026-07-01T00:00:00Z".into(),
                avatar_asset_id: None,
                avatar_url: None,
                qualification: None,
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
        drop(storage);
        let access = auth::mint_access_token(
            &state.identity,
            &account_id,
            handle,
            None,
            None,
            auth::AUDIENCE_HUB,
        );
        (access.access_token, token)
    }

    fn with_ip(mut request: Request<Body>) -> Request<Body> {
        request
            .extensions_mut()
            .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 4000))));
        request
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
    async fn card_printing_verification_requires_auth_and_matches_bulk_index() {
        let state = test_state(100, 100);
        let (token, _) = sign_up(&state, "verifier", "verifier@example.com");
        let router = build_router(state);
        let payload = serde_json::json!({
            "identifiers": [
                {"name": "Blind Obedience", "setCode": "RVR", "collectorNumber": "303"},
                {"name": "Blind Obedience", "setCode": "RVR", "collectorNumber": "304"},
                {"name": "Blind Obedience", "setCode": "RVR", "collectorNumber": "303", "foil": false},
                {"name": "Blind Obedience", "setCode": "RVR", "collectorNumber": "303", "foil": true}
            ]
        });

        let response = router
            .clone()
            .oneshot(json_post("/api/cards/verify", None, payload.clone()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        let response = router
            .oneshot(json_post("/api/cards/verify", Some(&token), payload))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let verified: VerifyCardPrintingsResponse = body_json(response).await;
        assert_eq!(verified.matched, vec![true, false, true, false]);
    }

    #[tokio::test]
    async fn collection_routes_accept_payloads_larger_than_the_default_limit() {
        let state = test_state(100, 100);
        let (token, _) = sign_up(&state, "collector", "collector@example.com");
        let router = build_router(state);
        let long_name = "x".repeat(300);
        let identifiers = (0..5_000)
            .map(|index| {
                serde_json::json!({
                    "name": long_name,
                    "setCode": "tst",
                    "collectorNumber": index.to_string()
                })
            })
            .collect::<Vec<_>>();

        let response = router
            .clone()
            .oneshot(json_post(
                "/api/cards/verify",
                Some(&token),
                serde_json::json!({ "identifiers": identifiers }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let cards = (0..6_000)
            .map(|index| {
                serde_json::json!({
                    "cardKey": format!("{}-{index}", "x".repeat(180)),
                    "quantity": 1
                })
            })
            .collect::<Vec<_>>();
        let response = router
            .oneshot(with_ip(
                Request::put("/api/collection")
                    .header("content-type", "application/json")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::from(
                        serde_json::json!({ "version": 0, "cards": cards }).to_string(),
                    ))
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn collection_writes_are_rate_limited_per_account() {
        let state = test_state(100, 100);
        let (token, _) = sign_up(&state, "limited", "limited@example.com");
        let router = build_router(state);

        for _ in 0..100 {
            let response = router
                .clone()
                .oneshot(with_ip(
                    Request::put("/api/collection")
                        .header("content-type", "application/json")
                        .header("authorization", format!("Bearer {token}"))
                        .body(Body::from(r#"{"cards":[]}"#))
                        .unwrap(),
                ))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
        }

        let response = router
            .oneshot(with_ip(
                Request::put("/api/collection")
                    .header("content-type", "application/json")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::from(r#"{"cards":[]}"#))
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn account_deck_versions_publication_favorites_and_snapshot_roundtrip() {
        let state = test_state(100, 100);
        let (token, _) = sign_up(&state, "tester", "tester@example.com");
        let router = build_router(state);
        let deck = serde_json::from_value::<manabrew_protocol::deck_dto::Deck>({
            let mut value = serde_json::to_value(crate::validate::tests::deck(60)).unwrap();
            let object = value.as_object_mut().unwrap();
            object.insert(
                "customTags".into(),
                serde_json::json!(["private organization"]),
            );
            object.insert(
                "cardTags".into(),
                serde_json::json!({"Card 1": ["private organization"]}),
            );
            object.insert(
                "editor".into(),
                serde_json::json!({
                    "version": 1,
                    "tags": [],
                    "layouts": [],
                    "sideboardPlans": [{
                        "id": "plan-1",
                        "matchup": "Control",
                        "bringIn": "Card 2",
                        "takeOut": "Card 3",
                        "notes": "Private matchup notes"
                    }],
                    "acquisition": {"Card 4": "ordered"}
                }),
            );
            value
        })
        .unwrap();

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
        assert!(created.deck.editor.is_some());
        assert!(created.deck.custom_tags.is_some());
        assert!(created.deck.card_tags.is_some());

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
        assert!(published.deck.editor.is_none());
        assert!(published.deck.custom_tags.is_none());
        assert!(published.deck.card_tags.is_none());

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
                    avatar_asset_id: None,
                    avatar_url: None,
                    qualification: None,
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
        let (token, _) = sign_up(&state, "second", "b@example.com");
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
        let (token, _) = sign_up(&state, "tester", "tester@example.com");
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
    async fn logout_revokes_the_refresh_token() {
        let state = test_state(100, 100);
        let (_, refresh) = sign_up(&state, "tester", "tester@example.com");
        let router = build_router(state);
        let response = router
            .clone()
            .oneshot(json_post(
                "/api/auth/logout",
                None,
                serde_json::json!({ "token": refresh }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        let response = router
            .oneshot(json_post(
                "/api/auth/token",
                None,
                serde_json::json!({ "grant_type": "refresh_token", "refresh_token": refresh }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
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
    async fn token_endpoint_mints_per_audience_and_verifies_against_jwks() {
        let state = test_state(100, 100);
        let (_, refresh) = sign_up(&state, "brewer", "brewer@example.com");
        let router = build_router(state.clone());

        let response = router
            .clone()
            .oneshot(json_post(
                "/api/auth/token",
                None,
                serde_json::json!({ "grant_type": "password", "refresh_token": refresh }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        let response = router
            .clone()
            .oneshot(json_post(
                "/api/auth/token",
                None,
                serde_json::json!({
                    "grant_type": "refresh_token",
                    "refresh_token": refresh,
                    "resource": "example.com",
                }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        let response = router
            .clone()
            .oneshot(json_post(
                "/api/auth/token",
                None,
                serde_json::json!({
                    "grant_type": "refresh_token",
                    "refresh_token": refresh,
                    "resource": auth::token_tests::AUDIENCE_RELAY,
                }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let minted: manabrew_hub::dto::AccessTokenResponse = body_json(response).await;
        assert_eq!(minted.token_type, "Bearer");

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
        let claims = auth::token_tests::verify_with_jwk(
            &minted.access_token,
            jwks["keys"][0]["x"].as_str().unwrap(),
        )
        .unwrap();
        assert_eq!(claims.handle, "brewer");
        assert_eq!(claims.aud, auth::token_tests::AUDIENCE_RELAY);
        assert_eq!(claims.exp - claims.iat, i64::from(minted.expires_in));
    }
}
