//! Shared "host the game loop for N players" routine.
//!
//! Both backends — Tauri (`src-tauri/src/engine_backend/rust_backend.rs`)
//! and WASM (`forge-wasm/src/wasm_api.rs`) — used to carry their own
//! near-identical copy of this dance: build the `GameState` from prepared
//! players, set up the `GameLoop`, register tokens, wire one agent per
//! seat, run the loop, emit a final per-player game-over view. Drift
//! between the two copies was a recurring problem (notably: WASM stayed
//! at 2 players long after Tauri went N-player).
//!
//! Everything backend-specific is funnelled through the closures —
//! transports (mpsc on Tauri, SharedArrayBuffer on WASM), token DB
//! source, final-view routing. The rules-engine plumbing in between
//! lives here exactly once.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use forge_agent_interface::game_view_dto::GameViewDto;
use forge_engine_core::agent::PlayerAgent;
use forge_engine_core::game::GameState;
use forge_engine_core::game_loop::GameLoop;
use forge_engine_core::ids::PlayerId;
use forge_engine_core::player::RegisteredPlayer;
use rand::rngs::StdRng;

use crate::deck::{instantiate_registered_players, PreparedRegisteredPlayer};

/// Hard cap on turns before the game loop bails, shared by every host
/// call site. A safety net against non-terminating board states, not a
/// real game-length limit — 5000 turns is far beyond any real game.
pub const DEFAULT_MAX_TURNS: u32 = 5000;

pub struct HostedGameOutcome {
    pub winner: Option<PlayerId>,
    pub aborted: bool,
}

/// Set up and run a multiplayer game with `prepared_players.len()` seats.
///
/// Closures, in call order:
/// - `register_tokens(loop)` — caller drops their token templates onto
///   the freshly constructed `GameLoop`. Tauri reads from the engine's
///   token DB plus a Scryfall image map; WASM reads from
///   `forge-wasm/src/card_loader.rs`. The shapes diverge enough that
///   keeping this in the caller is cleaner than abstracting it.
/// - `agent_factory(pid, is_local)` — builds the agent for seat `pid`.
///   `is_local == (pid.index() == engine_player_index)`. Tauri returns
///   a `PromptAgent` backed by `MpscTransport`; WASM returns one backed
///   by `WasmTransport` over the matching SAB.
/// - `on_game_over(pid, is_local, view)` — fires once per seat with the
///   final view rendered from that seat's perspective. Tauri sends it
///   over its mpsc tx; WASM writes it to that seat's SAB.
///
/// `rng` is owned by the caller so the runtime stays seedable from
/// outside — a future replay/parity mode can hand in a fixed-seed
/// `StdRng` instead of the `from_entropy()` both callers use today.
#[allow(clippy::too_many_arguments)]
pub fn run_hosted_multiplayer_game<F, G, H>(
    game_id: String,
    prepared_players: Vec<PreparedRegisteredPlayer>,
    engine_player_index: usize,
    abort_signal: Arc<AtomicBool>,
    max_turns: u32,
    rng: &mut StdRng,
    register_tokens: F,
    mut agent_factory: G,
    mut on_game_over: H,
) -> HostedGameOutcome
where
    F: FnOnce(&mut GameLoop),
    G: FnMut(PlayerId, bool) -> Box<dyn PlayerAgent>,
    H: FnMut(PlayerId, bool, GameViewDto),
{
    let num_players = prepared_players.len();
    let registered: Vec<RegisteredPlayer> = prepared_players
        .iter()
        .map(|p| p.registered.clone())
        .collect();
    let mut game = GameState::new_from_registered_players(&registered);
    instantiate_registered_players(&mut game, prepared_players);

    let mut game_loop = GameLoop::new(num_players);
    game_loop.set_abort_signal(abort_signal.clone());
    // The game log is ON by default for interactive sessions: when
    // FORGE_ENGINE_GAME_LOG is unset we force-enable it here. When it IS
    // set, we leave whatever `GameLog::enabled_from_env` decided —
    // i.e. set the var to "0"/"false"/"off" to disable logging, any
    // other value keeps it on. (Inverted from the usual "set to enable"
    // convention; pre-existing behavior copied from the Tauri/WASM
    // backends. Renaming to FORGE_ENGINE_GAME_LOG_DISABLE is a follow-up.)
    if std::env::var("FORGE_ENGINE_GAME_LOG").is_err() {
        game_loop.game_log.set_enabled(true);
    }
    game_loop.experimental_restore_snapshot =
        std::env::var("FORGE_ENGINE_RESTORE_SNAPSHOT").is_ok();

    register_tokens(&mut game_loop);

    let mut agents: Vec<Box<dyn PlayerAgent>> = Vec::with_capacity(num_players);
    for i in 0..num_players {
        let pid = PlayerId(i as u32);
        agents.push(agent_factory(pid, i == engine_player_index));
    }

    let winner = game_loop.run(&mut game, &mut agents, rng, max_turns);

    if abort_signal.load(Ordering::Relaxed) {
        return HostedGameOutcome {
            winner,
            aborted: true,
        };
    }

    for i in 0..num_players {
        let pid = PlayerId(i as u32);
        let view = GameViewDto::from_engine(&game, &game_loop.mana_pools, pid, &game_id, &[], &[]);
        on_game_over(pid, i == engine_player_index, view);
    }

    HostedGameOutcome {
        winner,
        aborted: false,
    }
}
