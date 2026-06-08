use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::mpsc;
use std::sync::Arc;

use forge_agent_interface::agent_impl::PromptAgent;
use forge_agent_interface::game_log_event::GameLogEntryDto;
use forge_agent_interface::game_snapshot_event::GameSnapshotEventDto;
use forge_agent_interface::prompt::{AgentMessage, PlayerAction};
use forge_bot::BotResponder;
use forge_engine_core::agent::PlayerAgent;
use forge_engine_core::ids::PlayerId;
use forge_game_runtime::deck::force_commander_by_name;
use forge_game_runtime::host_runtime::{run_hosted_multiplayer_game, DEFAULT_MAX_TURNS};
use rand::SeedableRng;

use crate::card_db::{card_rules_to_instance, get_token_db, get_token_image_map};
use crate::preset_decks::{
    is_preset_id, prepare_custom_registered_player, prepare_preset_registered_player, CardIdentity,
};
use crate::tauri_transport::TauriTransport;

pub fn run_game(
    game_id: String,
    deck_list: Vec<CardIdentity>,
    starting_life: i32,
    commander_name: Option<String>,
    opponent_deck_list: Option<Vec<CardIdentity>>,
    prompt_tx: mpsc::Sender<AgentMessage>,
    response_rx: mpsc::Receiver<PlayerAction>,
    notify_tx: mpsc::Sender<GameLogEntryDto>,
    snapshot_tx: mpsc::Sender<GameSnapshotEventDto>,
    abort_signal: Arc<AtomicBool>,
) {
    let mut human = if deck_list.len() == 1 && is_preset_id(&deck_list[0].name) {
        prepare_preset_registered_player("You", &deck_list[0].name)
    } else {
        prepare_custom_registered_player("You", &deck_list)
    };
    human.registered.starting_life = starting_life;
    if let Some(ref name) = commander_name {
        force_commander_by_name(&mut human, name);
    }

    // The UI is responsible for picking the opponent deck explicitly. There
    // is no auto-inference (preset.opponent field) or random AI fallback —
    // both legacy paths produced confusing surprise decks.
    let opp_deck = match opponent_deck_list {
        Some(d) if !d.is_empty() => d,
        _ => {
            eprintln!(
                "[rust_backend] start_game called without an opponent deck; refusing to start"
            );
            return;
        }
    };
    let mut opponent = if opp_deck.len() == 1 && is_preset_id(&opp_deck[0].name) {
        prepare_preset_registered_player("AI Opponent", &opp_deck[0].name)
    } else {
        prepare_custom_registered_player("AI Opponent", &opp_deck)
    };
    opponent.registered.starting_life = starting_life;

    let prepared_players = vec![human, opponent];

    let p0 = PlayerId(0);
    // The human seat owns the channels passed in from the command layer, so
    // its agent is built up front and handed to the factory via this slot.
    let mut human_agent_slot: Option<Box<dyn PlayerAgent>> = Some(Box::new(PromptAgent::new(
        p0,
        game_id.clone(),
        TauriTransport::new_local(prompt_tx.clone(), response_rx, notify_tx, snapshot_tx),
    )));
    let game_id_for_agents = game_id.clone();

    let mut rng = rand::rngs::StdRng::from_entropy();
    run_hosted_multiplayer_game(
        prepared_players,
        abort_signal,
        DEFAULT_MAX_TURNS,
        &mut rng,
        |game_loop| {
            // Token templates use a placeholder owner (p0); the real
            // owner/controller is set at creation time. Set code + collector
            // number come from the edition files for image lookup.
            let token_db = get_token_db();
            let token_image_map = get_token_image_map();
            for (script_name, rules) in token_db.iter() {
                let mut template = card_rules_to_instance(rules, p0);
                if let Some(info) = token_image_map.get(&script_name) {
                    template.set_code = Some(info.set_code.clone());
                    template.card_number = Some(info.collector_number.clone());
                }
                game_loop.register_token(script_name, template);
            }
        },
        |pid| {
            if pid == p0 {
                human_agent_slot
                    .take()
                    .expect("agent_factory called twice for the local seat")
            } else {
                Box::new(PromptAgent::new(
                    pid,
                    game_id_for_agents.clone(),
                    BotResponder::default(),
                ))
            }
        },
    );
}

