use aws_lc_rs::aead::{Aad, LessSafeKey, Nonce, UnboundKey, CHACHA20_POLY1305, NONCE_LEN};
use aws_lc_rs::rand::{SecureRandom, SystemRandom};
use base64::prelude::{Engine, BASE64_STANDARD};
use sha2::{Digest, Sha256};

/// Seals a chat message: the sender's IP encrypted, and the message fields
/// authenticated, under a key derived from `SECRET_MANABREW_KEY`. Only a hub
/// holding the same secret can open it, and only against the exact same fields.
pub struct MessageSealer {
    key: LessSafeKey,
    rng: SystemRandom,
}

impl MessageSealer {
    pub fn from_secret(secret: &str) -> Option<Self> {
        let key = Sha256::digest(secret.trim().as_bytes());
        let unbound = UnboundKey::new(&CHACHA20_POLY1305, &key).ok()?;
        Some(Self {
            key: LessSafeKey::new(unbound),
            rng: SystemRandom::new(),
        })
    }

    pub fn seal(&self, ip: &str, aad: &[u8]) -> Option<String> {
        let mut nonce = [0u8; NONCE_LEN];
        self.rng.fill(&mut nonce).ok()?;
        let mut in_out = ip.as_bytes().to_vec();
        self.key
            .seal_in_place_append_tag(
                Nonce::assume_unique_for_key(nonce),
                Aad::from(aad),
                &mut in_out,
            )
            .ok()?;
        let mut out = nonce.to_vec();
        out.extend_from_slice(&in_out);
        Some(BASE64_STANDARD.encode(out))
    }
}

// Keep in sync with manabrew-hub/src/seal.rs.
pub fn chat_seal_aad(from: &str, text: &str, sent_at_ms: u64, room_id: Option<&str>) -> Vec<u8> {
    let mut aad = b"chat".to_vec();
    for field in [from, text, room_id.unwrap_or_default()] {
        aad.extend_from_slice(&(field.len() as u32).to_le_bytes());
        aad.extend_from_slice(field.as_bytes());
    }
    aad.extend_from_slice(&sent_at_ms.to_le_bytes());
    aad
}

pub fn presence_seal_aad(username: &str) -> Vec<u8> {
    let mut aad = b"presence".to_vec();
    aad.extend_from_slice(&(username.len() as u32).to_le_bytes());
    aad.extend_from_slice(username.as_bytes());
    aad
}
