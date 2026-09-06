use aws_lc_rs::aead::{Aad, LessSafeKey, Nonce, UnboundKey, CHACHA20_POLY1305, NONCE_LEN};
use base64::prelude::{Engine, BASE64_STANDARD};
use sha2::{Digest, Sha256};

pub struct SealOpener {
    key: LessSafeKey,
}

impl SealOpener {
    pub fn from_secret(secret: &str) -> Option<Self> {
        let key = Sha256::digest(secret.trim().as_bytes());
        let unbound = UnboundKey::new(&CHACHA20_POLY1305, &key).ok()?;
        Some(Self {
            key: LessSafeKey::new(unbound),
        })
    }

    pub fn open(&self, seal: &str, aad: &[u8]) -> Option<String> {
        let bytes = BASE64_STANDARD.decode(seal.trim()).ok()?;
        if bytes.len() <= NONCE_LEN {
            return None;
        }
        let (nonce, sealed) = bytes.split_at(NONCE_LEN);
        let nonce = Nonce::try_assume_unique_for_key(nonce).ok()?;
        let mut in_out = sealed.to_vec();
        let plain = self
            .key
            .open_in_place(nonce, Aad::from(aad), &mut in_out)
            .ok()?;
        String::from_utf8(plain.to_vec()).ok()
    }
}

// Keep in sync with manabrew-server/src/seal.rs.
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
