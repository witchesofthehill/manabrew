//! A seat that has no direct path at all still reaches the host.
//!
//! The guest drops its IP transports, which is the shape a browser endpoint has
//! whether it asks for it or not. So this covers the relay fallback and, at the
//! same time, the only connectivity a browser-hosted or browser-seated room can
//! ever have.

use std::time::Duration;

use manabrew_net::channel::TransportKind;
use manabrew_net::endpoint::{NetConfig, NetEndpoint};
use manabrew_net::roster::{to_transport_endpoint, Roster};
use manabrew_net::SessionFrame;
use manabrew_relay_protocol::TransportMember;

const TOPIC_SECRET: &str = "7777777777777777777777777777777777777777777777777777777777777777";
const ROOM: &str = "relayed-room";

/// A relay that admits only a known token, which is the shape the deployment's
/// own relay has. Anything binding against it without one gets no home relay.
#[derive(Debug)]
struct TokenOnly(&'static str);

impl iroh_relay::server::AccessControl for TokenOnly {
    async fn on_connect(
        &self,
        request: &iroh_relay::server::ClientRequest,
    ) -> iroh_relay::server::Access {
        match request.auth_token() {
            Some(token) if token == self.0 => iroh_relay::server::Access::Allow,
            _ => iroh_relay::server::Access::Deny {
                reason: Some("no token".to_string()),
            },
        }
    }
}

async fn spawn_gated_relay(token: &'static str) -> (iroh_relay::server::Server, String) {
    let mut relay = iroh_relay::server::RelayConfig::new(
        "127.0.0.1:0".parse::<std::net::SocketAddr>().unwrap(),
    );
    relay.access = std::sync::Arc::new(TokenOnly(token));
    let mut config = iroh_relay::server::ServerConfig::default();
    config.relay = Some(relay);
    let server = iroh_relay::server::Server::spawn(config)
        .await
        .expect("spawn relay");
    let addr = server.http_addr().expect("relay http addr");
    (server, format!("http://{addr}"))
}

/// The node and the bot are configured with a relay url and no token, because a
/// token only exists once the control plane has a room to mint it for. Binding
/// against the url is therefore not enough: the endpoint still advertises that
/// relay, so it looks configured, but nothing can reach it through one that
/// refuses it. Adopting the relay with the token is the path that works, and it
/// is the only path there is.
#[tokio::test]
async fn a_relay_url_is_not_enough_without_the_token_that_goes_with_it() {
    const TOKEN: &str = "room-1.9999999999.deadbeef";
    let (server, url) = spawn_gated_relay(TOKEN).await;

    let reach = |host_config: NetConfig, adopt: bool| {
        let url = url.clone();
        async move {
            let (host, _seats) = NetEndpoint::bind(host_config).await.expect("bind host");
            if adopt {
                host.adopt_relay(&url, Some(TOKEN)).await.expect("adopt");
            }
            host.wait_online(Duration::from_secs(6)).await;

            // A guest with no IP transports, which is what a browser seat is.
            let mut guest_config = NetConfig::with_relay(&url, Some(TOKEN)).unwrap();
            guest_config.relay_only = true;
            let (guest, _) = NetEndpoint::bind(guest_config).await.expect("bind guest");
            guest.wait_online(Duration::from_secs(6)).await;

            let members = vec![member(&host, "hostess", true), member(&guest, "bob", false)];
            let roster = |m: &[TransportMember]| Roster::new(ROOM, TOPIC_SECRET, None, m).unwrap();
            host.set_roster(roster(&members));
            guest.set_roster(roster(&members));

            let reached =
                tokio::time::timeout(Duration::from_secs(10), guest.connect_to_host("bob"))
                    .await
                    .is_ok_and(|r| r.is_ok());
            host.shutdown().await;
            guest.shutdown().await;
            reached
        }
    };

    assert!(
        !reach(NetConfig::with_relay(&url, None).unwrap(), false).await,
        "a host that bound against a gated relay with no token is reachable by nobody"
    );
    assert!(
        reach(NetConfig::default(), true).await,
        "adopting the relay with the token from RoomTransport is what makes it reachable"
    );

    let _ = server.shutdown().await;
}

async fn spawn_relay() -> (iroh_relay::server::Server, String) {
    let mut config = iroh_relay::server::ServerConfig::default();
    config.relay = Some(iroh_relay::server::RelayConfig::new(
        "127.0.0.1:0".parse::<std::net::SocketAddr>().unwrap(),
    ));
    let server = iroh_relay::server::Server::spawn(config)
        .await
        .expect("spawn relay");
    let addr = server.http_addr().expect("relay http addr");
    (server, format!("http://{addr}"))
}

fn member(endpoint: &NetEndpoint, username: &str, host: bool) -> TransportMember {
    TransportMember {
        username: username.to_string(),
        endpoint: to_transport_endpoint(&endpoint.endpoint().addr()),
        host,
    }
}

#[tokio::test]
async fn a_seat_with_no_direct_path_still_reaches_the_host() {
    let (relay, relay_url) = spawn_relay().await;

    let (host, mut seats) = NetEndpoint::bind(NetConfig::with_relay(&relay_url, None).unwrap())
        .await
        .expect("bind host");
    let mut guest_config = NetConfig::with_relay(&relay_url, None).unwrap();
    guest_config.relay_only = true;
    let (guest, _) = NetEndpoint::bind(guest_config).await.expect("bind guest");

    host.wait_online(Duration::from_secs(10)).await;
    guest.wait_online(Duration::from_secs(10)).await;

    let members = vec![member(&host, "hostess", true), member(&guest, "bob", false)];
    let roster = |m: &[TransportMember]| Roster::new(ROOM, TOPIC_SECRET, None, m).unwrap();
    host.set_roster(roster(&members));
    guest.set_roster(roster(&members));

    let guest_channel = guest.connect_to_host("bob").await.expect("connect");
    let mut seat = tokio::time::timeout(Duration::from_secs(15), seats.recv())
        .await
        .expect("host accepted in time")
        .expect("seat");
    assert_eq!(seat.username, "bob");

    guest_channel
        .send(SessionFrame::Game {
            seq: 1,
            payload: serde_json::json!({ "kind": "response", "promptId": 1 }),
        })
        .await
        .unwrap();
    assert!(matches!(
        seat.channel
            .recv_timeout(Duration::from_secs(10))
            .await
            .expect("host received the seat's frame"),
        SessionFrame::Game { seq: 1, .. }
    ));

    // The guest has no IP transport, so the only path it can possibly hold is
    // the one through the relay we just started.
    assert_eq!(guest_channel.status().kind, TransportKind::IrohRelayed);

    host.shutdown().await;
    guest.shutdown().await;
    let _ = relay.shutdown().await;
}

/// The production shape for a room hosted from somebody's desktop: the host
/// binds direct only, because it has no relay to be told about until it joins a
/// room, and then takes the one the control plane names. Without that a seat
/// that cannot reach it directly has no path to it at all.
#[tokio::test]
async fn a_host_that_bound_without_a_relay_can_adopt_one() {
    let (relay, relay_url) = spawn_relay().await;

    let (host, mut seats) = NetEndpoint::bind(NetConfig::default())
        .await
        .expect("bind host");
    assert!(
        !host.endpoint().addr().addrs.iter().any(|a| a.is_relay()),
        "the host starts with no relay to offer"
    );

    host.adopt_relay(&relay_url, None)
        .await
        .expect("adopt relay");
    host.wait_online(Duration::from_secs(10)).await;
    assert!(
        host.endpoint().addr().addrs.iter().any(|a| a.is_relay()),
        "after adopting, the address it announces carries a way to reach it"
    );

    let mut guest_config = NetConfig::with_relay(&relay_url, None).unwrap();
    guest_config.relay_only = true;
    let (guest, _) = NetEndpoint::bind(guest_config).await.expect("bind guest");
    guest.wait_online(Duration::from_secs(10)).await;

    let members = vec![member(&host, "hostess", true), member(&guest, "bob", false)];
    let roster = |m: &[TransportMember]| Roster::new(ROOM, TOPIC_SECRET, None, m).unwrap();
    host.set_roster(roster(&members));
    guest.set_roster(roster(&members));

    let guest_channel = guest.connect_to_host("bob").await.expect("connect");
    let seat = tokio::time::timeout(Duration::from_secs(15), seats.recv())
        .await
        .expect("host accepted in time")
        .expect("seat");
    assert_eq!(seat.username, "bob");
    assert_eq!(guest_channel.status().kind, TransportKind::IrohRelayed);

    host.shutdown().await;
    guest.shutdown().await;
    let _ = relay.shutdown().await;
}
