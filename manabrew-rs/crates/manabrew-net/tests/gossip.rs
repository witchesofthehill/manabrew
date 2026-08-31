//! The room topic across two real endpoints. Relays are disabled, so the peers
//! find each other only through the addresses the roster gave them.

use std::time::Duration;

use manabrew_net::endpoint::{NetConfig, NetEndpoint};
use manabrew_net::roster::{to_transport_endpoint, Roster};
use manabrew_net::RoomGossipEvent;
use manabrew_relay_protocol::TransportMember;

const TOPIC_SECRET: &str = "5555555555555555555555555555555555555555555555555555555555555555";
const ROOM: &str = "gossip-room";

async fn bind() -> NetEndpoint {
    NetEndpoint::bind(NetConfig {
        secret_key: None,
        relay_mode: Some(iroh::RelayMode::Disabled),
        relay_only: false,
    })
    .await
    .expect("bind endpoint")
    .0
}

fn member(endpoint: &NetEndpoint, username: &str, host: bool) -> TransportMember {
    TransportMember {
        username: username.to_string(),
        endpoint: to_transport_endpoint(&endpoint.endpoint().addr()),
        host,
    }
}

#[tokio::test]
async fn peers_learn_each_other_through_the_room_topic() {
    let host = bind().await;
    let guest = bind().await;

    let members = vec![member(&host, "hostess", true), member(&guest, "bob", false)];
    let roster =
        |members: &[TransportMember]| Roster::new(ROOM, TOPIC_SECRET, None, members).unwrap();
    host.set_roster(roster(&members));
    guest.set_roster(roster(&members));

    let mut host_gossip = host.join_room_gossip().await.expect("host joins topic");
    let guest_gossip = guest.join_room_gossip().await.expect("guest joins topic");

    // Bob re-announces on a timer, because a peer that joins the topic after a
    // broadcast would otherwise never see it.
    let presence = tokio::select! {
        presence = async {
            loop {
                if let Some(RoomGossipEvent::Presence(presence)) = host_gossip.next_event().await {
                    if presence.username == "bob" {
                        return presence;
                    }
                }
            }
        } => presence,
        _ = async {
            loop {
                let _ = guest_gossip.announce("bob", false).await;
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        } => unreachable!(),
        _ = tokio::time::sleep(Duration::from_secs(20)) => panic!("no presence from bob"),
    };

    assert_eq!(presence.username, "bob");
    assert_eq!(presence.endpoint_id, guest.id().to_string());
    assert!(!presence.host);
    assert_eq!(presence.room_id, ROOM);

    host.shutdown().await;
    guest.shutdown().await;
}
