// System-wide networking regression suite: real relay + real hosted node +
// real websocket clients. Covers the failure modes that keep breaking —
// disconnects, room cleanup, and reconnects. Run explicitly (CI:
// build-checks `multiplayer-regression`, serialized with --test-threads=1):
//
//   cargo test -p networking-tests --test networking_regression -- --ignored --test-threads=1

mod support;

use std::time::{Duration, Instant};

/// Any release at or past the one that shipped `src/lib/stateDelta.ts`.
const CURRENT_CLIENT_VERSION: &str = "3.17.0";

use libtest_mimic::Arguments;
use manabrew_agent_interface::protocol::{identity_token, IdentityProof};
use serde_json::json;
use support::{
    case, execute, list, play_pair, scenario, spawn_guest_bot, step, summary, webrtc_endpoint,
    Case, Client, Manifest, Sim, GRACE_DEADLINE,
};

async fn brief_disconnect_reclaims_seat() {
    scenario(
        "a 2-player game in progress between a human and the node's bot.",
        "the human's socket drops and reconnects a few seconds later, within the grace window.",
        "the seat is reclaimed, resync resumes the same game, and no forfeit ever fires.",
    );
    let sim = Sim::spawn(9600).await;
    let mut alice = Client::connect(&sim.relay_url, "alice").await.unwrap();
    alice.join(&sim.room_id, false).await.unwrap();
    alice.spawn_node_bot(&sim.room_id).await.unwrap();
    alice.select_deck_and_ready().await.unwrap();
    alice.start_game(2).await.unwrap();
    alice.answer_prompts(2).await.unwrap();
    let game_id = alice.game_id.clone().unwrap();

    alice.vanish();
    tokio::time::sleep(Duration::from_secs(3)).await;

    let mut alice = Client::connect(&sim.relay_url, "alice").await.unwrap();
    alice.resync_expecting(&game_id).await.unwrap();
    alice.answer_prompts(1).await.unwrap();

    // Outlive the grace window to prove the disarmed forfeit never fires.
    tokio::time::sleep(GRACE_DEADLINE).await;
    sim.wait_room(
        Duration::from_secs(5),
        "room still in game with alice seated",
        |room| {
            room.is_some_and(|room| {
                room.status == manabrew_agent_interface::protocol::RoomStatus::InGame
                    && room
                        .players
                        .iter()
                        .any(|p| p.username == "alice" && p.connected)
            })
        },
    )
    .await;
    alice.answer_prompts(1).await.unwrap();
}

async fn vanished_seat_forfeits_and_game_continues() {
    scenario(
        "a 3-player game with two humans and the node's bot.",
        "one human vanishes and never returns.",
        "the relay forfeits that seat after the grace window and the game continues in-game for the survivor.",
    );
    let sim = Sim::spawn(9604).await;
    let mut alice = Client::connect(&sim.relay_url, "alice").await.unwrap();
    alice.join(&sim.room_id, false).await.unwrap();
    // Joins after alice so she stays the room controller.
    let bot = spawn_guest_bot(
        sim.relay_url.clone(),
        "steady-bob".into(),
        sim.room_id.clone(),
        Duration::from_millis(1500),
        false,
    );
    tokio::time::sleep(Duration::from_secs(2)).await;
    alice.spawn_node_bot(&sim.room_id).await.unwrap();
    alice.select_deck_and_ready().await.unwrap();
    alice.start_game(3).await.unwrap();
    alice.answer_prompts(2).await.unwrap();
    alice.vanish();

    sim.wait_room(
        GRACE_DEADLINE,
        "alice's seat forfeited, room still in game",
        |room| {
            room.is_some_and(|room| {
                room.status == manabrew_agent_interface::protocol::RoomStatus::InGame
                    && !room.players.iter().any(|p| p.username == "alice")
            })
        },
    )
    .await;
    bot.abort();
}

