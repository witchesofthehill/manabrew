//! The iroh relay this deployment hosts, in the same process as the game
//! socket. TLS is left off: in production the edge terminates it, and on a LAN
//! there is nothing to terminate.
//!
//! A relay forwards for whoever dials it, so on a public hostname it is
//! somebody else's bandwidth unless something says who may use it. Here that is
//! a room-scoped token: the control plane mints one for a room and hands it to
//! its members in `RoomTransport`, and the relay admits a connection only if it
//! carries one this process minted and has not expired. Being in a room is
//! already an authenticated act, so this adds no new identity, only a way to
//! prove that act to a component that cannot see the lobby.
//!
//! **The signing key is per process and never leaves it.** It cannot be the
//! relay's `server_key`: that one is published, in `knownRelays.ts` and in the
//! bundle every browser downloads, so signing with it would let anyone mint
//! themselves a token and the gate would be decoration. Nothing outside this
//! process needs to verify a token, so nothing outside it needs the key. A
//! restart invalidates the tokens it handed out, which costs nothing: the next
//! `RoomTransport` broadcast carries fresh ones.

use std::net::SocketAddr;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use aws_lc_rs::{hmac, rand};
use iroh_relay::server::{Access, AccessControl, ClientRequest};
use tracing::{debug, error, info};

pub use iroh_relay::server::Server;

/// A ceiling per connection, because a token says who may use the relay and
/// nothing about how much. This process also serves the game socket and shares
/// its cgroup, so an authorised member with a fast link must not be able to
/// starve the thing it exists to help. Well above a game, well below a link.
///
/// Per **connection**, not per client: `accept_conn_limit` is documented as
/// unimplemented in iroh-relay 1.1, so one holder of a token can still open as
/// many connections as it likes and pay this toll on each. That is a real hole
/// and it is bounded only by the token being room-scoped and short-lived.
const CLIENT_BYTES_PER_SECOND: u32 = 512 * 1024;
const CLIENT_BURST_BYTES: u32 = 2 * 1024 * 1024;

/// How long a minted token stays good. Long enough to outlive a game, short
/// enough that a leaked one stops working on its own.
pub const TOKEN_TTL_SECS: u64 = 6 * 60 * 60;

/// Minted once per process, on first use. Losing it on restart is the whole
/// design: an outstanding token stops working and the next roster broadcast
/// replaces it.
fn signing_key() -> &'static hmac::Key {
    static KEY: OnceLock<hmac::Key> = OnceLock::new();
    KEY.get_or_init(|| {
        let mut bytes = [0u8; 32];
        rand::fill(&mut bytes).expect("system rng");
        hmac::Key::new(hmac::HMAC_SHA256, &bytes)
    })
}

/// `<room>.<expiry>.<mac>`. The room id is carried so the mac can be recomputed
/// without the relay storing anything, which means nothing to clean up and no
/// state to get out of step with the lobby.
pub fn mint_token(room_id: &str) -> String {
    let expiry = now_secs() + TOKEN_TTL_SECS;
    let mac = hex(hmac::sign(signing_key(), signed_bytes(room_id, expiry).as_bytes()).as_ref());
    format!("{room_id}.{expiry}.{mac}")
}

fn signed_bytes(room_id: &str, expiry: u64) -> String {
    format!("{room_id}.{expiry}")
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(text.get(i..i + 2)?, 16).ok())
        .collect()
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Admits only connections carrying a token this process minted.
#[derive(Debug)]
struct RoomMembersOnly;

impl AccessControl for RoomMembersOnly {
    async fn on_connect(&self, request: &ClientRequest) -> Access {
        let Some(token) = request.auth_token() else {
            return deny("no token");
        };
        let mut parts = token.rsplitn(3, '.');
        let (Some(mac), Some(expiry), Some(room_id)) = (parts.next(), parts.next(), parts.next())
        else {
            return deny("malformed token");
        };
        let Ok(expiry) = expiry.parse::<u64>() else {
            return deny("malformed token");
        };
        if expiry <= now_secs() {
            return deny("expired token");
        }
        let Some(mac) = unhex(mac) else {
            return deny("malformed token");
        };
        // Constant time, because the tag is attacker-supplied and a `String`
        // comparison leaks where it stopped matching.
        if hmac::verify(
            signing_key(),
            signed_bytes(room_id, expiry).as_bytes(),
            &mac,
        )
        .is_err()
        {
            return deny("bad token");
        }
        Access::Allow
    }
}

fn deny(reason: &'static str) -> Access {
    debug!(reason, "[iroh] refused a relay connection");
    Access::Deny {
        reason: Some(reason.to_string()),
    }
}

