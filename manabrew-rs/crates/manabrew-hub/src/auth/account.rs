use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{ConnectInfo, Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use manabrew_hub::dto::{
    AuthAccount, AuthIdentity, ExchangeCodeRequest, MeResponse, RevocationRequest,
    UpdateHandleRequest,
};

use super::{account_dto, create_session, now_str, revoke_refresh_token, SessionAccount};
use crate::routes::{client_ip, hash_token, internal_error, AppState};
use crate::storage::HandleOutcome;
use crate::validate;

pub async fn exchange_handler(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<ExchangeCodeRequest>,
) -> Response {
    if !state.auth_code_limiter.allow(&client_ip(&headers, addr)) {
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

pub async fn me_handler(
    State(state): State<Arc<AppState>>,
    SessionAccount(account): SessionAccount,
) -> Response {
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
    SessionAccount(account): SessionAccount,
    Json(request): Json<UpdateHandleRequest>,
) -> Response {
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
            avatar_url: account.avatar_url,
            avatar_asset_id: account.avatar_asset_id,
        })
        .into_response(),
        Ok(HandleOutcome::Conflict) => StatusCode::CONFLICT.into_response(),
        Err(error) => internal_error(error),
    }
}

pub async fn delete_account_handler(
    State(state): State<Arc<AppState>>,
    SessionAccount(account): SessionAccount,
) -> Response {
    if let Some(assets) = state.assets.as_ref() {
        let owned = state
            .storage
            .lock()
            .unwrap()
            .account_asset_kinds(&account.id);
        let owned = match owned {
            Ok(owned) => owned,
            Err(error) => return internal_error(error),
        };
        for (asset_id, kind) in owned {
            let object_key = crate::assets::object_key(&account.id, kind, &asset_id);
            if let Err(error) = assets.store.delete(&object_key).await {
                return internal_error(error);
            }
        }
    }
    match state.storage.lock().unwrap().delete_account(&account.id) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => internal_error(error),
    }
}

pub async fn export_account_handler(
    State(state): State<Arc<AppState>>,
    SessionAccount(account): SessionAccount,
) -> Response {
    match state
        .storage
        .lock()
        .unwrap()
        .export_account(&account.id, &now_str())
    {
        Ok(export) => Json(export).into_response(),
        Err(error) => internal_error(error),
    }
}

pub async fn logout_handler(
    State(state): State<Arc<AppState>>,
    Json(request): Json<RevocationRequest>,
) -> Response {
    match revoke_refresh_token(&state, &request.token) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => internal_error(error),
    }
}

pub async fn unlink_identity_handler(
    State(state): State<Arc<AppState>>,
    Path(provider): Path<String>,
    SessionAccount(account): SessionAccount,
) -> Response {
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
