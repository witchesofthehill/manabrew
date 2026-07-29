use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::extract::{ConnectInfo, DefaultBodyLimit, Path, Query, State};
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use chrono::{SecondsFormat, Utc};
use manabrew_hub::dto::{HubDeckList, HubDeckSummary, PublishDeckRequest, PublishDeckResponse};
use manabrew_protocol::deck_dto::{Deck, DeckCard};
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::auth;
use crate::config::AuthConfig;
use crate::rate_limit::RateLimiter;
use crate::stats::StatsCache;
use crate::storage::{DeleteOutcome, ListParams, NewHubDeck, SortOrder, Storage};
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
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::PATCH])
        .allow_headers([
            CONTENT_TYPE,
            AUTHORIZATION,
            HeaderName::from_static(MANAGEMENT_TOKEN_HEADER),
        ]);
    Router::new()
        .route("/health", get(health_handler))
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
    Json(request): Json<PublishDeckRequest>,
) -> Response {
    let account = match auth::bearer_account(&state, &headers) {
        Ok(Some(account)) => account,
        Ok(None) => return StatusCode::UNAUTHORIZED.into_response(),
        Err(error) => return internal_error(error),
    };
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

async fn my_decks_handler(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let account = match auth::bearer_account(&state, &headers) {
        Ok(Some(account)) => account,
        Ok(None) => return StatusCode::UNAUTHORIZED.into_response(),
        Err(error) => return internal_error(error),
    };
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
    use manabrew_hub::dto::{AuthAccount, AuthSessionResponse, HubDeckDetail, MeResponse};
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