/// Binds the relay, or returns `None` when it cannot start. A relay that fails
/// to bind must not take the game socket down with it: peers simply stay direct
/// only, which on a LAN is all they need anyway.
pub async fn spawn(bind: SocketAddr) -> Option<Server> {
    let mut relay = iroh_relay::server::RelayConfig::new(bind);
    relay.access = std::sync::Arc::new(RoomMembersOnly);
    let mut rate = iroh_relay::server::ClientRateLimit::new(
        CLIENT_BYTES_PER_SECOND.try_into().expect("non-zero"),
    );
    rate.max_burst_bytes = Some(CLIENT_BURST_BYTES.try_into().expect("non-zero"));
    relay.limits.client_rx = Some(rate);
    let mut config = iroh_relay::server::ServerConfig::default();
    config.relay = Some(relay);
    match Server::spawn(config).await {
        Ok(server) => {
            info!(%bind, "[iroh] hosting the relay for this deployment");
            Some(server)
        }
        Err(error) => {
            error!(%error, %bind, "[iroh] could not host the relay");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The published relay password, from `src/config/knownRelays.ts`. It is in
    /// the bundle every browser downloads and on screen in the relay picker.
    const PUBLISHED_KEY: &[u8] =
        b"725c5fba479c4e59605e39988e31cb76813afa55cd1e71488c4dd2aae998164b";

    fn forge(key: &[u8], room_id: &str, expiry: u64) -> String {
        let tag = hmac::sign(
            &hmac::Key::new(hmac::HMAC_SHA256, key),
            signed_bytes(room_id, expiry).as_bytes(),
        );
        format!("{room_id}.{expiry}.{}", hex(tag.as_ref()))
    }

    /// A token this process minted verifies. One signed with the relay password
    /// does not, which is the whole reason the signing key is generated rather
    /// than configured.
    #[test]
    fn only_the_key_this_process_generated_signs_a_token() {
        let token = mint_token("room-1");
        let mut parts = token.rsplitn(3, '.');
        let (mac, expiry, room) = (
            parts.next().unwrap(),
            parts.next().unwrap().parse::<u64>().unwrap(),
            parts.next().unwrap(),
        );
        assert_eq!(room, "room-1");
        let verify = |room: &str, expiry: u64, mac: &str| {
            hmac::verify(
                signing_key(),
                signed_bytes(room, expiry).as_bytes(),
                &unhex(mac).unwrap(),
            )
            .is_ok()
        };
        assert!(verify(room, expiry, mac));
        assert_ne!(forge(PUBLISHED_KEY, room, expiry), token);
        assert!(!verify("room-2", expiry, mac));
        assert!(!verify(room, expiry + 1, mac));
    }

    #[test]
    fn a_mac_that_is_not_hex_is_refused_rather_than_parsed() {
        assert!(unhex("zz").is_none());
        assert!(unhex("abc").is_none());
        assert_eq!(unhex("00ff"), Some(vec![0, 255]));
    }

    /// The arithmetic above says a forged token fails to verify. This says the
    /// relay actually refuses the connection, which is the part that costs
    /// bandwidth if it is wrong.
    #[tokio::test]
    async fn the_relay_serves_a_room_that_has_a_token_and_nobody_else() {
        let server = spawn("0.0.0.0:0".parse().unwrap())
            .await
            .expect("spawn relay");
        let url: iroh::RelayUrl = format!("http://{}", server.http_addr().unwrap())
            .parse()
            .unwrap();

        let dial = |token: Option<String>| {
            let url = url.clone();
            async move {
                let mut config = iroh::RelayConfig::new(url, None);
                if let Some(token) = token {
                    config = config.with_auth_token(token);
                }
                let endpoint = iroh::Endpoint::builder(iroh::endpoint::presets::Minimal)
                    .relay_mode(iroh::RelayMode::Custom(iroh::RelayMap::from_iter([config])))
                    .bind()
                    .await
                    .expect("bind");
                let online =
                    tokio::time::timeout(std::time::Duration::from_secs(6), endpoint.online())
                        .await
                        .is_ok();
                endpoint.close().await;
                online
            }
        };

        assert!(
            dial(Some(mint_token("room-1"))).await,
            "a room this process minted for is served"
        );
        assert!(
            !dial(None).await,
            "an endpoint with no token is not, or the relay is anyone's to spend"
        );
        // Exactly what an outsider can build: a room id of their choosing,
        // signed with the key that ships in the bundle.
        assert!(
            !dial(Some(forge(
                PUBLISHED_KEY,
                "room-1",
                now_secs() + TOKEN_TTL_SECS
            )))
            .await,
            "the published relay password must not mint a usable token"
        );

        let _ = server.shutdown().await;
    }

    #[test]
    fn a_token_carries_its_own_expiry() {
        let token = mint_token("room-1");
        let expiry: u64 = token.rsplit('.').nth(1).unwrap().parse().unwrap();
        assert!(expiry > now_secs());
        assert!(expiry <= now_secs() + TOKEN_TTL_SECS);
    }
}
