use std::sync::Arc;

use aws_lc_rs::signature::{Ed25519KeyPair, KeyPair};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::Utc;
use manabrew_hub::dto::IdentityTokenResponse;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::bearer_account;
use crate::routes::{internal_error, AppState};

const TOKEN_TTL_SECS: u32 = 600;
pub const ISSUER: &str = "manabrew-hub";

pub struct IdentityKeys {
    key_pair: Ed25519KeyPair,
    kid: String,
    jwk_x: String,
}

#[derive(Serialize, Deserialize)]
pub struct IdentityClaims {
    pub sub: String,
    pub handle: String,
    pub iss: String,
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
            kid,
            jwk_x: URL_SAFE_NO_PAD.encode(&public),
        })
    }

    fn mint(&self, claims: &IdentityClaims) -> String {
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
}

pub async fn token_handler(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let account = match bearer_account(&state, &headers) {
        Ok(Some(account)) => account,
        Ok(None) => return StatusCode::UNAUTHORIZED.into_response(),
        Err(error) => return internal_error(error),
    };
    let now = Utc::now().timestamp();
    let claims = IdentityClaims {
        sub: account.id,
        handle: account.handle,
        iss: ISSUER.into(),
        iat: now,
        exp: now + i64::from(TOKEN_TTL_SECS),
    };
    Json(IdentityTokenResponse {
        token: state.identity.mint(&claims),
        expires_in: TOKEN_TTL_SECS,
    })
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
    use aws_lc_rs::signature::{UnparsedPublicKey, ED25519};

    pub fn ephemeral() -> IdentityKeys {
        let document =
            Ed25519KeyPair::generate_pkcs8(&aws_lc_rs::rand::SystemRandom::new()).unwrap();
        IdentityKeys::from_pkcs8(document.as_ref()).unwrap()
    }

    fn claims() -> IdentityClaims {
        let now = Utc::now().timestamp();
        IdentityClaims {
            sub: "acct-1".into(),
            handle: "brewer".into(),
            iss: ISSUER.into(),
            iat: now,
            exp: now + i64::from(TOKEN_TTL_SECS),
        }
    }

    pub fn verify(token: &str, jwk_x: &str) -> Result<IdentityClaims, String> {
        let mut parts = token.split('.');
        let (Some(header), Some(payload), Some(signature), None) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            return Err("malformed token".into());
        };
        let header: serde_json::Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(header).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        if header["alg"] != "EdDSA" {
            return Err("unexpected alg".into());
        }
        let public = URL_SAFE_NO_PAD.decode(jwk_x).map_err(|e| e.to_string())?;
        let signature = URL_SAFE_NO_PAD
            .decode(signature)
            .map_err(|e| e.to_string())?;
        let signing_input = &token[..token.rfind('.').unwrap()];
        UnparsedPublicKey::new(&ED25519, &public)
            .verify(signing_input.as_bytes(), &signature)
            .map_err(|_| "bad signature".to_string())?;
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())
    }

    #[test]
    fn mint_verify_roundtrip() {
        let keys = ephemeral();
        let token = keys.mint(&claims());
        let verified = verify(&token, &keys.jwk_x).unwrap();
        assert_eq!(verified.sub, "acct-1");
        assert_eq!(verified.handle, "brewer");
        assert_eq!(verified.iss, ISSUER);
        assert_eq!(verified.exp - verified.iat, i64::from(TOKEN_TTL_SECS));
    }

    #[test]
    fn tampered_payload_rejected() {
        let keys = ephemeral();
        let token = keys.mint(&claims());
        let mut parts: Vec<&str> = token.split('.').collect();
        let forged = URL_SAFE_NO_PAD.encode(
            serde_json::to_string(&IdentityClaims {
                sub: "acct-2".into(),
                ..claims()
            })
            .unwrap(),
        );
        parts[1] = &forged;
        assert!(verify(&parts.join("."), &keys.jwk_x).is_err());
    }

    #[test]
    fn wrong_key_rejected() {
        let token = ephemeral().mint(&claims());
        assert!(verify(&token, &ephemeral().jwk_x).is_err());
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
