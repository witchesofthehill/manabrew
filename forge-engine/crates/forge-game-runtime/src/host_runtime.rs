//! Single source of truth for hosting an N-player game loop, shared by
//! the Tauri (mpsc) and WASM (SharedArrayBuffer) backends. Backend-specific
//! pieces — transports, token DB source, final-view routing — come in as
//! closures.
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

/// Turn cap before the loop bails — a non-termination safety net, not a
/// real game-length limit.
pub const DEFAULT_MAX_TURNS: u32 = 5000;

pub struct HostedGameOutcome {
    pub winner: Option<PlayerId>,
    pub aborted: bool,
}

/// Set up and run a multiplayer game with `prepared_players.len()` seats.
///
/// Closures fire in this order: `register_tokens` drops token templates
/// onto the fresh `GameLoop`; `agent_factory(pid, is_local)` builds each
/// seat's agent (`is_local == (pid.index() == engine_player_index)`);
/// `on_game_over(pid, is_local, view)` fires once per seat with the final
/// view from that seat's perspective.
///
/// `rng` is owned by the caller so the runtime stays seedable from the
/// outside (replay/parity), rather than `from_entropy`-ing internally.
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
    // Log is ON by default: unset force-enables here, otherwise
    // GameLog::enabled_from_env decides (set "0"/"false"/"off" to mute).
    // Inverted from the usual "set to enable" convention.
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
