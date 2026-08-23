use std::sync::Arc;

use aws_lc_rs::signature::{Ed25519KeyPair, KeyPair, UnparsedPublicKey, ED25519};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::Utc;
use manabrew_hub::dto::{AccessTokenResponse, GuestTokenRequest, TokenRequest};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::{refresh_account, touch_refresh_token};
use crate::routes::{internal_error, AppState};
use crate::validate;

const ACCESS_TOKEN_TTL_SECS: u32 = 600;
const CLOCK_SKEW_SECS: i64 = 60;
const GRANT_REFRESH_TOKEN: &str = "refresh_token";
pub const TOKEN_TYPE: &str = "Bearer";
pub const ISSUER: &str = "manabrew-hub";
pub const AUDIENCE_HUB: &str = "manabrew-hub";
pub const AUDIENCE_RELAY: &str = "manabrew-relay";

pub struct IdentityKeys {
    key_pair: Ed25519KeyPair,
    public: Vec<u8>,
    kid: String,
    jwk_x: String,
}

#[derive(Serialize, Deserialize)]
pub struct AccessClaims {
    pub sub: String,
    pub handle: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub qualification: Option<String>,
    pub iss: String,
    pub aud: String,
    pub iat: i64,
    pub exp: i64,
}

impl IdentityKeys {
    pub fn load_or_generate(path: &str) -> Result<Self, String> {
        let der = match std::fs::read(path) {
            Ok(der) => der,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let document =
                    Ed25519KeyPair::generate_pkcs8(&aws_lc_rs::rand::SystemRandom::new())
                        .map_err(|_| "generate ed25519 keypair".to_string())?;
                if let Some(parent) = std::path::Path::new(path).parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                std::fs::write(path, document.as_ref()).map_err(|e| e.to_string())?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
                }
                document.as_ref().to_vec()
            }
            Err(error) => return Err(error.to_string()),
        };
        Self::from_pkcs8(&der)
    }

    pub fn from_pkcs8(der: &[u8]) -> Result<Self, String> {
        let key_pair =
            Ed25519KeyPair::from_pkcs8(der).map_err(|_| "invalid jwt signing key".to_string())?;
        let public = key_pair.public_key().as_ref().to_vec();
        let digest = Sha256::digest(&public);
        let kid = digest[..8].iter().map(|b| format!("{b:02x}")).collect();
        Ok(IdentityKeys {
            key_pair,
            jwk_x: URL_SAFE_NO_PAD.encode(&public),
            public,
            kid,
        })
    }

    fn mint(&self, claims: &AccessClaims) -> String {
        let header = serde_json::json!({ "alg": "EdDSA", "typ": "JWT", "kid": self.kid });
        let signing_input = format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(header.to_string()),
            URL_SAFE_NO_PAD.encode(serde_json::to_string(claims).expect("serialize claims")),
        );
        let signature = self.key_pair.sign(signing_input.as_bytes());
        format!(
            "{signing_input}.{}",
            URL_SAFE_NO_PAD.encode(signature.as_ref())
        )
    }

    pub fn verify(&self, token: &str, audience: &str) -> Option<AccessClaims> {
        let mut parts = token.split('.');
        let (Some(header), Some(payload), Some(signature), None) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            return None;
        };
        let header: serde_json::Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(header).ok()?).ok()?;
        if header["alg"] != "EdDSA" {
            return None;
        }
        let signature = URL_SAFE_NO_PAD.decode(signature).ok()?;
        let signing_input = &token[..token.rfind('.')?];
        UnparsedPublicKey::new(&ED25519, &self.public)
            .verify(signing_input.as_bytes(), &signature)
            .ok()?;
        let claims: AccessClaims =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).ok()?).ok()?;
        let now = Utc::now().timestamp();
        let valid = claims.iss == ISSUER
            && claims.aud == audience
            && !claims.sub.is_empty()
            && claims.exp > now - CLOCK_SKEW_SECS
            && claims.iat < now + CLOCK_SKEW_SECS;
        valid.then_some(claims)
    }
}

