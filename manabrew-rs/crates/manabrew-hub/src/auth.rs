use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{ConnectInfo, Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::Json;
use chrono::{Duration, SecondsFormat, Utc};
use manabrew_hub::dto::{
    AuthAccount, AuthIdentity, AuthProviders, AuthSessionResponse, EmailVerifyRequest,
    ExchangeCodeRequest, MagicLinkRequest, MeResponse, OAuthStartRequest, OAuthStartResponse,
    UpdateHandleRequest,
};
use rand::Rng;
use reqwest::Url;
use serde::Deserialize;

use crate::config::OAuthClient;
use crate::routes::{client_ip, generate_token, hash_token, internal_error, AppState};
use crate::storage::{
    is_unique_violation, AccountRow, HandleOutcome, LoginCodeOutcome, NewOAuthState,
};
use crate::validate;

const SESSION_TTL_DAYS: i64 = 90;
const SESSION_EXTEND_THRESHOLD_DAYS: i64 = 60;
const LOGIN_CODE_TTL_MINUTES: i64 = 15;
const LOGIN_CODES_PER_EMAIL_PER_HOUR: u32 = 3;
const STATE_TTL_MINUTES: i64 = 10;
const AUTH_CODE_TTL_WEB_SECS: i64 = 60;
const AUTH_CODE_TTL_DESKTOP_SECS: i64 = 300;
const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LOGIN_CODE_LEN: usize = 8;
const HANDLE_SUFFIX_LEN: usize = 5;
const MAX_EMAIL_LEN: usize = 254;

const PROVIDER_GITHUB: &str = "github";
const PROVIDER_DISCORD: &str = "discord";
const PROVIDER_EMAIL: &str = "email";

const MODE_SIGNIN: &str = "signin";
const MODE_LINK: &str = "link";
const CLIENT_WEB: &str = "web";
const CLIENT_DESKTOP: &str = "desktop";

struct ProviderIdentity {
    user_id: String,
    email: Option<String>,
    email_verified: bool,
}

fn now_str() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn ts_in(duration: Duration) -> String {
    (Utc::now() + duration).to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn generate_code(len: usize) -> String {
    let mut rng = rand::thread_rng();
    (0..len)
        .map(|_| CODE_ALPHABET[rng.gen_range(0..CODE_ALPHABET.len())] as char)
        .collect()
}

fn account_dto(account: &AccountRow) -> AuthAccount {
    AuthAccount {
        id: account.id.clone(),
        handle: account.handle.clone(),
        handle_pending: !account.handle_set,
        created_at: account.created_at.clone(),
    }
}

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|token| !token.is_empty())
}

pub fn bearer_account(
    state: &AppState,
    headers: &HeaderMap,
) -> rusqlite::Result<Option<AccountRow>> {
    let Some(token) = bearer_token(headers) else {
        return Ok(None);
    };
    let token_hash = hash_token(token);
    let storage = state.storage.lock().unwrap();
    let Some(account) = storage.session_account(&token_hash, &now_str())? else {
        return Ok(None);
    };
    storage.extend_session(
        &token_hash,
        &ts_in(Duration::days(SESSION_EXTEND_THRESHOLD_DAYS)),
        &ts_in(Duration::days(SESSION_TTL_DAYS)),
    )?;
    Ok(Some(account))
}

fn create_session(state: &AppState, account: &AccountRow) -> rusqlite::Result<AuthSessionResponse> {
    let token = generate_token();
    state.storage.lock().unwrap().insert_session(
        &hash_token(&token),
        &account.id,
        &now_str(),
        &ts_in(Duration::days(SESSION_TTL_DAYS)),
    )?;
    Ok(AuthSessionResponse {
        token,
        account: account_dto(account),
    })
}

fn mint_auth_code(state: &AppState, account_id: &str, client: &str) -> rusqlite::Result<String> {
    let ttl = if client == CLIENT_DESKTOP {
        Duration::seconds(AUTH_CODE_TTL_DESKTOP_SECS)
    } else {
        Duration::seconds(AUTH_CODE_TTL_WEB_SECS)
    };
    let code = generate_code(LOGIN_CODE_LEN);
    state.storage.lock().unwrap().insert_auth_code(
        &hash_token(&code),
        account_id,
        &now_str(),
        &ts_in(ttl),
    )?;
    Ok(code)
}