pub fn run_multiplayer_game(
    game_id: String,
    player_names: Vec<String>,
    deck_lists: Vec<Vec<CardIdentity>>,
    commander_names: Vec<Option<String>>,
    engine_player_index: usize,
    starting_life: i32,
    engine_prompt_tx: mpsc::Sender<AgentMessage>,
    engine_response_rx: mpsc::Receiver<PlayerAction>,
    engine_notify_tx: mpsc::Sender<GameLogEntryDto>,
    engine_snapshot_tx: mpsc::Sender<GameSnapshotEventDto>,
    remote_prompt_tx: mpsc::Sender<(usize, AgentMessage)>,
    remote_response_rxs: Vec<(usize, mpsc::Receiver<PlayerAction>)>,
    abort_signal: Arc<AtomicBool>,
) {
    let num_players = player_names.len();
    let mut prepared_players = Vec::with_capacity(num_players);
    for i in 0..num_players {
        let mut prepared = if deck_lists[i].len() == 1 && is_preset_id(&deck_lists[i][0].name) {
            prepare_preset_registered_player(player_names[i].clone(), &deck_lists[i][0].name)
        } else {
            prepare_custom_registered_player(player_names[i].clone(), &deck_lists[i])
        };
        prepared.registered.starting_life = starting_life;
        // Commander comes from the lobby out-of-band, not the deck pile.
        if let Some(ref commander_name) = commander_names[i] {
            force_commander_by_name(&mut prepared, commander_name);
        }
        prepared_players.push(prepared);
    }

    // Option so the agent_factory can move it out on its one local call.
    let mut engine_agent_slot: Option<Box<dyn PlayerAgent>> = Some(Box::new(PromptAgent::new(
        PlayerId(engine_player_index as u32),
        game_id.clone(),
        TauriTransport::new_local(
            engine_prompt_tx.clone(),
            engine_response_rx,
            engine_notify_tx,
            engine_snapshot_tx,
        ),
    )));
    let mut remote_rx_map: HashMap<usize, mpsc::Receiver<PlayerAction>> =
        remote_response_rxs.into_iter().collect();
    let game_id_for_agents = game_id.clone();
    let remote_prompt_tx_for_agents = remote_prompt_tx.clone();

    let mut rng = rand::rngs::StdRng::from_entropy();
    let outcome = run_hosted_multiplayer_game(
        prepared_players,
        abort_signal,
        DEFAULT_MAX_TURNS,
        &mut rng,
        |game_loop| {
            let token_db = get_token_db();
            let token_image_map = get_token_image_map();
            for (script_name, rules) in token_db.iter() {
                let mut template = card_rules_to_instance(rules, PlayerId(0));
                if let Some(info) = token_image_map.get(&script_name) {
                    template.set_code = Some(info.set_code.clone());
                    template.card_number = Some(info.collector_number.clone());
                }
                game_loop.register_token(script_name, template);
            }
        },
        |pid| {
            if pid.index() == engine_player_index {
                engine_agent_slot
                    .take()
                    .expect("agent_factory called twice for the engine seat")
            } else {
                let i = pid.index();
                let resp_rx = remote_rx_map
                    .remove(&i)
                    .expect("Missing response rx for remote player");
                Box::new(PromptAgent::new(
                    pid,
                    game_id_for_agents.clone(),
                    TauriTransport::new_relay(i, remote_prompt_tx_for_agents.clone(), resp_rx),
                ))
            }
        },
    );

    // No-op today; gate any future post-game cleanup on this.
    if outcome.aborted {
        return;
    }
}
