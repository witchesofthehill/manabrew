//! The identity token is the only carrier of a session's name. The hub mints
//! signed tokens (`iss` [`HUB_ISSUER`], EdDSA, verified by the relay against
//! the hub's JWKS); a client that cannot reach the hub mints the same shape
//! unsigned (`iss` [`SELF_ISSUER`], `alg` [`UNSIGNED_ALG`], empty signature)
//! and the relay treats the name as unverified. Keep the claim shape in sync
//! with `manabrew-hub/src/auth/token.rs`.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};

pub const HUB_ISSUER: &str = "manabrew-hub";
pub const SELF_ISSUER: &str = "manabrew-client";
pub const RELAY_AUDIENCE: &str = "manabrew-relay";
pub const SIGNED_ALG: &str = "EdDSA";
pub const UNSIGNED_ALG: &str = "none";
/// Keep in sync with `manabrew-hub/src/auth/token.rs::guest_subject` — hub
/// guest tokens are signed like account tokens; only this namespace tells
/// them apart.
pub const GUEST_SUBJECT_PREFIX: &str = "guest:";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityTokenHeader {
    pub alg: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityTokenClaims {
    pub sub: String,
    #[serde(default)]
    pub handle: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub qualification: Option<String>,
    pub iss: String,
    pub aud: String,
    pub iat: i64,
    pub exp: i64,
}

#[derive(Debug, Clone)]
pub struct DecodedIdentityToken {
    pub header: IdentityTokenHeader,
    pub claims: IdentityTokenClaims,
    pub signing_input: String,
    pub signature: Vec<u8>,
}

impl DecodedIdentityToken {
    pub fn is_unsigned(&self) -> bool {
        self.header.alg == UNSIGNED_ALG && self.signature.is_empty()
    }
}

pub fn decode(token: &str) -> Option<DecodedIdentityToken> {
    let mut parts = token.split('.');
    let encoded_header = parts.next()?;
    let encoded_claims = parts.next()?;
    let encoded_signature = parts.next()?;
    if parts.next().is_some() {
        return None;
    }

    let header: IdentityTokenHeader =
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(encoded_header).ok()?).ok()?;
    let claims: IdentityTokenClaims =
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(encoded_claims).ok()?).ok()?;
    let signature = if encoded_signature.is_empty() {
        Vec::new()
    } else {
        URL_SAFE_NO_PAD.decode(encoded_signature).ok()?
    };

    Some(DecodedIdentityToken {
        header,
        claims,
        signing_input: format!("{encoded_header}.{encoded_claims}"),
        signature,
    })
}

pub fn mint_unsigned(subject: &str, handle: &str, iat: i64, ttl_s: i64) -> String {
    let header = IdentityTokenHeader {
        alg: UNSIGNED_ALG.to_string(),
        kid: None,
    };
    let claims = IdentityTokenClaims {
        sub: subject.to_string(),
        handle: handle.to_string(),
        qualification: None,
        iss: SELF_ISSUER.to_string(),
        aud: RELAY_AUDIENCE.to_string(),
        iat,
        exp: iat + ttl_s,
    };
    let encoded_header = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&header).expect("serialize"));
    let encoded_claims = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).expect("serialize"));
    format!("{encoded_header}.{encoded_claims}.")
}