async fn last_human_leaving_ends_game_immediately() {
    scenario(
        "a 3-player game where the only human plays alongside two bots.",
        "the human explicitly leaves the room mid-game.",
        "the node ends the bots-only game immediately and the room is back in the lobby within seconds.",
    );
    let sim = Sim::spawn(9608).await;
    let bot = spawn_guest_bot(
        sim.relay_url.clone(),
        "slow-bot".into(),
        sim.room_id.clone(),
        Duration::from_secs(2),
        true,
    );
    tokio::time::sleep(Duration::from_secs(2)).await;

    let mut alice = Client::connect(&sim.relay_url, "alice").await.unwrap();
    alice.join(&sim.room_id, false).await.unwrap();
    alice.spawn_node_bot(&sim.room_id).await.unwrap();
    alice.select_deck_and_ready().await.unwrap();
    alice.start_game(3).await.unwrap();
    alice.answer_prompts(3).await.unwrap();
    alice.leave().await.unwrap();

    sim.wait_room(Duration::from_secs(15), "room reset to lobby", |room| {
        room.is_some_and(|room| {
            room.status == manabrew_agent_interface::protocol::RoomStatus::Lobby
        })
    })
    .await;
    bot.abort();
}

async fn abandoned_room_serves_a_fresh_game() {
    scenario(
        "a game whose room was just reset after abandonment.",
        "a fresh player joins the same room and starts a game.",
        "a new game with a new game_id serves prompts — the room is fully reusable.",
    );
    let sim = Sim::spawn(9612).await;
    let mut alice = Client::connect(&sim.relay_url, "alice").await.unwrap();
    alice.join(&sim.room_id, false).await.unwrap();
    alice.spawn_node_bot(&sim.room_id).await.unwrap();
    alice.select_deck_and_ready().await.unwrap();
    alice.start_game(2).await.unwrap();
    alice.answer_prompts(2).await.unwrap();
    let first_game = alice.game_id.clone().unwrap();
    alice.vanish();

    sim.wait_room(GRACE_DEADLINE, "room reset to lobby", |room| {
        room.is_some_and(|room| {
            room.status == manabrew_agent_interface::protocol::RoomStatus::Lobby
        })
    })
    .await;

    let mut carol = Client::connect(&sim.relay_url, "carol").await.unwrap();
    carol.join(&sim.room_id, false).await.unwrap();
    carol.spawn_node_bot(&sim.room_id).await.unwrap();
    carol.select_deck_and_ready().await.unwrap();
    carol.start_game(2).await.unwrap();
    carol.answer_prompts(2).await.unwrap();
    assert_ne!(carol.game_id.as_deref(), Some(first_game.as_str()));
}

async fn concede_watch_then_leave() {
    scenario(
        "a 3-player game where the human has conceded and stays connected, watching the bots.",
        "the spectating human leaves the room.",
        "the game keeps running while they watch, and ends within seconds of the leave.",
    );
    let sim = Sim::spawn(9616).await;
    let bot = spawn_guest_bot(
        sim.relay_url.clone(),
        "slow-bot".into(),
        sim.room_id.clone(),
        Duration::from_secs(2),
        true,
    );
    tokio::time::sleep(Duration::from_secs(2)).await;

    let mut alice = Client::connect(&sim.relay_url, "alice").await.unwrap();
    alice.join(&sim.room_id, false).await.unwrap();
    alice.spawn_node_bot(&sim.room_id).await.unwrap();
    alice.select_deck_and_ready().await.unwrap();
    alice.start_game(3).await.unwrap();
    alice.answer_prompts(2).await.unwrap();
    alice.concede().await.unwrap();

    // Spectate: the bots-vs-bot game must keep running while a human watches.
    tokio::time::sleep(Duration::from_secs(8)).await;
    sim.wait_room(
        Duration::from_secs(5),
        "game still running while spectating",
        |room| {
            room.is_some_and(|room| {
                room.status == manabrew_agent_interface::protocol::RoomStatus::InGame
            })
        },
    )
    .await;

    alice.leave().await.unwrap();
    sim.wait_room(
        Duration::from_secs(15),
        "room reset after spectator left",
        |room| {
            room.is_some_and(|room| {
                room.status == manabrew_agent_interface::protocol::RoomStatus::Lobby
            })
        },
    )
    .await;
    bot.abort();
}