fn create_account_with_identity(
    state: &AppState,
    provider: &str,
    provider_user_id: &str,
    email: Option<&str>,
    email_verified: bool,
) -> rusqlite::Result<AccountRow> {
    let storage = state.storage.lock().unwrap();
    let now = now_str();
    let account = loop {
        let account = AccountRow {
            id: uuid::Uuid::new_v4().to_string(),
            handle: format!("brewer-{}", generate_code(HANDLE_SUFFIX_LEN).to_lowercase()),
            handle_set: false,
            created_at: now.clone(),
        };
        match storage.create_account(&account) {
            Ok(()) => break account,
            Err(error) if is_unique_violation(&error) => continue,
            Err(error) => return Err(error),
        }
    };
    storage.insert_identity(
        &account.id,
        provider,
        provider_user_id,
        email,
        email_verified,
        &now,
    )?;
    Ok(account)
}

fn resolve_signin_account(
    state: &AppState,
    provider: &str,
    identity: &ProviderIdentity,
) -> rusqlite::Result<AccountRow> {
    {
        let storage = state.storage.lock().unwrap();
        if let Some(existing) = storage.identity_by_provider(provider, &identity.user_id)? {
            if let Some(account) = storage.get_account(&existing.account_id)? {
                return Ok(account);
            }
        }
        if identity.email_verified {
            if let Some(email) = identity.email.as_deref() {
                if let Some(account_id) = storage.account_id_by_verified_email(email)? {
                    storage.insert_identity(
                        &account_id,
                        provider,
                        &identity.user_id,
                        Some(email),
                        true,
                        &now_str(),
                    )?;
                    if let Some(account) = storage.get_account(&account_id)? {
                        return Ok(account);
                    }
                }
            }
        }
    }
    create_account_with_identity(
        state,
        provider,
        &identity.user_id,
        identity.email.as_deref(),
        identity.email_verified,
    )
}

pub async fn providers_handler(State(state): State<Arc<AppState>>) -> Response {
    Json(AuthProviders {
        github: state.auth.github.is_some(),
        discord: state.auth.discord.is_some(),
        email: state.auth.resend_api_key.is_some(),
    })
    .into_response()
}

fn provider_client<'a>(state: &'a AppState, provider: &str) -> Option<&'a OAuthClient> {
    match provider {
        PROVIDER_GITHUB => state.auth.github.as_ref(),
        PROVIDER_DISCORD => state.auth.discord.as_ref(),
        _ => None,
    }
}

fn redirect_uri(state: &AppState, provider: &str) -> String {
    format!("{}/api/auth/callback/{provider}", state.auth.public_url)
}

fn authorize_url(
    provider: &str,
    client: &OAuthClient,
    redirect_uri: &str,
    state_token: &str,
) -> Option<String> {
    let url = match provider {
        PROVIDER_GITHUB => Url::parse_with_params(
            "https://github.com/login/oauth/authorize",
            [
                ("client_id", client.client_id.as_str()),
                ("redirect_uri", redirect_uri),
                ("scope", "user:email"),
                ("state", state_token),
            ],
        ),
        PROVIDER_DISCORD => Url::parse_with_params(
            "https://discord.com/oauth2/authorize",
            [
                ("response_type", "code"),
                ("client_id", client.client_id.as_str()),
                ("redirect_uri", redirect_uri),
                ("scope", "identify email"),
                ("state", state_token),
                ("prompt", "none"),
            ],
        ),
        _ => return None,
    };
    url.ok().map(String::from)
}

