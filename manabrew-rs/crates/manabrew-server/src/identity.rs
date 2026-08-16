use std::collections::HashMap;
use std::time::{Duration, Instant};

use aws_lc_rs::signature::{UnparsedPublicKey, ED25519};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;
use tracing::warn;

use crate::protocol::IdentityProof;

// Keep in sync with manabrew-hub/src/auth/token.rs, which mints these tokens.
const ISSUER: &str = "manabrew-hub";
const AUDIENCE: &str = "manabrew-relay";

const CLOCK_SKEW_SECS: i64 = 60;
const JWKS_REFRESH_COOLDOWN: Duration = Duration::from_secs(60);
const JWKS_TIMEOUT: Duration = Duration::from_secs(5);
const DEVICE_SECRET_MIN_LEN: usize = 16;
const DEVICE_SECRET_MAX_LEN: usize = 512;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionIdentity {
    Account(String),
    Device(String),
}

impl SessionIdentity {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Account(_) => "account",
            Self::Device(_) => "device",
        }
    }
}

#[derive(Deserialize)]
struct JwtHeader {
    alg: String,
    kid: String,
}

#[derive(Deserialize)]
struct IdentityClaims {
    sub: String,
    iss: String,
    aud: String,
    iat: i64,
    exp: i64,
}

#[derive(Deserialize)]
struct Jwks {
    keys: Vec<Jwk>,
}

#[derive(Deserialize)]
struct Jwk {
    kid: String,
    kty: String,
    crv: String,
    x: String,
}

#[derive(Default)]
struct KeyCache {
    keys: HashMap<String, Vec<u8>>,
    last_fetch: Option<Instant>,
}

pub struct IdentityVerifier {
    jwks_url: Option<String>,
    http: reqwest::Client,
    cache: Mutex<KeyCache>,
}

impl IdentityVerifier {
    pub fn new(jwks_url: Option<String>) -> Self {
        IdentityVerifier {
            jwks_url,
            http: reqwest::Client::builder()
                .timeout(JWKS_TIMEOUT)
                .build()
                .unwrap_or_default(),
            cache: Mutex::new(KeyCache::default()),
        }
    }

    pub fn hub_configured(&self) -> bool {
        self.jwks_url.is_some()
    }

    pub async fn resolve(&self, proof: &IdentityProof) -> Vec<SessionIdentity> {
        let mut resolved = Vec::new();
        if let Some(token) = proof.token.as_deref() {
            if let Some(identity) = self.account_identity(token).await {
                resolved.push(identity);
            }
        }
        if let Some(identity) = proof.device.as_deref().and_then(device_identity) {
            resolved.push(identity);
        }
        resolved
    }

    async fn account_identity(&self, token: &str) -> Option<SessionIdentity> {
        let mut parts = token.split('.');
        let encoded_header = parts.next()?;
        let encoded_claims = parts.next()?;
        let encoded_signature = parts.next()?;
        if parts.next().is_some() {
            return None;
        }

        let header: JwtHeader = serde_json::from_slice(&decode(encoded_header)?).ok()?;
        if header.alg != "EdDSA" {
            return None;
        }

        let key = self.public_key(&header.kid).await?;
        let signing_input = format!("{encoded_header}.{encoded_claims}");
        UnparsedPublicKey::new(&ED25519, &key)
            .verify(signing_input.as_bytes(), &decode(encoded_signature)?)
            .ok()?;

        let claims: IdentityClaims = serde_json::from_slice(&decode(encoded_claims)?).ok()?;
        if claims.iss != ISSUER || claims.aud != AUDIENCE || claims.sub.is_empty() {
            return None;
        }

        let now = chrono::Utc::now().timestamp();
        if claims.exp + CLOCK_SKEW_SECS < now || claims.iat - CLOCK_SKEW_SECS > now {
            return None;
        }

        Some(SessionIdentity::Account(claims.sub))
    }

    async fn public_key(&self, kid: &str) -> Option<Vec<u8>> {
        let url = self.jwks_url.as_ref()?;
        let mut cache = self.cache.lock().await;
        if let Some(key) = cache.keys.get(kid) {
            return Some(key.clone());
        }
        if cache
            .last_fetch
            .is_some_and(|at| at.elapsed() < JWKS_REFRESH_COOLDOWN)
        {
            return None;
        }

        cache.last_fetch = Some(Instant::now());
        match self.fetch_jwks(url).await {
            Ok(keys) => cache.keys = keys,
            Err(error) => {
                warn!(%error, "identity jwks fetch failed");
                return None;
            }
        }
        cache.keys.get(kid).cloned()
    }

    async fn fetch_jwks(&self, url: &str) -> Result<HashMap<String, Vec<u8>>, reqwest::Error> {
        let jwks: Jwks = self
            .http
            .get(url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(jwks
            .keys
            .into_iter()
            .filter(|jwk| jwk.kty == "OKP" && jwk.crv == "Ed25519")
            .filter_map(|jwk| Some((jwk.kid, decode(&jwk.x)?)))
            .collect())
    }
}

pub fn same_owner(session: &[SessionIdentity], presented: &[SessionIdentity]) -> bool {
    !session.is_empty() && presented.iter().any(|identity| session.contains(identity))
}

pub fn label(identities: &[SessionIdentity]) -> &'static str {
    identities
        .first()
        .map_or("anonymous", SessionIdentity::kind)
}

