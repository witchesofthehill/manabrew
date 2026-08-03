use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::Duration;
use manabrew_hub::dto::{EmailVerifyRequest, MagicLinkRequest};
use maud::html;
use reqwest::Url;

use super::{
    create_session, generate_code, now_str, resolve_signin_account, ts_in, ProviderIdentity,
    LOGIN_CODE_LEN,
};
use crate::routes::{client_ip, hash_token, internal_error, AppState};
use crate::storage::LoginCodeOutcome;

const LOGIN_CODE_TTL_MINUTES: i64 = 15;
const LOGIN_CODES_PER_EMAIL_PER_HOUR: u32 = 3;
const MAX_EMAIL_LEN: usize = 254;

const PROVIDER_EMAIL: &str = "email";

fn normalize_email(email: &str) -> Option<String> {
    let email = email.trim().to_lowercase();
    let valid = email.len() <= MAX_EMAIL_LEN
        && email.chars().all(|c| !c.is_whitespace() && !c.is_control())
        && email.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty() && domain.contains('.') && !domain.starts_with('.')
        });
    valid.then_some(email)
}

pub async fn email_request_handler(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<MagicLinkRequest>,
) -> Response {
    let Some(email) = normalize_email(&request.email) else {
        return StatusCode::UNPROCESSABLE_ENTITY.into_response();
    };
    if state.auth.resend_api_key.is_none() {
        tracing::warn!("magic link requested but email sending is disabled");
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    let ip = client_ip(&headers, addr);
    let allowed = {
        if !state.auth_email_limiter.allow(&ip) {
            false
        } else {
            let hour_ago = ts_in(Duration::hours(-1));
            match state
                .storage
                .lock()
                .unwrap()
                .login_tokens_since(&email, &hour_ago)
            {
                Ok(count) => count < LOGIN_CODES_PER_EMAIL_PER_HOUR,
                Err(error) => return internal_error(error),
            }
        }
    };
    if !allowed {
        tracing::warn!("magic link request rate limited");
        return StatusCode::OK.into_response();
    }
    let code = generate_code(LOGIN_CODE_LEN);
    let code_hash = hash_token(&code);
    let inserted = state.storage.lock().unwrap().insert_login_token(
        &code_hash,
        &email,
        &now_str(),
        &ts_in(Duration::minutes(LOGIN_CODE_TTL_MINUTES)),
        &ip,
    );
    if let Err(error) = inserted {
        return internal_error(error);
    }
    let link = Url::parse_with_params(
        &format!("{}/auth/callback", state.auth.web_app_url),
        [("email", email.as_str()), ("code", code.as_str())],
    )
    .map(String::from)
    .unwrap_or_else(|_| state.auth.web_app_url.clone());
    if let Some(api_key) = state.auth.resend_api_key.as_deref() {
        if let Err(error) = send_login_email(&state, api_key, &email, &code, &link).await {
            tracing::error!(%error, "failed to send magic link email");
            if let Err(delete_error) = state.storage.lock().unwrap().delete_login_token(&code_hash)
            {
                tracing::error!(%delete_error, "failed to remove undelivered login code");
            }
            return (
                StatusCode::BAD_GATEWAY,
                "The sign-in email could not be sent. Try again shortly.",
            )
                .into_response();
        }
    }
    StatusCode::OK.into_response()
}

async fn send_login_email(
    state: &AppState,
    api_key: &str,
    email: &str,
    code: &str,
    link: &str,
) -> Result<(), reqwest::Error> {
    let text = format!(
        "Your Manabrew sign-in code: {code}\n\nOr click: {link}\n\nThe code expires in 15 minutes. If you didn't request this, ignore this email."
    );
    let html = html! {
        p { "Your Manabrew sign-in code:" }
        p style="font-size:1.6rem;letter-spacing:0.3em;font-weight:700" { (code) }
        p { a href=(link) { "Or click here to sign in" } }
        p { "The code expires in 15 minutes. If you didn't request this, ignore this email." }
    }
    .into_string();
    state
        .http
        .post("https://api.resend.com/emails")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "from": state.auth.email_from,
            "to": [email],
            "subject": "Sign in to Manabrew",
            "text": text,
            "html": html,
        }))
        .send()
        .await
        .and_then(|response| response.error_for_status())?;
    Ok(())
}

pub async fn email_verify_handler(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<EmailVerifyRequest>,
) -> Response {
    if !state.auth_code_limiter.allow(&client_ip(&headers, addr)) {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    let Some(email) = normalize_email(&request.email) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let code = request.code.trim().to_uppercase();
    let outcome =
        match state
            .storage
            .lock()
            .unwrap()
            .take_login_code(&email, &hash_token(&code), &now_str())
        {
            Ok(outcome) => outcome,
            Err(error) => return internal_error(error),
        };
    if outcome != LoginCodeOutcome::Verified {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let identity = ProviderIdentity {
        user_id: email.clone(),
        email: Some(email),
        email_verified: true,
    };
    let account = match resolve_signin_account(&state, PROVIDER_EMAIL, &identity) {
        Ok(account) => account,
        Err(error) => return internal_error(error),
    };
    match create_session(&state, &account) {
        Ok(session) => Json(session).into_response(),
        Err(error) => internal_error(error),
    }
}
