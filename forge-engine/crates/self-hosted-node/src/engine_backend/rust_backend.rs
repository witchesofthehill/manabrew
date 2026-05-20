use std::collections::HashMap;
use std::env;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{mpsc as std_mpsc, Arc, Once, OnceLock};

use forge_agent_interface::agent_impl::PromptAgent;
use forge_agent_interface::deck_dto::Deck;
use forge_agent_interface::prompt::{AgentPrompt, PlayerAction};
use forge_bot::BotResponder;
use forge_carddb::CardDatabase;
use forge_engine_core::agent::PlayerAgent;
use forge_engine_core::ids::PlayerId;
use forge_game_runtime::deck::{
    deck_to_identities, force_commander_by_name, prepare_registered_player,
};
use forge_game_runtime::host_runtime::{
    register_tokens_from_db, run_hosted_multiplayer_game, DEFAULT_MAX_TURNS,
};
use forge_game_runtime::mpsc_transport::MpscTransport as NodeTransport;
use memmap2::Mmap;
use rand::SeedableRng;
use tracing::{info, warn};

use crate::config::workspace_root;

pub fn run_hosted_engine_game(
    game_id: String,
    player_names: Vec<String>,
    decks: Vec<Deck>,
    commander_names: Vec<Option<String>>,
    local_player_index: Option<usize>,
    starting_life: i32,
    remote_prompt_tx: std_mpsc::Sender<(usize, AgentPrompt)>,
    remote_response_rxs: Vec<(usize, std_mpsc::Receiver<PlayerAction>)>,
) {
    let num_players = player_names.len();
    let mut prepared_players = Vec::with_capacity(num_players);
    for i in 0..num_players {
        let identities = deck_to_identities(&decks[i]);
        let mut prepared =
            prepare_registered_player(player_names[i].clone(), get_card_db(), &identities);
        prepared.registered.starting_life = starting_life;
        if let Some(ref commander_name) = commander_names[i] {
            if !force_commander_by_name(&mut prepared, commander_name) {
                warn!(commander_name, "commander name not found in selected deck");
            }
        }
        prepared_players.push(prepared);
    }

    // The local seat (if any) is filled by an in-process AI; every other seat
    // is a networked player whose prompts/actions are relayed over the
    // WebSocket. Both are wired into the shared host runtime via the closures.
    let mut local_ai: Option<Box<dyn PlayerAgent>> = local_player_index.map(|player_index| {
        Box::new(PromptAgent::new(
            PlayerId(player_index as u32),
            game_id.clone(),
            BotResponder::default(),
        )) as Box<dyn PlayerAgent>
    });
    let mut remote_rx_map: HashMap<usize, std_mpsc::Receiver<PlayerAction>> =
        remote_response_rxs.into_iter().collect();
    let game_id_for_agents = game_id.clone();
    let remote_prompt_tx_for_agents = remote_prompt_tx.clone();

    let mut rng = rand::rngs::StdRng::from_entropy();
    let abort_signal = Arc::new(AtomicBool::new(false));
    run_hosted_multiplayer_game(
        prepared_players,
        abort_signal,
        DEFAULT_MAX_TURNS,
        &mut rng,
        |game_loop| register_tokens_from_db(game_loop, get_token_db()),
        |pid| {
            if Some(pid.index()) == local_player_index {
                local_ai
                    .take()
                    .expect("agent_factory called twice for the local seat")
            } else {
                let i = pid.index();
                let response_rx = remote_rx_map
                    .remove(&i)
                    .expect("missing remote response receiver");
                Box::new(PromptAgent::new(
                    pid,
                    game_id_for_agents.clone(),
                    NodeTransport::new_relay(i, remote_prompt_tx_for_agents.clone(), response_rx),
                ))
            }
        },
    );
}

/// Card and token databases come from a single rkyv archive bundle —
/// `src-tauri/build.rs` produces it, and the node panics with a clear hint
/// if it's missing (rather than silently degrading to an FS scan).
static CARD_DB: OnceLock<CardDatabase> = OnceLock::new();
static TOKEN_DB: OnceLock<CardDatabase> = OnceLock::new();
static DB_INIT: Once = Once::new();

fn ensure_dbs_loaded() {
    DB_INIT.call_once(|| {
        let archive_path = cardset_archive_path();
        info!(path = %archive_path.display(), "loading card + token databases from archive");
        let file = std::fs::File::open(&archive_path).unwrap_or_else(|e| {
            panic!(
                "Cardset archive not found at {}: {e}. Run `cargo build -p forge-web` (or `yarn build:wasm`) to build it.",
                archive_path.display()
            )
        });
        let mmap = unsafe { Mmap::map(&file).expect("mmap cardset archive") };
        let bundle =
            CardDatabase::load_from_archive(&mmap).expect("load cardset archive");
        info!(
            cards_loaded = bundle.cards_result.loaded,
            cards_failed = bundle.cards_result.failed,
            tokens_loaded = bundle.tokens_result.loaded,
            tokens_failed = bundle.tokens_result.failed,
            "loaded archive"
        );
        for (file, error) in bundle.tokens_result.errors.iter().take(10) {
            warn!(file, %error, "token parse error");
        }
        let _ = CARD_DB.set(bundle.cards);
        let _ = TOKEN_DB.set(bundle.tokens);
    });
}

fn get_card_db() -> &'static CardDatabase {
    ensure_dbs_loaded();
    CARD_DB.get().expect("card db must be initialized")
}

fn get_token_db() -> &'static CardDatabase {
    ensure_dbs_loaded();
    TOKEN_DB.get().expect("token db must be initialized")
}

fn cardset_archive_path() -> PathBuf {
    env::var("CARDSET_ARCHIVE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| workspace_root().join("src-tauri/resources/cardset.rkyv"))
}
