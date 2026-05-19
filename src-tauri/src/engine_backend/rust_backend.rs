use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;

use forge_agent_interface::agent_impl::PromptAgent;
use forge_agent_interface::game_log_event::GameLogEntryDto;
use forge_agent_interface::game_snapshot_event::GameSnapshotEventDto;
use forge_agent_interface::game_view_dto::GameViewDto;
use forge_agent_interface::prompt::{AgentPrompt, AgentPromptInner, PlayerAction};
use forge_engine_core::agent::PlayerAgent;
use forge_engine_core::game::GameState;
use forge_engine_core::game_loop::GameLoop;
use forge_engine_core::ids::PlayerId;
use forge_engine_core::player::RegisteredPlayer;
use forge_game_runtime::deck::{force_commander_by_name, instantiate_registered_players};
use forge_game_runtime::host_runtime::run_hosted_multiplayer_game;
use rand::SeedableRng;

use crate::ai_agent::spawn_ai_prompt_responder;
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
    prompt_tx: mpsc::Sender<AgentPrompt>,
    response_rx: mpsc::Receiver<PlayerAction>,
    notify_tx: mpsc::Sender<GameLogEntryDto>,
    snapshot_tx: mpsc::Sender<GameSnapshotEventDto>,
    abort_signal: Arc<AtomicBool>,
) {
    let mut players = Vec::with_capacity(2);
    let mut human = if deck_list.len() == 1 && is_preset_id(&deck_list[0].name) {
        prepare_preset_registered_player("You", &deck_list[0].name)
    } else {
        prepare_custom_registered_player("You", &deck_list)
    };
    human.registered.starting_life = starting_life;
    if let Some(ref name) = commander_name {
        force_commander_by_name(&mut human, name);
    }
    players.push(human);

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
    players.push(opponent);

    let registered: Vec<RegisteredPlayer> = players.iter().map(|p| p.registered.clone()).collect();
    let mut game = GameState::new_from_registered_players(&registered);
    instantiate_registered_players(&mut game, players);

    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    let human = PromptAgent::new(
        p0,
        game_id.clone(),
        TauriTransport::new_local(prompt_tx.clone(), response_rx, notify_tx, snapshot_tx),
    );

    let (ai_prompt_tx, ai_prompt_rx) = mpsc::channel::<AgentPrompt>();
    let (ai_response_tx, ai_response_rx) = mpsc::channel::<PlayerAction>();
    spawn_ai_prompt_responder(ai_prompt_rx, ai_response_tx);
    let ai = PromptAgent::new(
        p1,
        game_id.clone(),
        TauriTransport::new_ai(ai_prompt_tx, ai_response_rx),
    );

    let mut agents: Vec<Box<dyn PlayerAgent>> = vec![Box::new(human), Box::new(ai)];
    let mut game_loop = GameLoop::new(2);
    game_loop.set_abort_signal(abort_signal.clone());
    if std::env::var("FORGE_ENGINE_GAME_LOG").is_err() {
        game_loop.game_log.set_enabled(true);
    }
    game_loop.experimental_restore_snapshot =
        std::env::var("FORGE_ENGINE_RESTORE_SNAPSHOT").is_ok();

    // Register token templates so the engine can instantiate tokens by script name.
    // Uses a placeholder owner (p0); the actual owner/controller is set at creation time.
    // Attaches Scryfall set code + collector number from edition files for image lookup.
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

    let mut rng = rand::rngs::StdRng::from_entropy();

    let winner = game_loop.run(&mut game, &mut agents, &mut rng, 5000);

    if abort_signal.load(Ordering::Relaxed) {
        return;
    }

    let final_view = GameViewDto::from_engine(&game, &game_loop.mana_pools, p0, &game_id, &[], &[]);
    let _ = prompt_tx.send(AgentPrompt {
        deciding_player_id: "player-0".to_string(),
        display_events: vec![],
        source_card_id: None,
        inner: AgentPromptInner::GameOver {
            game_view: final_view,
        },
    });

    let _ = winner;
}

pub fn run_multiplayer_game(
    game_id: String,
    player_names: Vec<String>,
    deck_lists: Vec<Vec<CardIdentity>>,
    commander_names: Vec<Option<String>>,
    engine_player_index: usize,
    starting_life: i32,
    engine_prompt_tx: mpsc::Sender<AgentPrompt>,
    engine_response_rx: mpsc::Receiver<PlayerAction>,
    engine_notify_tx: mpsc::Sender<GameLogEntryDto>,
    engine_snapshot_tx: mpsc::Sender<GameSnapshotEventDto>,
    remote_prompt_tx: mpsc::Sender<(usize, AgentPrompt)>,
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
        if let Some(ref commander_name) = commander_names[i] {
            force_commander_by_name(&mut prepared, commander_name);
        }
        prepared_players.push(prepared);
    }

    // Engine seat owns the local mpsc; remote seats each consume one entry
    // from this map exactly once. Wrapped in Option so the FnMut factory
    // can move the engine agent out on its single matching call.
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

    run_hosted_multiplayer_game(
        game_id.clone(),
        prepared_players,
        engine_player_index,
        abort_signal,
        5000,
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
        |pid, is_local| {
            if is_local {
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
        |pid, is_local, view| {
            let prompt = AgentPrompt {
                deciding_player_id: format!("player-{}", pid.index()),
                display_events: vec![],
                source_card_id: None,
                inner: AgentPromptInner::GameOver { game_view: view },
            };
            if is_local {
                let _ = engine_prompt_tx.send(prompt);
            } else {
                let _ = remote_prompt_tx.send((pid.index(), prompt));
            }
        },
    );
}