pub fn mint_access_token(
    keys: &IdentityKeys,
    account_id: &str,
    handle: &str,
    qualification: Option<&str>,
    audience: &str,
) -> AccessTokenResponse {
    let now = Utc::now().timestamp();
    let claims = AccessClaims {
        sub: account_id.to_string(),
        handle: handle.to_string(),
        qualification: qualification.map(str::to_string),
        iss: ISSUER.into(),
        aud: audience.into(),
        iat: now,
        exp: now + i64::from(ACCESS_TOKEN_TTL_SECS),
    };
    AccessTokenResponse {
        access_token: keys.mint(&claims),
        token_type: TOKEN_TYPE.into(),
        expires_in: ACCESS_TOKEN_TTL_SECS,
    }
}

fn oauth_error(status: StatusCode, error: &str) -> Response {
    (status, Json(serde_json::json!({ "error": error }))).into_response()
}

pub async fn token_handler(
    State(state): State<Arc<AppState>>,
    Json(request): Json<TokenRequest>,
) -> Response {
    if request.grant_type != GRANT_REFRESH_TOKEN {
        return oauth_error(StatusCode::BAD_REQUEST, "unsupported_grant_type");
    }
    let audience = match request.resource.as_deref() {
        None | Some(AUDIENCE_HUB) => AUDIENCE_HUB,
        Some(AUDIENCE_RELAY) => AUDIENCE_RELAY,
        Some(_) => return oauth_error(StatusCode::BAD_REQUEST, "invalid_target"),
    };
    let account = match refresh_account(&state, &request.refresh_token) {
        Ok(Some(account)) => account,
        Ok(None) => return oauth_error(StatusCode::BAD_REQUEST, "invalid_grant"),
        Err(error) => return internal_error(error),
    };
    if let Err(error) = touch_refresh_token(&state, &request.refresh_token) {
        return internal_error(error);
    }
    Json(mint_access_token(
        &state.identity,
        &account.id,
        &account.handle,
        account.qualification.as_deref(),
        audience,
    ))
    .into_response()
}

fn guest_subject(guest_id: &str) -> String {
    let digest = Sha256::digest(guest_id.as_bytes());
    let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("guest:{hex}")
}

pub async fn guest_token_handler(
    State(state): State<Arc<AppState>>,
    Json(request): Json<GuestTokenRequest>,
) -> Response {
    if let Err(error) = validate::validate_guest_name(&request.name) {
        return (StatusCode::UNPROCESSABLE_ENTITY, error).into_response();
    }
    if request.guest_id.trim().is_empty() {
        return (StatusCode::UNPROCESSABLE_ENTITY, "guest id is required").into_response();
    }
    let name = request.name.trim();
    let base = validate::strip_name_tag(name).trim();
    match state.storage.lock().unwrap().handle_exists(base) {
        Ok(true) => {
            return (
                StatusCode::CONFLICT,
                "That name is already claimed. Pick another.",
            )
                .into_response()
        }
        Ok(false) => {}
        Err(error) => return internal_error(error),
    }
    let subject = guest_subject(&request.guest_id);
    Json(mint_access_token(
        &state.identity,
        &subject,
        name,
        None,
        AUDIENCE_RELAY,
    ))
    .into_response()
}

pub async fn jwks_handler(State(state): State<Arc<AppState>>) -> Response {
    Json(serde_json::json!({
        "keys": [{
            "kty": "OKP",
            "crv": "Ed25519",
            "alg": "EdDSA",
            "use": "sig",
            "kid": state.identity.kid,
            "x": state.identity.jwk_x,
        }]
    }))
    .into_response()
}

#[cfg(test)]
pub mod tests {
    use super::*;

    pub use super::AUDIENCE_RELAY;

