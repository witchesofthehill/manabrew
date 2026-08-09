mod account;
mod email;
mod oauth;
mod token;

pub use account::{
    delete_account_handler, exchange_handler, export_account_handler, logout_handler, me_handler,
    unlink_identity_handler, update_handle_handler,
};
pub use email::{email_request_handler, email_verify_handler};
pub use oauth::{oauth_callback_handler, oauth_start_handler};
#[cfg(test)]
pub use token::tests as token_tests;
pub use token::{jwks_handler, token_handler, IdentityKeys};

use std::sync::Arc;

use axum::extract::{FromRequestParts, State};
use axum::http::request::Parts;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{Duration, SecondsFormat, Utc};
use manabrew_hub::dto::{AuthAccount, AuthProviders, AuthSessionResponse};
use rand::Rng;

use crate::routes::{generate_token, hash_token, internal_error, AppState};
use crate::storage::{is_unique_violation, AccountRow};

const SESSION_TTL_DAYS: i64 = 90;
const SESSION_EXTEND_THRESHOLD_DAYS: i64 = 60;
const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LOGIN_CODE_LEN: usize = 8;
const HANDLE_SUFFIX_LEN: usize = 5;

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

pub struct SessionAccount(pub AccountRow);

#[axum::async_trait]
impl FromRequestParts<Arc<AppState>> for SessionAccount {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        match bearer_account(state, &parts.headers) {
            Ok(Some(account)) => Ok(SessionAccount(account)),
            Ok(None) => Err(StatusCode::UNAUTHORIZED.into_response()),
            Err(error) => Err(internal_error(error)),
        }
    }
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