async fn relay_restart_resumes_the_game() {
    scenario(
        "a 2-player game in progress.",
        "the relay process is killed and restarted (its memory wiped).",
        "the node resurrects the room under the same game_id and the reconnected human retakes their seat and plays on.",
    );
    let mut sim = Sim::spawn(9620).await;
    let mut alice = Client::connect(&sim.relay_url, "alice").await.unwrap();
    alice.join(&sim.room_id, false).await.unwrap();
    alice.spawn_node_bot(&sim.room_id).await.unwrap();
    alice.select_deck_and_ready().await.unwrap();
    alice.start_game(2).await.unwrap();
    alice.answer_prompts(2).await.unwrap();
    let game_id = alice.game_id.clone().unwrap();

    sim.restart_relay().await;

    let mut alice = Client::connect(&sim.relay_url, "alice").await.unwrap();
    alice.join_retry(&sim.room_id).await.unwrap();
    alice.resync_expecting(&game_id).await.unwrap();
    alice.answer_prompts(1).await.unwrap();
}

async fn relay_restart_forfeits_unreturned_seat() {
    scenario(
        "a resumed game after a relay restart, with one human back and one still absent.",
        "the absent human never reconnects.",
        "their resurrected seat forfeits after a fresh grace window and the game proceeds without them.",
    );
    let mut sim = Sim::spawn(9624).await;
    let bot = spawn_guest_bot(
        sim.relay_url.clone(),
        "gone-bob".into(),
        sim.room_id.clone(),
        Duration::from_millis(1500),
        true,
    );
    tokio::time::sleep(Duration::from_secs(2)).await;

    let mut alice = Client::connect(&sim.relay_url, "alice").await.unwrap();
    alice.join(&sim.room_id, false).await.unwrap();
    alice.spawn_node_bot(&sim.room_id).await.unwrap();
    alice.select_deck_and_ready().await.unwrap();
    alice.start_game(3).await.unwrap();
    alice.answer_prompts(2).await.unwrap();
    let game_id = alice.game_id.clone().unwrap();

    // gone-bob dies before the restart: his old forfeit timer dies with the
    // relay process, so only the resurrection path can reclaim his seat —
    // aborting after the restart would race his reconnect backoff.
    bot.abort();
    sim.restart_relay().await;

    let mut alice = Client::connect(&sim.relay_url, "alice").await.unwrap();
    alice.join_retry(&sim.room_id).await.unwrap();
    alice.resync_expecting(&game_id).await.unwrap();

    sim.wait_room(
        GRACE_DEADLINE,
        "gone-bob's resurrected seat forfeited",
        |room| room.is_some_and(|room| !room.players.iter().any(|p| p.username == "gone-bob")),
    )
    .await;
}

async fn dead_node_room_is_reclaimed() {
    scenario(
        "a hosted in-game room.",
        "the node process dies and never resumes.",
        "the relay reclaims the room after the host-resume window — it disappears from the lobby.",
    );
    let mut sim = Sim::spawn(9628).await;
    let mut alice = Client::connect(&sim.relay_url, "alice").await.unwrap();
    alice.join(&sim.room_id, false).await.unwrap();
    alice.spawn_node_bot(&sim.room_id).await.unwrap();
    alice.select_deck_and_ready().await.unwrap();
    alice.start_game(2).await.unwrap();
    alice.answer_prompts(2).await.unwrap();

    sim.kill_node();

    sim.wait_room(GRACE_DEADLINE, "room removed after host loss", |room| {
        room.is_none()
    })
    .await;
}

async fn creating_a_room_seats_the_creator() {
    scenario(
        "a player creating a room from the lobby.",
        "the relay acknowledges the creation.",
        "the create response itself carries the room with the creator seated — no join round-trip.",
    );
    let sim = Sim::spawn_relay_only(9636).await;
    let mut alice = Client::connect(&sim.relay_url, "alice").await.unwrap();
    alice.create_room("Alice's table").await.unwrap();
    let room = alice.wait_own_room().await.unwrap();
    assert!(
        room.players
            .iter()
            .any(|p| p.username == "alice" && p.connected),
        "creator must be seated in the create response"
    );
}

