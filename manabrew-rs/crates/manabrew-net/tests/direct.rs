//! The direct data plane, end to end between two real iroh endpoints.
//!
//! Relays are disabled so a failure here is a failure of the direct path, not of
//! reachability to a third-party relay.

use std::time::Duration;

use manabrew_net::channel::TransportKind;
use manabrew_net::endpoint::{NetConfig, NetEndpoint};
use manabrew_net::roster::{to_transport_endpoint, Roster};
use manabrew_net::{NetError, SessionFrame};
use manabrew_relay_protocol::TransportMember;

const TOPIC_SECRET: &str = "3131313131313131313131313131313131313131313131313131313131313131";
const ROOM: &str = "room-under-test";

async fn bind() -> (
    NetEndpoint,
    tokio::sync::mpsc::Receiver<manabrew_net::SeatConnection>,
) {
    NetEndpoint::bind(NetConfig {
        secret_key: None,
        relay_mode: Some(iroh::RelayMode::Disabled),
    })
    .await
    .expect("bind endpoint")
}

fn member(endpoint: &NetEndpoint, username: &str, host: bool) -> TransportMember {
    TransportMember {
        username: username.to_string(),
        endpoint: to_transport_endpoint(&endpoint.endpoint().addr()),
        host,
    }
}

fn roster(members: &[TransportMember]) -> Roster {
    Roster::new(ROOM, TOPIC_SECRET, None, members).expect("roster")
}

#[tokio::test]
async fn attested_seat_gets_a_direct_channel() {
    let (host, mut seats) = bind().await;
    let (guest, _) = bind().await;

    let members = vec![member(&host, "hostess", true), member(&guest, "bob", false)];
    host.set_roster(roster(&members));
    guest.set_roster(roster(&members));

    let mut guest_channel = guest.connect_to_host("bob").await.expect("connect");
    let mut seat = tokio::time::timeout(Duration::from_secs(10), seats.recv())
        .await
        .expect("host accepted in time")
        .expect("seat");
    assert_eq!(seat.username, "bob");
    assert_eq!(seat.endpoint_id, guest.id());

    guest_channel
        .send(SessionFrame::Game {
            seq: 1,
            payload: serde_json::json!({ "kind": "response", "promptId": 3 }),
        })
        .await
        .unwrap();
    let received = seat
        .channel
        .recv_timeout(Duration::from_secs(5))
        .await
        .expect("host received the seat's frame");
    assert!(matches!(received, SessionFrame::Game { seq: 1, .. }));

    seat.channel
        .send(SessionFrame::Game {
            seq: 2,
            payload: serde_json::json!({ "kind": "state", "forPlayer": "player-1" }),
        })
        .await
        .unwrap();
    let received = guest_channel
        .recv_timeout(Duration::from_secs(5))
        .await
        .expect("seat received the host's frame");
    assert!(matches!(received, SessionFrame::Game { seq: 2, .. }));

    // No iroh relay is configured, so the only way this connected is a direct
    // path, and both ends are on this machine.
    let status = guest_channel.status();
    assert_eq!(status.kind, TransportKind::IrohDirect);
    assert!(status.connected);
    assert!(status.lan, "loopback and RFC1918 peers count as LAN");

    host.shutdown().await;
    guest.shutdown().await;
}

#[tokio::test]
async fn unattested_endpoint_is_refused() {
    let (host, _seats) = bind().await;
    let (mallory, _) = bind().await;

    // Mallory knows the host's endpoint id and the room id. She is not on the
    // relay's roster for the room, which is the whole check.
    let host_only = vec![member(&host, "hostess", true)];
    host.set_roster(roster(&host_only));

    let mut mallory_view = host_only.clone();
    mallory_view.push(member(&mallory, "mallory", false));
    mallory.set_roster(roster(&mallory_view));

    let err = mallory
        .connect_to_host("mallory")
        .await
        .expect_err("host must refuse an endpoint it was never told about");
    assert!(
        matches!(&err, NetError::Rejected(reason) if reason.contains("not in this room")),
        "unexpected error: {err}"
    );

    host.shutdown().await;
    mallory.shutdown().await;
}

#[tokio::test]
async fn endpoint_cannot_claim_another_players_name() {
    let (host, _seats) = bind().await;
    let (guest, _) = bind().await;

    let members = vec![member(&host, "hostess", true), member(&guest, "bob", false)];
    host.set_roster(roster(&members));
    guest.set_roster(roster(&members));

    let err = guest
        .connect_to_host("hostess")
        .await
        .expect_err("bob's endpoint must not be able to seat itself as hostess");
    assert!(
        matches!(&err, NetError::Rejected(reason) if reason.contains("different player")),
        "unexpected error: {err}"
    );

    host.shutdown().await;
    guest.shutdown().await;
}
