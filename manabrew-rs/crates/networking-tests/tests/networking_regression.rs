// System-wide networking regression suite: real relay + real hosted node +
// real websocket clients. Covers the failure modes that keep breaking —
// disconnects, room cleanup, and reconnects. Run explicitly (CI:
// build-checks `multiplayer-regression`, serialized with --test-threads=1):
//
//   cargo test -p networking-tests --test networking_regression -- --ignored --test-threads=1

mod support;

use std::time::{Duration, Instant};

use libtest_mimic::Arguments;
use support::{
    case, execute, list, scenario, spawn_guest_bot, summary, Case, Client, Sim, GRACE_DEADLINE,
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
            "creating_a_room_seats_the_creator",
            creating_a_room_seats_the_creator,
        ),
        case(
            "ghost_session_reaped_on_room_teardown",
            ghost_session_reaped_on_room_teardown,
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