async fn proven_owner_takes_over_its_live_session() {
    scenario(
        "a player seated in a room from one device, with a live socket the relay still sees as connected.",
        "the same player connects again with the same device proof, and a stranger connects with a different one.",
        "the owner takes the seat over (the old socket is signed out) while the stranger is still refused.",
    );
    let mut sim = Sim::spawn_relay_only(9644).await;
    let device = "alice-device-secret-0001";
    let mut alice = Client::connect_as(&sim.relay_url, "alice", Some(device))
        .await
        .unwrap();
    alice.create_room("Alice's table").await.unwrap();
    sim.room_id = alice.wait_own_room().await.unwrap().room_id;

    let stranger =
        Client::connect_as(&sim.relay_url, "alice", Some("someone-else-secret-01")).await;
    assert!(
        stranger.is_err(),
        "a different device must not take the username"
    );

    let _second_tab = Client::connect_as(&sim.relay_url, "alice", Some(device))
        .await
        .unwrap();
    alice.expect_session_taken_over().await.unwrap();

    sim.wait_room(
        Duration::from_secs(10),
        "alice still seated on the new socket",
        |room| {
            room.is_some_and(|room| {
                room.players
                    .iter()
                    .any(|p| p.username == "alice" && p.connected)
            })
        },
    )
    .await;
}

async fn token_handle_names_the_session() {
    scenario(
        "a client whose stored preferences name went stale while its identity token carries the real handle (the signed-in-reload shape that broke lobby controls).",
        "it authenticates sending the stale legacy username alongside a self-minted token whose handle differs, then creates a room.",
        "the session and its seat are named by the token handle everywhere, and the stale legacy name exists nowhere on the relay.",
    );
    let sim = Sim::spawn_relay_only(9648).await;
    let iat = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let token = identity_token::mint_unsigned("self:test", "real-handle", iat, 600);
    let mut player = Client::connect_with_proof(
        &sim.relay_url,
        "stale-prefs-name",
        "real-handle",
        Some(IdentityProof {
            token: Some(token),
            device: None,
        }),
    )
    .await
    .unwrap();

    player.create_room("Renamed table").await.unwrap();
    let room = player.wait_own_room().await.unwrap();

    assert!(
        room.players
            .iter()
            .any(|p| p.username == "real-handle" && p.connected),
        "the seat must carry the token handle, got {:?}",
        room.players
            .iter()
            .map(|p| p.username.as_str())
            .collect::<Vec<_>>()
    );
    let players = sim.players().await;
    assert!(
        players.iter().any(|p| p.username == "real-handle"),
        "the session must be listed under the token handle"
    );
    assert!(
        !players.iter().any(|p| p.username == "stale-prefs-name")
            && !room
                .players
                .iter()
                .any(|p| p.username == "stale-prefs-name"),
        "the stale legacy username must not exist anywhere"
    );
}

async fn ghost_session_reaped_on_room_teardown() {
    scenario(
        "an in-game room where one player vanished (session preserved for reconnect) and one survivor remains.",
        "the survivor leaves, tearing the room down before the vanished player's forfeit fires.",
        "the vanished player's session is removed with the room — no eternal grey ghost — while the leaver's live session survives.",
    );
    let mut sim = Sim::spawn_relay_only(9640).await;
    let mut alice = Client::connect(&sim.relay_url, "alice").await.unwrap();
    alice.create_room("Ghost table").await.unwrap();
    sim.room_id = alice.wait_own_room().await.unwrap().room_id;

    let mut bob = Client::connect(&sim.relay_url, "ghost-bob").await.unwrap();
    bob.join(&sim.room_id, false).await.unwrap();
    bob.select_deck_and_ready().await.unwrap();
    alice.select_deck_and_ready().await.unwrap();
    alice.start_game(2).await.unwrap();

    bob.vanish();
    tokio::time::sleep(Duration::from_secs(2)).await;
    alice.leave().await.unwrap();

    sim.wait_room(Duration::from_secs(10), "room torn down", |room| {
        room.is_none()
    })
    .await;
    let players = sim.players().await;
    assert!(
        !players.iter().any(|p| p.username == "ghost-bob"),
        "ghost-bob's dead session must be reaped with the room"
    );
    assert!(
        players.iter().any(|p| p.username == "alice" && p.connected),
        "alice's live session must survive the teardown"
    );
}

