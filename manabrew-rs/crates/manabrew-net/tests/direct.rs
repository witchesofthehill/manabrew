//! Two endpoints on the loopback, no relay: the admission check is the point.

use iroh::RelayMode;
use manabrew_net::{NetConfig, NetEndpoint, Roster, SessionFrame};
use manabrew_relay_protocol::{TransportEndpoint, TransportMember};

async fn bind() -> (
    NetEndpoint,
    tokio::sync::mpsc::Receiver<manabrew_net::SeatConnection>,
) {
    NetEndpoint::bind(NetConfig {
        relay_mode: Some(RelayMode::Disabled),
        ..Default::default()
    })
    .await
    .expect("bind")
}

fn member(username: &str, endpoint: TransportEndpoint, host: bool) -> TransportMember {
    TransportMember {
        username: username.to_string(),
        endpoint,
        host,
    }
}

#[tokio::test]
async fn an_attested_seat_reaches_the_host_and_a_stranger_does_not() {
    let (host, mut seats) = bind().await;
    let (seat, _) = bind().await;
    let (stranger, _) = bind().await;

    let roster = [
        member("host", host.local(), true),
        member("seat", seat.local(), false),
    ];
    host.set_roster(Roster::new("room-1", None, &roster));
    seat.set_roster(Roster::new("room-1", None, &roster));
    stranger.set_roster(Roster::new("room-1", None, &roster));

    let mut channel = seat.connect_to_host("seat").await.expect("seat connects");
    let accepted = seats.recv().await.expect("host accepts");
    assert_eq!(accepted.username, "seat");

    accepted
        .channel
        .send(SessionFrame::Game {
            seq: 1,
            payload: serde_json::json!({ "kind": "state" }),
        })
        .await
        .expect("host sends");
    assert!(matches!(
        channel.recv().await,
        Some(SessionFrame::Game { seq: 1, .. })
    ));

    // Not in the roster, so the endpoint id proves nothing.
    assert!(stranger.connect_to_host("seat").await.is_err());
}
