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

    let (host, mut seats) = NetEndpoint::bind(NetConfig::with_relay(&relay_url).unwrap())
        .await
        .expect("bind host");
    let mut guest_config = NetConfig::with_relay(&relay_url).unwrap();
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