async fn empty_lobby_room_is_removed() {
    scenario(
        "a player-created lobby room that never starts a game.",
        "its only member leaves.",
        "the room is removed from the lobby list immediately.",
    );
    let mut sim = Sim::spawn_relay_only(9632).await;
    let mut alice = Client::connect(&sim.relay_url, "alice").await.unwrap();
    alice
        .create_room("Alice's table")
        .await
        .expect("create room");
    sim.room_id = alice.wait_own_room().await.expect("room created").room_id;

    sim.wait_room(Duration::from_secs(10), "room listed", |room| {
        room.is_some()
    })
    .await;
    alice.leave().await.unwrap();
    sim.wait_room(
        Duration::from_secs(10),
        "room removed after last leave",
        |room| room.is_none(),
    )
    .await;
}

async fn current_clients_are_sent_state_patches() {
    scenario(
        "a 2-player game where the human reports a client new enough to apply state patches.",
        "the node sends its per-seat board updates, which it now patches by default.",
        "the patches reach that seat as `stateDelta`, saving the full board on every update.",
    );
    let sim = Sim::spawn(9636).await;
    let mut alice = Client::connect_versioned(&sim.relay_url, "alice", CURRENT_CLIENT_VERSION)
        .await
        .unwrap();
    alice.join(&sim.room_id, false).await.unwrap();
    alice.spawn_node_bot(&sim.room_id).await.unwrap();
    alice.select_deck_and_ready().await.unwrap();
    alice.start_game(2).await.unwrap();
    alice.answer_prompts(4).await.unwrap();

    assert!(
        alice.saw_envelope_kind("stateDelta"),
        "a current client never received a patch — is the node still sending full states?",
    );
}

async fn old_clients_are_sent_whole_boards() {
    scenario(
        "the same game, but the human's client is old enough that it reports no version at all.",
        "the node sends the same patched board updates.",
        "the relay expands every patch back into a full `state`, so that seat never sees one.",
    );
    let sim = Sim::spawn(9640).await;
    // No reported version is how every client built before the applier looks.
    let mut alice = Client::connect(&sim.relay_url, "alice").await.unwrap();
    alice.join(&sim.room_id, false).await.unwrap();
    alice.spawn_node_bot(&sim.room_id).await.unwrap();
    alice.select_deck_and_ready().await.unwrap();
    alice.start_game(2).await.unwrap();
    alice.answer_prompts(4).await.unwrap();

    assert!(
        !alice.saw_envelope_kind("stateDelta"),
        "an old client was sent a patch it cannot apply — its board would have frozen here",
    );
    assert!(
        alice.saw_envelope_kind("state"),
        "the old client received no board at all, so the test proves nothing",
    );
}

async fn bot_seats_never_make_the_relay_fold_a_patch() {
    scenario(
        "a hosted 2-player game: a current human, and the node's bot seat, which authenticates as a service with no client version.",
        "the node sends its patched board updates, per seat and to the bot.",
        "the relay expands none of them. Until 2026-09-11 the bot seat failed the version check like a stale install, so every patch addressed to it and every broadcast in its room went out as a full board: ~40 KB per decision to each human on a four-seat table, and the node sent its own bots' boards back.",
    );
    let sim = Sim::spawn(9680).await;
    let mut alice = Client::connect_versioned(&sim.relay_url, "alice", CURRENT_CLIENT_VERSION)
        .await
        .unwrap();
    alice.join(&sim.room_id, false).await.unwrap();
    alice.spawn_node_bot(&sim.room_id).await.unwrap();
    alice.select_deck_and_ready().await.unwrap();
    alice.start_game(2).await.unwrap();
    alice.answer_prompts(6).await.unwrap();

    assert!(
        alice.saw_envelope_kind("stateDelta"),
        "the human was sent no patch at all, so the counter below proves nothing",
    );
    let folded = sim
        .metric("manabrew_relay_state_patch_downgrades_total")
        .await;
    assert_eq!(
        folded, 0.0,
        "the relay expanded {folded} patches into full boards in a room whose only non-current seat is a bot",
    );
}

