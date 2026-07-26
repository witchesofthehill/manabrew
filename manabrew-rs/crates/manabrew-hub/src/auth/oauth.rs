use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::Json;
use chrono::Duration;
use manabrew_hub::dto::{OAuthStartRequest, OAuthStartResponse};
use maud::{html, Markup, DOCTYPE};
use reqwest::Url;
use serde::Deserialize;

use super::{
    bearer_account, generate_code, now_str, resolve_signin_account, ts_in, ProviderIdentity,
    LOGIN_CODE_LEN,
};
use crate::config::OAuthClient;
use crate::routes::{generate_token, hash_token, internal_error, AppState};
use crate::storage::NewOAuthState;

const STATE_TTL_MINUTES: i64 = 10;
const AUTH_CODE_TTL_WEB_SECS: i64 = 60;
const AUTH_CODE_TTL_DESKTOP_SECS: i64 = 300;

const PROVIDER_GITHUB: &str = "github";
const PROVIDER_DISCORD: &str = "discord";

const MODE_SIGNIN: &str = "signin";
const MODE_LINK: &str = "link";
const CLIENT_WEB: &str = "web";
const CLIENT_DESKTOP: &str = "desktop";

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

fn desktop_page(title: &str, body: Markup) -> Response {
    html! {
        (DOCTYPE)
        html {
            head {
                meta charset="utf-8";
                title { (title) }
                meta name="viewport" content="width=device-width, initial-scale=1";
            }
            body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#101014;color:#e8e8ec;font-family:system-ui,sans-serif" {
                div style="text-align:center;padding:2rem;max-width:28rem" { (body) }
            }
        }
    }
    .into_response()
}

fn desktop_code_page(handle: &str, code: &str) -> Response {
    desktop_page(
        "Manabrew sign-in",
        html! {
            h1 style="font-size:1.2rem;margin-bottom:0.5rem" { "Signed in as @" (handle) }
            p style="color:#9a9aa5" { "Enter this code in Manabrew to finish signing in:" }
            p style="font-size:2rem;letter-spacing:0.3em;font-weight:700;background:#1c1c22;border-radius:0.5rem;padding:1rem" { (code) }
            p style="color:#9a9aa5" { "The code expires in 5 minutes. You can close this tab." }
        },
    )
}

fn desktop_message_page(title: &str, message: &str) -> Response {
    desktop_page(
        title,
        html! {
            h1 style="font-size:1.2rem;margin-bottom:0.5rem" { (title) }
            p style="color:#9a9aa5" { (message) }
        },
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
