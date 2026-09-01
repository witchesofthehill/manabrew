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

use std::net::SocketAddr;
use std::time::{SystemTime, UNIX_EPOCH};

use aws_lc_rs::hmac;
use iroh_relay::server::{Access, AccessControl, ClientRequest};
use tracing::{debug, error, info};

pub use iroh_relay::server::Server;

/// A ceiling per connection, because a token says who may use the relay and
/// nothing about how much. This process also serves the game socket and shares
/// its cgroup, so an authorised member with a fast link must not be able to
/// starve the thing it exists to help. Well above a game, well below a link.
const CLIENT_BYTES_PER_SECOND: u32 = 512 * 1024;
const CLIENT_BURST_BYTES: u32 = 2 * 1024 * 1024;

/// How long a minted token stays good. Long enough to outlive a game, short
/// enough that a leaked one stops working on its own.
pub const TOKEN_TTL_SECS: u64 = 6 * 60 * 60;

/// `<room>.<expiry>.<mac>`. The room id is carried so the mac can be recomputed
/// without the relay storing anything, which means nothing to clean up and no
/// state to get out of step with the lobby.
pub fn mint_token(server_key: &str, room_id: &str) -> String {
    let expiry = now_secs() + TOKEN_TTL_SECS;
    let mac = sign(server_key, room_id, expiry);
    format!("{room_id}.{expiry}.{mac}")
}

fn sign(server_key: &str, room_id: &str, expiry: u64) -> String {
    let key = hmac::Key::new(hmac::HMAC_SHA256, server_key.as_bytes());
    let tag = hmac::sign(&key, format!("{room_id}.{expiry}").as_bytes());
    tag.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Admits only connections carrying a token this process minted.
#[derive(Debug)]
struct RoomMembersOnly {
    server_key: String,
}

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
        // Comparing the hex of a fresh mac, not the bytes of the presented one:
        // an attacker choosing the room id and expiry still cannot produce the
        // mac without the key.
        if sign(&self.server_key, room_id, expiry) != mac {
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
pub async fn spawn(bind: SocketAddr, server_key: &str) -> Option<Server> {
    let mut relay = iroh_relay::server::RelayConfig::new(bind);
    relay.access = std::sync::Arc::new(RoomMembersOnly {
        server_key: server_key.to_string(),
    });
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

    #[test]
    fn a_minted_token_verifies_and_a_forged_one_does_not() {
        let token = mint_token("secret", "room-1");
        let mut parts = token.rsplitn(3, '.');
        let (mac, expiry, room) = (
            parts.next().unwrap(),
            parts.next().unwrap().parse::<u64>().unwrap(),
            parts.next().unwrap(),
        );
        assert_eq!(room, "room-1");
        assert_eq!(sign("secret", room, expiry), mac);

        // Anyone can name a room and an expiry; without the key the mac is
        // what they cannot produce.
        assert_ne!(sign("other-key", room, expiry), mac);
        assert_ne!(sign("secret", "room-2", expiry), mac);
        assert_ne!(sign("secret", room, expiry + 1), mac);
    }

    /// The arithmetic above says a forged token fails to verify. This says the
    /// relay actually refuses the connection, which is the part that costs
    /// bandwidth if it is wrong.
    #[tokio::test]
    async fn the_relay_serves_a_room_that_has_a_token_and_nobody_else() {
        let server = spawn("0.0.0.0:0".parse().unwrap(), "secret")
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
            dial(Some(mint_token("secret", "room-1"))).await,
            "a room this process minted for is served"
        );
        assert!(
            !dial(None).await,
            "an endpoint with no token is not, or the relay is anyone's to spend"
        );
        assert!(
            !dial(Some(mint_token("another-server", "room-1"))).await,
            "and neither is one holding a token some other key signed"
        );

        let _ = server.shutdown().await;
    }

    #[test]
    fn a_token_carries_its_own_expiry() {
        let token = mint_token("secret", "room-1");
        let expiry: u64 = token.rsplitn(3, '.').nth(1).unwrap().parse().unwrap();
        assert!(expiry > now_secs());
        assert!(expiry <= now_secs() + TOKEN_TTL_SECS);
    }
}