pub async fn oauth_start_handler(
    State(state): State<Arc<AppState>>,
    Path(provider): Path<String>,
    headers: HeaderMap,
    Json(request): Json<OAuthStartRequest>,
) -> Response {
    if provider_client(&state, &provider).is_none() {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    if request.mode != MODE_SIGNIN && request.mode != MODE_LINK {
        return StatusCode::UNPROCESSABLE_ENTITY.into_response();
    }
    if request.client != CLIENT_WEB && request.client != CLIENT_DESKTOP {
        return StatusCode::UNPROCESSABLE_ENTITY.into_response();
    }
    let link_account_id = if request.mode == MODE_LINK {
        match bearer_account(&state, &headers) {
            Ok(Some(account)) => Some(account.id),
            Ok(None) => return StatusCode::UNAUTHORIZED.into_response(),
            Err(error) => return internal_error(error),
        }
    } else {
        None
    };
    let state_token = generate_token();
    let return_to = state.auth.web_app_url.clone();
    let stored = state
        .storage
        .lock()
        .unwrap()
        .insert_oauth_state(&NewOAuthState {
            state_hash: &hash_token(&state_token),
            provider: &provider,
            mode: &request.mode,
            client: &request.client,
            link_account_id: link_account_id.as_deref(),
            return_to: &return_to,
            created_at: &now_str(),
            expires_at: &ts_in(Duration::minutes(STATE_TTL_MINUTES)),
        });
    if let Err(error) = stored {
        return internal_error(error);
    }
    let client = provider_client(&state, &provider).unwrap();
    match authorize_url(
        &provider,
        client,
        &redirect_uri(&state, &provider),
        &state_token,
    ) {
        Some(authorize_url) => Json(OAuthStartResponse { authorize_url }).into_response(),
        None => StatusCode::UNPROCESSABLE_ENTITY.into_response(),
    }
}

#[derive(Deserialize)]
pub struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

fn app_redirect(state: &AppState, return_to: &str, query: &[(&str, &str)]) -> Response {
    let base = if return_to.is_empty() {
        &state.auth.web_app_url
    } else {
        return_to
    };
    match Url::parse_with_params(&format!("{base}/auth/callback"), query) {
        Ok(url) => Redirect::temporary(url.as_str()).into_response(),
        Err(error) => internal_error(error),
    }
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn desktop_page(title: &str, body: &str) -> Response {
    Html(format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{title}</title>\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"></head>\
         <body style=\"margin:0;display:flex;align-items:center;justify-content:center;\
         min-height:100vh;background:#101014;color:#e8e8ec;\
         font-family:system-ui,sans-serif\">\
         <div style=\"text-align:center;padding:2rem;max-width:28rem\">{body}</div>\
         </body></html>"
    ))
    .into_response()
}

fn desktop_code_page(handle: &str, code: &str) -> Response {
    let handle = html_escape(handle);
    desktop_page(
        "Manabrew sign-in",
        &format!(
            "<h1 style=\"font-size:1.2rem;margin-bottom:0.5rem\">Signed in as @{handle}</h1>\
             <p style=\"color:#9a9aa5\">Enter this code in Manabrew to finish signing in:</p>\
             <p style=\"font-size:2rem;letter-spacing:0.3em;font-weight:700;\
             background:#1c1c22;border-radius:0.5rem;padding:1rem\">{code}</p>\
             <p style=\"color:#9a9aa5\">The code expires in 5 minutes. You can close this tab.</p>"
        ),
    )
}

fn desktop_message_page(title: &str, message: &str) -> Response {
    desktop_page(
        title,
        &format!(
            "<h1 style=\"font-size:1.2rem;margin-bottom:0.5rem\">{title}</h1>\
             <p style=\"color:#9a9aa5\">{message}</p>"
        ),
    )
}

async fn oauth_identity(
    state: &AppState,
    provider: &str,
    client: &OAuthClient,
    code: &str,
) -> Result<ProviderIdentity, String> {
    match provider {
        PROVIDER_GITHUB => github_identity(state, client, code).await,
        PROVIDER_DISCORD => discord_identity(state, client, code).await,
        _ => Err(format!("unknown provider {provider}")),
    }
}

#[derive(Deserialize)]
struct OAuthTokenResponse {
    access_token: Option<String>,
}

async fn github_identity(
    state: &AppState,
    client: &OAuthClient,
    code: &str,
) -> Result<ProviderIdentity, String> {
    let token: OAuthTokenResponse = state
        .http
        .post("https://github.com/login/oauth/access_token")
        .header(reqwest::header::ACCEPT, "application/json")
        .form(&[
            ("client_id", client.client_id.as_str()),
            ("client_secret", client.client_secret.as_str()),
            ("code", code),
            ("redirect_uri", &redirect_uri(state, PROVIDER_GITHUB)),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let access_token = token
        .access_token
        .ok_or("github returned no access token")?;

    #[derive(Deserialize)]
    struct GithubUser {
        id: u64,
    }
    #[derive(Deserialize)]
    struct GithubEmail {
        email: String,
        primary: bool,
        verified: bool,
    }
    let user: GithubUser = state
        .http
        .get("https://api.github.com/user")
        .bearer_auth(&access_token)
        .header(reqwest::header::USER_AGENT, "manabrew-hub")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let emails: Vec<GithubEmail> = state
        .http
        .get("https://api.github.com/user/emails")
        .bearer_auth(&access_token)
        .header(reqwest::header::USER_AGENT, "manabrew-hub")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let email = emails
        .iter()
        .find(|e| e.primary && e.verified)
        .or_else(|| emails.iter().find(|e| e.verified))
        .map(|e| e.email.to_lowercase());
    Ok(ProviderIdentity {
        user_id: user.id.to_string(),
        email_verified: email.is_some(),
        email,
    })
}

async fn discord_identity(
    state: &AppState,
    client: &OAuthClient,
    code: &str,
) -> Result<ProviderIdentity, String> {
    let token: OAuthTokenResponse = state
        .http
        .post("https://discord.com/api/oauth2/token")
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", &redirect_uri(state, PROVIDER_DISCORD)),
            ("client_id", client.client_id.as_str()),
            ("client_secret", client.client_secret.as_str()),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let access_token = token
        .access_token
        .ok_or("discord returned no access token")?;

    #[derive(Deserialize)]
    struct DiscordUser {
        id: String,
        email: Option<String>,
        verified: Option<bool>,
    }
    let user: DiscordUser = state
        .http
        .get("https://discord.com/api/users/@me")
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let verified = user.verified.unwrap_or(false);
    Ok(ProviderIdentity {
        user_id: user.id,
        email: user.email.map(|e| e.to_lowercase()).filter(|_| verified),
        email_verified: verified,
    })
}

pub async fn oauth_callback_handler(
    State(state): State<Arc<AppState>>,
    Path(provider): Path<String>,
    Query(query): Query<CallbackQuery>,
) -> Response {
    let stored = match query.state.as_deref() {
        Some(state_token) => {
            match state
                .storage
                .lock()
                .unwrap()
                .take_oauth_state(&hash_token(state_token), &now_str())
            {
                Ok(row) => row,
                Err(error) => return internal_error(error),
            }
        }
        None => None,
    };
    let Some(stored) = stored.filter(|row| row.provider == provider) else {
        return app_redirect(&state, "", &[("error", "state_expired")]);
    };
    let fail = |error: &str| {
        if stored.client == CLIENT_DESKTOP {
            desktop_message_page("Sign-in failed", "Return to Manabrew and try again.")
        } else {
            app_redirect(&state, &stored.return_to, &[("error", error)])
        }
    };
    if query.error.is_some() {
        return fail("oauth_denied");
    }
    let Some(code) = query.code.as_deref() else {
        return fail("oauth_failed");
    };
    let Some(client) = provider_client(&state, &provider) else {
        return fail("oauth_failed");
    };
    let identity = match oauth_identity(&state, &provider, client, code).await {
        Ok(identity) => identity,
        Err(error) => {
            tracing::warn!(%provider, %error, "oauth exchange failed");
            return fail("oauth_failed");
        }
    };
    if stored.mode == MODE_LINK {
        let Some(link_account_id) = stored.link_account_id.as_deref() else {
            return fail("oauth_failed");
        };
        let existing = match state
            .storage
            .lock()
            .unwrap()
            .identity_by_provider(&provider, &identity.user_id)
        {
            Ok(existing) => existing,
            Err(error) => return internal_error(error),
        };
        match existing {
            Some(row) if row.account_id != link_account_id => {
                return fail("identity_taken");
            }
            Some(_) => {}
            None => {
                let inserted = state.storage.lock().unwrap().insert_identity(
                    link_account_id,
                    &provider,
                    &identity.user_id,
                    identity.email.as_deref(),
                    identity.email_verified,
                    &now_str(),
                );
                if let Err(error) = inserted {
                    return internal_error(error);
                }
            }
        }
        if stored.client == CLIENT_DESKTOP {
            return desktop_message_page(
                "Account linked",
                "You can close this tab and return to Manabrew.",
            );
        }
        return app_redirect(&state, &stored.return_to, &[("linked", &provider)]);
    }
    let account = match resolve_signin_account(&state, &provider, &identity) {
        Ok(account) => account,
        Err(error) => return internal_error(error),
    };
    let code = match mint_auth_code(&state, &account.id, &stored.client) {
        Ok(code) => code,
        Err(error) => return internal_error(error),
    };
    if stored.client == CLIENT_DESKTOP {
        return desktop_code_page(&account.handle, &code);
    }
    app_redirect(&state, &stored.return_to, &[("code", &code)])
}

pub async fn exchange_handler(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<ExchangeCodeRequest>,
) -> Response {
    if !state.auth_limiter.allow(&client_ip(&headers, addr)) {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    let code = request.code.trim().to_uppercase();
    let account_id = match state
        .storage
        .lock()
        .unwrap()
        .take_auth_code(&hash_token(&code), &now_str())
    {
        Ok(account_id) => account_id,
        Err(error) => return internal_error(error),
    };
    let Some(account_id) = account_id else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let account = match state.storage.lock().unwrap().get_account(&account_id) {
        Ok(Some(account)) => account,
        Ok(None) => return StatusCode::UNAUTHORIZED.into_response(),
        Err(error) => return internal_error(error),
    };
    match create_session(&state, &account) {
        Ok(session) => Json(session).into_response(),
        Err(error) => internal_error(error),
    }
}

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
        if !state.auth_limiter.allow(&ip) {
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
    let inserted = state.storage.lock().unwrap().insert_login_token(
        &hash_token(&code),
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
        send_login_email(&state, api_key, &email, &code, &link).await;
    }
    StatusCode::OK.into_response()
}

async fn send_login_email(state: &AppState, api_key: &str, email: &str, code: &str, link: &str) {
    let text = format!(
        "Your Manabrew sign-in code: {code}\n\nOr click: {link}\n\nThe code expires in 15 minutes. If you didn't request this, ignore this email."
    );
    let html = format!(
        "<p>Your Manabrew sign-in code:</p>\
         <p style=\"font-size:1.6rem;letter-spacing:0.3em;font-weight:700\">{code}</p>\
         <p><a href=\"{link}\">Or click here to sign in</a></p>\
         <p>The code expires in 15 minutes. If you didn't request this, ignore this email.</p>"
    );
    let result = state
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
        .and_then(|response| response.error_for_status());
    if let Err(error) = result {
        tracing::error!(%error, "failed to send magic link email");
    }
}

pub async fn email_verify_handler(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<EmailVerifyRequest>,
) -> Response {
    if !state.auth_limiter.allow(&client_ip(&headers, addr)) {
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

pub async fn me_handler(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let account = match bearer_account(&state, &headers) {
        Ok(Some(account)) => account,
        Ok(None) => return StatusCode::UNAUTHORIZED.into_response(),
        Err(error) => return internal_error(error),
    };
    let identities = match state.storage.lock().unwrap().list_identities(&account.id) {
        Ok(identities) => identities,
        Err(error) => return internal_error(error),
    };
    Json(MeResponse {
        account: account_dto(&account),
        identities: identities
            .into_iter()
            .map(|identity| AuthIdentity {
                provider: identity.provider,
                email: identity.email,
            })
            .collect(),
    })
    .into_response()
}

pub async fn update_handle_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<UpdateHandleRequest>,
) -> Response {
    let account = match bearer_account(&state, &headers) {
        Ok(Some(account)) => account,
        Ok(None) => return StatusCode::UNAUTHORIZED.into_response(),
        Err(error) => return internal_error(error),
    };
    let handle = request.handle.trim();
    if let Err(message) = validate::validate_handle(handle) {
        return (StatusCode::UNPROCESSABLE_ENTITY, message).into_response();
    }
    match state
        .storage
        .lock()
        .unwrap()
        .update_handle(&account.id, handle)
    {
        Ok(HandleOutcome::Updated) => Json(AuthAccount {
            id: account.id,
            handle: handle.to_string(),
            handle_pending: false,
            created_at: account.created_at,
        })
        .into_response(),
        Ok(HandleOutcome::Conflict) => StatusCode::CONFLICT.into_response(),
        Err(error) => internal_error(error),
    }
}

pub async fn logout_handler(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let Some(token) = bearer_token(&headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    match state
        .storage
        .lock()
        .unwrap()
        .delete_session(&hash_token(token))
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => internal_error(error),
    }
}

pub async fn unlink_identity_handler(
    State(state): State<Arc<AppState>>,
    Path(provider): Path<String>,
    headers: HeaderMap,
) -> Response {
    let account = match bearer_account(&state, &headers) {
        Ok(Some(account)) => account,
        Ok(None) => return StatusCode::UNAUTHORIZED.into_response(),
        Err(error) => return internal_error(error),
    };
    let storage = state.storage.lock().unwrap();
    let identities = match storage.list_identities(&account.id) {
        Ok(identities) => identities,
        Err(error) => return internal_error(error),
    };
    if !identities.iter().any(|i| i.provider == provider) {
        return StatusCode::NOT_FOUND.into_response();
    }
    if identities.len() <= 1 {
        return StatusCode::CONFLICT.into_response();
    }
    match storage.delete_identity(&account.id, &provider) {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => internal_error(error),
    }
}