    pub fn ephemeral() -> IdentityKeys {
        let document =
            Ed25519KeyPair::generate_pkcs8(&aws_lc_rs::rand::SystemRandom::new()).unwrap();
        IdentityKeys::from_pkcs8(document.as_ref()).unwrap()
    }

    pub fn verify_with_jwk(token: &str, jwk_x: &str) -> Option<AccessClaims> {
        let public = URL_SAFE_NO_PAD.decode(jwk_x).ok()?;
        let signature = URL_SAFE_NO_PAD.decode(token.rsplit('.').next()?).ok()?;
        let signing_input = &token[..token.rfind('.')?];
        UnparsedPublicKey::new(&ED25519, &public)
            .verify(signing_input.as_bytes(), &signature)
            .ok()?;
        let payload = token.split('.').nth(1)?;
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).ok()?).ok()
    }

    fn issue(keys: &IdentityKeys, audience: &str) -> String {
        mint_access_token(keys, "acct-1", "brewer", None, audience).access_token
    }

    #[test]
    fn mint_verify_roundtrip() {
        let keys = ephemeral();
        let verified = keys
            .verify(&issue(&keys, AUDIENCE_HUB), AUDIENCE_HUB)
            .unwrap();
        assert_eq!(verified.sub, "acct-1");
        assert_eq!(verified.handle, "brewer");
        assert_eq!(verified.iss, ISSUER);
        assert_eq!(verified.aud, AUDIENCE_HUB);
        assert_eq!(
            verified.exp - verified.iat,
            i64::from(ACCESS_TOKEN_TTL_SECS)
        );
    }

    #[test]
    fn audience_is_not_interchangeable() {
        let keys = ephemeral();
        assert!(keys
            .verify(&issue(&keys, AUDIENCE_RELAY), AUDIENCE_HUB)
            .is_none());
        assert!(keys
            .verify(&issue(&keys, AUDIENCE_HUB), AUDIENCE_RELAY)
            .is_none());
    }

    #[test]
    fn tampered_payload_rejected() {
        let keys = ephemeral();
        let token = issue(&keys, AUDIENCE_HUB);
        let mut parts: Vec<&str> = token.split('.').collect();
        let forged = URL_SAFE_NO_PAD.encode(
            serde_json::to_string(&AccessClaims {
                sub: "acct-2".into(),
                handle: "brewer".into(),
                qualification: None,
                iss: ISSUER.into(),
                aud: AUDIENCE_HUB.into(),
                iat: Utc::now().timestamp(),
                exp: Utc::now().timestamp() + 600,
            })
            .unwrap(),
        );
        parts[1] = &forged;
        assert!(keys.verify(&parts.join("."), AUDIENCE_HUB).is_none());
    }

    #[test]
    fn wrong_key_rejected() {
        let token = issue(&ephemeral(), AUDIENCE_HUB);
        assert!(ephemeral().verify(&token, AUDIENCE_HUB).is_none());
    }

    #[test]
    fn expired_token_rejected() {
        let keys = ephemeral();
        let now = Utc::now().timestamp();
        let token = keys.mint(&AccessClaims {
            sub: "acct-1".into(),
            handle: "brewer".into(),
            qualification: None,
            iss: ISSUER.into(),
            aud: AUDIENCE_HUB.into(),
            iat: now - 7200,
            exp: now - 3600,
        });
        assert!(keys.verify(&token, AUDIENCE_HUB).is_none());
    }

    #[test]
    fn load_or_generate_is_stable() {
        let path = std::env::temp_dir()
            .join(format!("hub-jwt-test-{}.pkcs8", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .into_owned();
        let first = IdentityKeys::load_or_generate(&path).unwrap();
        let second = IdentityKeys::load_or_generate(&path).unwrap();
        std::fs::remove_file(&path).unwrap();
        assert_eq!(first.kid, second.kid);
        assert_eq!(first.jwk_x, second.jwk_x);
    }
}