async fn old_clients_get_whole_boards_without_costing_the_current_ones_theirs() {
    scenario(
        "a hosted game with two humans: one current, one old enough to report no version.",
        "the node sends patched board updates to both.",
        "each seat is sent the shape it can take: the old client whole boards and never a patch, the current one patches, and the relay's fold counter moves only for the old seat.",
    );
    let sim = Sim::spawn(9684).await;
    let mut alice = Client::connect_versioned(&sim.relay_url, "alice", CURRENT_CLIENT_VERSION)
        .await
        .unwrap();
    let mut bob = Client::connect(&sim.relay_url, "bob").await.unwrap();
    alice.join(&sim.room_id, false).await.unwrap();
    bob.join(&sim.room_id, false).await.unwrap();
    alice.spawn_node_bot(&sim.room_id).await.unwrap();
    alice.select_deck_and_ready().await.unwrap();
    bob.select_deck_and_ready().await.unwrap();
    alice.start_game(3).await.unwrap();
    bob.await_game_started().await.unwrap();
    play_pair(&mut alice, &mut bob, 8).await.unwrap();

    assert!(
        !bob.saw_envelope_kind("stateDelta"),
        "the old client was sent a patch it cannot apply; its board would have frozen here",
    );
    assert!(
        bob.saw_envelope_kind("state"),
        "the old client received no board at all, so the test proves nothing",
    );
    assert!(
        alice.saw_envelope_kind("stateDelta"),
        "the current client lost its patches to the old seat in the same room",
    );
    let folded = sim
        .metric("manabrew_relay_state_patch_downgrades_total")
        .await;
    assert!(
        folded > 0.0,
        "the old seat was sent boards the relay never counted as folded",
    );
}

async fn publishing_a_release_never_ends_a_live_game() {
    scenario(
        "a node armed to auto-update, hosting a game between a human and its bot.",
        "a newer node build is published while that game is still being played.",
        "the node drains instead of exiting: the game plays on, and the node only leaves once its room is back in the lobby.",
    );
    let manifest = Manifest::serve(9654).await;
    let mut sim = Sim::spawn_updating(9652, &manifest.url()).await;
    let mut alice = Client::connect(&sim.relay_url, "alice").await.unwrap();
    alice.join(&sim.room_id, false).await.unwrap();
    alice.spawn_node_bot(&sim.room_id).await.unwrap();
    alice.select_deck_and_ready().await.unwrap();
    alice.start_game(2).await.unwrap();
    alice.answer_prompts(2).await.unwrap();

    manifest.publish();
    // Well past the 2s poll and the 10s shutdown grace behind it.
    tokio::time::sleep(Duration::from_secs(20)).await;
    assert!(
        sim.node_running(),
        "the node exited on top of a live game — every player in it would have been dropped",
    );
    alice.answer_prompts(2).await.unwrap();

    alice.leave().await.unwrap();
    sim.wait_node_exit(Duration::from_secs(60)).await;
}

