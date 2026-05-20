use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use forge_carddb::CardDatabase;
use forge_engine_core::agent::notification::GameNotification;
use forge_engine_core::agent::PlayerAgent;
use forge_engine_core::game::GameState;
use forge_engine_core::game_loop::GameLoop;
use forge_engine_core::ids::PlayerId;
use forge_engine_core::player::RegisteredPlayer;
use rand::rngs::StdRng;

use crate::deck::{
    card_rules_to_instance, instantiate_registered_players, PreparedRegisteredPlayer,
};

pub const DEFAULT_MAX_TURNS: u32 = 5000;

pub fn register_tokens_from_db(game_loop: &mut GameLoop, token_db: &CardDatabase) {
    for (script_name, rules) in token_db.iter() {
        let template = card_rules_to_instance(rules, PlayerId(0));
        game_loop.register_token(script_name, template);
    }
}

pub struct HostedGameOutcome {
    pub winner: Option<PlayerId>,
    pub aborted: bool,
}
pub fn run_hosted_multiplayer_game<F, G>(
    prepared_players: Vec<PreparedRegisteredPlayer>,
    abort_signal: Arc<AtomicBool>,
    max_turns: u32,
    rng: &mut StdRng,
    register_tokens: F,
    mut agent_factory: G,
) -> HostedGameOutcome
where
    F: FnOnce(&mut GameLoop),
    G: FnMut(PlayerId) -> Box<dyn PlayerAgent>,
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
        agents.push(agent_factory(PlayerId(i as u32)));
    }

    let winner = game_loop.run(&mut game, &mut agents, rng, max_turns);

    if abort_signal.load(Ordering::Relaxed) {
        return HostedGameOutcome {
            winner,
            aborted: true,
        };
    }

    for agent in agents.iter_mut() {
        agent.snapshot_state(&game, &game_loop.mana_pools);
        agent.notify(GameNotification::GameOver);
    }

    HostedGameOutcome {
        winner,
        aborted: false,
    }
}
