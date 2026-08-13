use std::time::{Duration, Instant};

use axum::body::Bytes;
use axum::extract::{OriginalUri, Path, State};
use axum::http::header::{CONTENT_TYPE, RETRY_AFTER};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};

use crate::routes::AppState;

const REQUEST_INTERVAL: Duration = Duration::from_millis(300);

pub struct ScryfallApi {
    next_request: tokio::sync::Mutex<Instant>,
}

impl ScryfallApi {
    pub fn new() -> Self {
        Self {
            next_request: tokio::sync::Mutex::new(Instant::now()),
        }
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
    Path(path): Path<String>,
    OriginalUri(uri): OriginalUri,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !allowed(&method, &path) {
        return StatusCode::NOT_FOUND.into_response();
    }
    state.scryfall_api.wait().await;
    let query = uri
        .query()
        .map(|query| format!("?{query}"))
        .unwrap_or_default();
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
    let mut output = Response::builder().status(status);
    if let Some(content_type) = content_type {
        output = output.header(CONTENT_TYPE, content_type);
    }
    if let Some(retry_after) = retry_after {
        output = output.header(RETRY_AFTER, retry_after);
    }
    output.body(axum::body::Body::from(body)).unwrap()
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