async fn direct_transport_fails_closed_without_the_flag() {
    scenario(
        "a relay started without MANABREW_DIRECT_TRANSPORT, and a seat that opted in.",
        "the seat announces an endpoint and signals a room-mate.",
        "the relay advertises neither feature, names no host, and forwards nothing.",
    );
    let sim = Sim::spawn_relay_only(9660).await;
    let mut alice = Client::connect(&sim.relay_url, "alice").await.unwrap();
    assert!(
        !alice
            .features
            .iter()
            .any(|f| f == "room_transport" || f == "peer_signal"),
        "an opt-out relay must not advertise the plane: {:?}",
        alice.features
    );
    alice.create_room("Relay only").await.unwrap();
    let room = alice.wait_own_room().await.unwrap();
    let mut bob = Client::connect(&sim.relay_url, "bob").await.unwrap();
    bob.join(&room.room_id, false).await.unwrap();

    alice
        .announce(Some(webrtc_endpoint("alice")))
        .await
        .unwrap();
    alice
        .signal_peer("bob", json!({ "sdp": { "type": "offer", "sdp": "v=0" } }))
        .await
        .unwrap();

    let hosts = alice.roster_hosts_within(Duration::from_secs(3)).await;
    assert!(
        hosts.is_empty(),
        "no roster at all off this relay, got {hosts:?}"
    );
    bob.expect_no_peer_signal(Duration::from_secs(2))
        .await
        .unwrap();
    assert_eq!(
        sim.metric(r#"manabrew_relay_transport_announcements_total{kind="rejected"}"#)
            .await,
        1.0,
        "the announcement is refused, silently"
    );
    assert_eq!(
        sim.metric(r#"manabrew_relay_peer_signals_total{kind="disabled"}"#)
            .await,
        1.0,
        "the signal is dropped, and the counter is where it shows"
    );
}

async fn signalling_is_routed_by_the_relay_and_stamped_with_the_sender() {
    scenario(
        "a relay with the direct transport on, and two seats in one room.",
        "each signals the other by name; one signals a stranger; one sends a blob too big.",
        "each blob reaches the named peer stamped `from` the relay's own record; the rest reach nobody.",
    );
    let sim = Sim::spawn_relay_only_direct(9664).await;
    let mut alice = Client::connect(&sim.relay_url, "alice").await.unwrap();
    assert!(
        alice.features.iter().any(|f| f == "peer_signal"),
        "the relay advertises signalling: {:?}",
        alice.features
    );
    alice.create_room("Signalling").await.unwrap();
    let room = alice.wait_own_room().await.unwrap();
    let mut bob = Client::connect(&sim.relay_url, "bob").await.unwrap();
    // A signal sent before the relay registers bob is dropped as `no_target`.
    bob.join_retry(&room.room_id).await.unwrap();

    let offer = json!({ "sdp": { "type": "offer", "sdp": "v=0 alice" } });
    alice.signal_peer("bob", offer.clone()).await.unwrap();
    let (from, payload) = bob
        .expect_peer_signal(Duration::from_secs(5))
        .await
        .unwrap();
    assert_eq!(
        from, "alice",
        "the sender is the relay's word, not the message's"
    );
    assert_eq!(payload, offer, "the relay does not read or alter the blob");

    let answer = json!({ "sdp": { "type": "answer", "sdp": "v=0 bob" } });
    bob.signal_peer("alice", answer.clone()).await.unwrap();
    let (from, payload) = alice
        .expect_peer_signal(Duration::from_secs(5))
        .await
        .unwrap();
    assert_eq!((from.as_str(), payload), ("bob", answer));

    step("alice signals somebody who is not in the room, then sends bob 20kB");
    alice
        .signal_peer("nobody", json!({ "ice": {} }))
        .await
        .unwrap();
    alice
        .signal_peer("bob", json!({ "sdp": "x".repeat(20 * 1024) }))
        .await
        .unwrap();
    bob.expect_no_peer_signal(Duration::from_secs(2))
        .await
        .unwrap();

    assert_eq!(
        sim.metric(r#"manabrew_relay_peer_signals_total{kind="forwarded"}"#)
            .await,
        2.0
    );
    assert_eq!(
        sim.metric(r#"manabrew_relay_peer_signals_total{kind="no_target"}"#)
            .await,
        1.0
    );
    assert_eq!(
        sim.metric(r#"manabrew_relay_peer_signals_total{kind="oversize"}"#)
            .await,
        1.0
    );
}

async fn a_room_stays_on_the_relay_until_every_seat_opts_in() {
    scenario(
        "a relay with the direct transport on and two human seats: one opted in, one not.",
        "the opted-in seat announces its endpoint.",
        "the relay broadcasts a roster but names no host to dial, so the whole room stays on the relay.",
    );
    let sim = Sim::spawn_relay_only_direct(9676).await;
    let mut alice = Client::connect(&sim.relay_url, "alice").await.unwrap();
    alice.create_room("Consent").await.unwrap();
    let room = alice.wait_own_room().await.unwrap();
    // bob never announces; the relay must register him before alice announces.
    let mut bob = Client::connect(&sim.relay_url, "bob").await.unwrap();
    bob.join_retry(&room.room_id).await.unwrap();

    alice
        .announce(Some(webrtc_endpoint("alice")))
        .await
        .unwrap();
    let hosts = alice.roster_hosts_within(Duration::from_secs(3)).await;
    assert!(
        !hosts.is_empty() && hosts.iter().all(Option::is_none),
        "the roster went out, and named nobody to dial: {hosts:?}"
    );
    assert!(
        sim.metric(r#"manabrew_relay_transport_rosters_total{kind="withheld"}"#)
            .await
            >= 1.0,
        "the withheld roster is where consent enforcement shows"
    );
}

fn main() {
    let args = Arguments::from_args();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("failed to build tokio runtime");
    let handle = runtime.handle().clone();

    let cases: Vec<Case> = vec![
        case(
            "brief_disconnect_reclaims_seat",
            brief_disconnect_reclaims_seat,
        ),
        case(
            "vanished_seat_forfeits_and_game_continues",
            vanished_seat_forfeits_and_game_continues,
        ),
        case(
            "last_human_leaving_ends_game_immediately",
            last_human_leaving_ends_game_immediately,
        ),
        case(
            "abandoned_room_serves_a_fresh_game",
            abandoned_room_serves_a_fresh_game,
        ),
        case("concede_watch_then_leave", concede_watch_then_leave),
        case(
            "relay_restart_resumes_the_game",
            relay_restart_resumes_the_game,
        ),
        case(
            "relay_restart_forfeits_unreturned_seat",
            relay_restart_forfeits_unreturned_seat,
        ),
        case("dead_node_room_is_reclaimed", dead_node_room_is_reclaimed),
        case("empty_lobby_room_is_removed", empty_lobby_room_is_removed),
        case(
            "current_clients_are_sent_state_patches",
            current_clients_are_sent_state_patches,
        ),
        case(
            "old_clients_are_sent_whole_boards",
            old_clients_are_sent_whole_boards,
        ),
        case(
            "creating_a_room_seats_the_creator",
            creating_a_room_seats_the_creator,
        ),
        case(
            "proven_owner_takes_over_its_live_session",
            proven_owner_takes_over_its_live_session,
        ),
        case(
            "token_handle_names_the_session",
            token_handle_names_the_session,
        ),
        case(
            "ghost_session_reaped_on_room_teardown",
            ghost_session_reaped_on_room_teardown,
        ),
        case(
            "bot_seats_never_make_the_relay_fold_a_patch",
            bot_seats_never_make_the_relay_fold_a_patch,
        ),
        case(
            "old_clients_get_whole_boards_without_costing_the_current_ones_theirs",
            old_clients_get_whole_boards_without_costing_the_current_ones_theirs,
        ),
        case(
            "publishing_a_release_never_ends_a_live_game",
            publishing_a_release_never_ends_a_live_game,
        ),
        case(
            "direct_transport_fails_closed_without_the_flag",
            direct_transport_fails_closed_without_the_flag,
        ),
        case(
            "signalling_is_routed_by_the_relay_and_stamped_with_the_sender",
            signalling_is_routed_by_the_relay_and_stamped_with_the_sender,
        ),
        case(
            "a_room_stays_on_the_relay_until_every_seat_opts_in",
            a_room_stays_on_the_relay_until_every_seat_opts_in,
        ),
    ];

    if args.list {
        list(&args, &cases);
        std::process::exit(0);
    }

    let total = Instant::now();
    let (passed, failed, skipped) = execute(&args, &handle, cases);
    summary(passed, failed, skipped, total.elapsed());
    std::process::exit(if failed == 0 { 0 } else { 1 });
}