fn device_identity(secret: &str) -> Option<SessionIdentity> {
    if !(DEVICE_SECRET_MIN_LEN..=DEVICE_SECRET_MAX_LEN).contains(&secret.len()) {
        return None;
    }
    let digest = Sha256::digest(secret.as_bytes());
    Some(SessionIdentity::Device(
        digest.iter().map(|byte| format!("{byte:02x}")).collect(),
    ))
}

fn decode(value: &str) -> Option<Vec<u8>> {
    URL_SAFE_NO_PAD.decode(value).ok()
}

#[cfg(test)]
mod tests {
    use aws_lc_rs::signature::{Ed25519KeyPair, KeyPair};

    use super::*;

    struct Signer {
        key_pair: Ed25519KeyPair,
    }

    impl Signer {
        fn new() -> Self {
            let document =
                Ed25519KeyPair::generate_pkcs8(&aws_lc_rs::rand::SystemRandom::new()).unwrap();
            Signer {
                key_pair: Ed25519KeyPair::from_pkcs8(document.as_ref()).unwrap(),
            }
        }

        fn mint(&self, claims: serde_json::Value) -> String {
            let header = serde_json::json!({ "alg": "EdDSA", "typ": "JWT", "kid": "test" });
            let signing_input = format!(
                "{}.{}",
                URL_SAFE_NO_PAD.encode(header.to_string()),
                URL_SAFE_NO_PAD.encode(claims.to_string()),
            );
            let signature = self.key_pair.sign(signing_input.as_bytes());
            format!(
                "{signing_input}.{}",
                URL_SAFE_NO_PAD.encode(signature.as_ref())
            )
        }
    }

    async fn verifier_for(signer: &Signer) -> IdentityVerifier {
        let verifier = IdentityVerifier::new(Some("http://unused".into()));
        verifier.cache.lock().await.keys.insert(
            "test".into(),
            signer.key_pair.public_key().as_ref().to_vec(),
        );
        verifier
    }

    fn token_proof(token: String) -> IdentityProof {
        IdentityProof {
            token: Some(token),
            device: None,
        }
    }

    fn claims(now: i64) -> serde_json::Value {
        serde_json::json!({
            "sub": "account-1",
            "handle": "brewer",
            "iss": ISSUER,
            "aud": AUDIENCE,
            "iat": now,
            "exp": now + 600,
        })
    }

    #[tokio::test]
    async fn accepts_a_token_signed_by_the_hub_key() {
        let signer = Signer::new();
        let verifier = verifier_for(&signer).await;
        let token = signer.mint(claims(chrono::Utc::now().timestamp()));

        let resolved = verifier.resolve(&token_proof(token)).await;

        assert_eq!(resolved, vec![SessionIdentity::Account("account-1".into())]);
    }

    #[tokio::test]
    async fn rejects_tampered_expired_and_foreign_tokens() {
        let signer = Signer::new();
        let verifier = verifier_for(&signer).await;
        let now = chrono::Utc::now().timestamp();

        let mut tampered = signer.mint(claims(now));
        tampered.replace_range(..1, "x");
        assert!(verifier.resolve(&token_proof(tampered)).await.is_empty());

        let expired = signer.mint(serde_json::json!({
            "sub": "account-1", "iss": ISSUER, "aud": AUDIENCE,
            "iat": now - 3600, "exp": now - 1800,
        }));
        assert!(verifier.resolve(&token_proof(expired)).await.is_empty());

        let wrong_audience = signer.mint(serde_json::json!({
            "sub": "account-1", "iss": ISSUER, "aud": "someone-else",
            "iat": now, "exp": now + 600,
        }));
        assert!(verifier
            .resolve(&token_proof(wrong_audience))
            .await
            .is_empty());

        let other = Signer::new();
        let forged = other.mint(claims(now));
        assert!(verifier.resolve(&token_proof(forged)).await.is_empty());
    }

    #[tokio::test]
    async fn falls_back_to_the_device_secret_without_a_configured_hub() {
        let signer = Signer::new();
        let verifier = IdentityVerifier::new(None);
        let secret = "self-hosted-device-secret";
        let proof = IdentityProof {
            token: Some(signer.mint(claims(chrono::Utc::now().timestamp()))),
            device: Some(secret.into()),
        };

        assert_eq!(
            verifier.resolve(&proof).await,
            device_identity(secret).into_iter().collect::<Vec<_>>()
        );
        assert!(verifier
            .resolve(&token_proof("a.b.c".into()))
            .await
            .is_empty());
    }

    #[test]
    fn device_secrets_hash_stably_and_bound_length() {
        let secret = "a".repeat(DEVICE_SECRET_MIN_LEN);
        assert_eq!(device_identity(&secret), device_identity(&secret));
        assert_ne!(device_identity(&secret), device_identity(&"b".repeat(32)));
        assert_eq!(device_identity("short"), None);
        assert_eq!(
            device_identity(&"a".repeat(DEVICE_SECRET_MAX_LEN + 1)),
            None
        );
    }
}
