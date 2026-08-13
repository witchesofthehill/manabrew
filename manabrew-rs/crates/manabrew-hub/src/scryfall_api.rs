use std::collections::{HashMap, VecDeque};
use std::net::SocketAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::body::Bytes;
use axum::extract::{ConnectInfo, OriginalUri, Path, State};
use axum::http::header::{CONTENT_TYPE, RETRY_AFTER};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};

use crate::routes::AppState;

const REQUEST_INTERVAL: Duration = Duration::from_millis(300);
const CACHE_TTL: Duration = Duration::from_secs(5 * 60);
const CACHE_CAPACITY: usize = 512;
const CLIENT_WINDOW: Duration = Duration::from_secs(60);
const CLIENT_REQUEST_LIMIT: usize = 60;
const QUEUE_CAPACITY: usize = 32;

#[derive(Clone)]
struct CachedResponse {
    status: StatusCode,
    content_type: Option<HeaderValue>,
    body: Bytes,
    stored_at: Instant,
}

pub struct ScryfallApi {
    next_request: tokio::sync::Mutex<Instant>,
    queue: tokio::sync::Semaphore,
    clients: Mutex<HashMap<String, VecDeque<Instant>>>,
    cache: Mutex<HashMap<String, CachedResponse>>,
}

impl ScryfallApi {
    pub fn new() -> Self {
        Self {
            next_request: tokio::sync::Mutex::new(Instant::now()),
            queue: tokio::sync::Semaphore::new(QUEUE_CAPACITY),
            clients: Mutex::new(HashMap::new()),
            cache: Mutex::new(HashMap::new()),
        }
    }

    fn allow_client(&self, client: &str) -> bool {
        let now = Instant::now();
        let mut clients = self.clients.lock().unwrap();
        clients.retain(|_, requests| {
            requests.retain(|request| now.duration_since(*request) < CLIENT_WINDOW);
            !requests.is_empty()
        });
        let requests = clients.entry(client.to_owned()).or_default();
        if requests.len() >= CLIENT_REQUEST_LIMIT {
            return false;
        }
        requests.push_back(now);
        true
    }

    fn cached(&self, key: &str) -> Option<CachedResponse> {
        let now = Instant::now();
        let mut cache = self.cache.lock().unwrap();
        cache.retain(|_, response| now.duration_since(response.stored_at) < CACHE_TTL);
        cache.get(key).cloned()
    }

    fn cache(&self, key: String, response: CachedResponse) {
        let mut cache = self.cache.lock().unwrap();
        if cache.len() >= CACHE_CAPACITY {
            if let Some(oldest) = cache
                .iter()
                .min_by_key(|(_, response)| response.stored_at)
                .map(|(key, _)| key.clone())
            {
                cache.remove(&oldest);
            }
        }
        cache.insert(key, response);
    }

    async fn wait(&self) {
        let mut next = self.next_request.lock().await;
        let now = Instant::now();
        if *next > now {
            tokio::time::sleep(*next - now).await;
        }
        *next = Instant::now() + REQUEST_INTERVAL;
    }
}

pub async fn handler(
    State(state): State<std::sync::Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(path): Path<String>,
    OriginalUri(uri): OriginalUri,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !allowed(&method, &path) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let client = crate::routes::client_ip(&headers, addr);
    if !state.scryfall_api.allow_client(&client) {
        return (StatusCode::TOO_MANY_REQUESTS, [(RETRY_AFTER, "60")]).into_response();
    }
    let query = uri
        .query()
        .map(|query| format!("?{query}"))
        .unwrap_or_default();
    let cache_key = format!("{path}{query}");
    let is_get = method == Method::GET;
    if is_get {
        if let Some(response) = state.scryfall_api.cached(&cache_key) {
            return response.into_response();
        }
    }
    let _queue_permit = match state.scryfall_api.queue.try_acquire() {
        Ok(permit) => permit,
        Err(_) => {
            return (StatusCode::TOO_MANY_REQUESTS, [(RETRY_AFTER, "10")]).into_response();
        }
    };
    state.scryfall_api.wait().await;
    let mut request = state
        .http
        .request(method, format!("https://api.scryfall.com/{path}{query}"));
    if let Some(content_type) = headers.get(CONTENT_TYPE) {
        request = request.header(CONTENT_TYPE, content_type);
    }
    if !body.is_empty() {
        request = request.body(body);
    }
    let response = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(%error, %path, "Scryfall API request failed");
            return StatusCode::BAD_GATEWAY.into_response();
        }
    };
    let status = response.status();
    let content_type = response.headers().get(CONTENT_TYPE).cloned();
    let retry_after = response.headers().get(RETRY_AFTER).cloned();
    let body = match response.bytes().await {
        Ok(body) => body,
        Err(error) => {
            tracing::warn!(%error, %path, "Scryfall API response failed");
            return StatusCode::BAD_GATEWAY.into_response();
        }
    };
    if is_get && status.is_success() {
        state.scryfall_api.cache(
            cache_key,
            CachedResponse {
                status,
                content_type: content_type.clone(),
                body: body.clone(),
                stored_at: Instant::now(),
            },
        );
    }
    build_response(status, content_type, retry_after, body)
}

fn build_response(
    status: StatusCode,
    content_type: Option<HeaderValue>,
    retry_after: Option<HeaderValue>,
    body: Bytes,
) -> Response {
    let mut output = Response::builder().status(status);
    if let Some(content_type) = content_type {
        output = output.header(CONTENT_TYPE, content_type);
    }
    if let Some(retry_after) = retry_after {
        output = output.header(RETRY_AFTER, retry_after);
    }
    output.body(axum::body::Body::from(body)).unwrap()
}

impl IntoResponse for CachedResponse {
    fn into_response(self) -> Response {
        build_response(self.status, self.content_type, None, self.body)
    }
}

fn allowed(method: &Method, path: &str) -> bool {
    if method == Method::POST {
        return path == "cards/collection";
    }
    if method != Method::GET {
        return false;
    }
    path == "sets"
        || path == "cards/search"
        || path == "cards/named"
        || (path.starts_with("cards/") && path.ends_with("/rulings"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restricts_methods_and_paths() {
        assert!(allowed(&Method::GET, "cards/search"));
        assert!(allowed(&Method::POST, "cards/collection"));
        assert!(!allowed(&Method::POST, "cards/search"));
        assert!(!allowed(&Method::GET, "bulk-data"));
    }

    #[test]
    fn limits_each_client_independently() {
        let api = ScryfallApi::new();
        for _ in 0..CLIENT_REQUEST_LIMIT {
            assert!(api.allow_client("one"));
        }
        assert!(!api.allow_client("one"));
        assert!(api.allow_client("two"));
    }
}
