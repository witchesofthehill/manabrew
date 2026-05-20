use forge_agent_interface::deck_dto::Deck as WireDeck;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::card_loader::{get_card_db, get_token_db};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameConfig {
    #[serde(default = "default_starting_life")]
    pub starting_life: i32,
    #[serde(default)]
    pub commander_name: Option<String>,
}

fn default_starting_life() -> i32 {
    20
}

impl Default for GameConfig {
    fn default() -> Self {
        Self {
            starting_life: 20,
            commander_name: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineInfo {
    pub version: String,
    pub wasm_ready: bool,
}

#[wasm_bindgen]
pub fn get_engine_info() -> JsValue {
    let info = EngineInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        wasm_ready: true,
    };
    serde_wasm_bindgen::to_value(&info).unwrap_or(JsValue::NULL)
}

/// Used to verify WASM is up and running
#[wasm_bindgen]
pub fn echo(msg: &str) -> String {
    format!("forge-wasm echo: {}", msg)
}

#[wasm_bindgen]
pub fn parse_deck(deck_json: JsValue) -> Result<JsValue, JsError> {
    let deck: WireDeck = serde_wasm_bindgen::from_value(deck_json)
        .map_err(|e| JsError::new(&format!("Failed to parse deck: {}", e)))?;

    #[derive(Serialize)]
    struct DeckSummary {
        card_count: usize,
        card_names: Vec<String>,
    }

    let summary = DeckSummary {
        card_count: deck.cards.len(),
        card_names: deck.cards.iter().map(|c| c.identity.name.clone()).collect(),
    };

    serde_wasm_bindgen::to_value(&summary)
        .map_err(|e| JsError::new(&format!("Failed to serialize summary: {}", e)))
}

/// Parse a game config from JSON.
#[wasm_bindgen]
pub fn parse_config(config_json: JsValue) -> Result<JsValue, JsError> {
    let config: GameConfig = if config_json.is_undefined() || config_json.is_null() {
        GameConfig::default()
    } else {
        serde_wasm_bindgen::from_value(config_json)
            .map_err(|e| JsError::new(&format!("Failed to parse config: {}", e)))?
    };

    serde_wasm_bindgen::to_value(&config)
        .map_err(|e| JsError::new(&format!("Failed to serialize config: {}", e)))
}

/// Test that the RNG works in WASM.
#[wasm_bindgen]
pub fn test_rng() -> JsValue {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let values: Vec<u32> = (0..5).map(|_| rng.gen_range(0..100)).collect();

    serde_wasm_bindgen::to_value(&values).unwrap_or(JsValue::NULL)
}

/// Test that forge-foundation types work.
#[wasm_bindgen]
pub fn test_foundation() -> JsValue {
    use forge_foundation::{Color, PhaseType, ZoneType};

    #[derive(Serialize)]
    struct FoundationTest {
        colors: Vec<String>,
        phases: Vec<String>,
        zones: Vec<String>,
    }

    let test = FoundationTest {
        colors: vec![
            format!("{:?}", Color::White),
            format!("{:?}", Color::Blue),
            format!("{:?}", Color::Black),
            format!("{:?}", Color::Red),
            format!("{:?}", Color::Green),
        ],
        phases: vec![
            format!("{:?}", PhaseType::Untap),
            format!("{:?}", PhaseType::Main1),
            format!("{:?}", PhaseType::CombatBegin),
            format!("{:?}", PhaseType::Main2),
        ],
        zones: vec![
            format!("{:?}", ZoneType::Hand),
            format!("{:?}", ZoneType::Library),
            format!("{:?}", ZoneType::Battlefield),
            format!("{:?}", ZoneType::Graveyard),
        ],
    };

    serde_wasm_bindgen::to_value(&test).unwrap_or(JsValue::NULL)
}

use crate::wasm_transport::WasmTransport;
use forge_agent_interface::agent_impl::PromptAgent;
use forge_bot::BotResponder;

#[wasm_bindgen]
pub fn run_interactive_game(
    human_deck_json: JsValue,
    ai_deck_json: JsValue,
    config_json: JsValue,
    shared_buffer: JsValue,
) -> Result<JsValue, JsError> {
    use forge_game_runtime::deck::{
        deck_to_identities, force_commander_by_name, prepare_registered_player,
    };
    use forge_game_runtime::host_runtime::{
        register_tokens_from_db, run_hosted_multiplayer_game, DEFAULT_MAX_TURNS,
    };
    use js_sys::SharedArrayBuffer;
    use rand::rngs::StdRng;
    use rand::SeedableRng;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    let card_db = get_card_db().ok_or_else(|| JsError::new("Card database not loaded"))?;

    let human_deck: WireDeck = serde_wasm_bindgen::from_value(human_deck_json)
        .map_err(|e| JsError::new(&format!("Failed to parse human deck: {}", e)))?;
    let ai_deck: WireDeck = serde_wasm_bindgen::from_value(ai_deck_json)
        .map_err(|e| JsError::new(&format!("Failed to parse AI deck: {}", e)))?;

    let config: GameConfig = if config_json.is_undefined() || config_json.is_null() {
        GameConfig::default()
    } else {
        serde_wasm_bindgen::from_value(config_json)
            .map_err(|e| JsError::new(&format!("Failed to parse config: {}", e)))?
    };
    let starting_life = config.starting_life;

    let local_sab: SharedArrayBuffer = shared_buffer
        .dyn_into()
        .map_err(|_| JsError::new("Expected SharedArrayBuffer"))?;

    // Two seats: the human (seat 0, local) and an AI opponent (seat 1). Routed
    // through the shared host runtime so deck zoning, token setup, and the
    // final game-over prompt match the multiplayer + Tauri paths exactly —
    // single-player no longer dumps every card straight into the library.
    let mut human = prepare_registered_player("You", card_db, &deck_to_identities(&human_deck));
    human.registered.starting_life = starting_life;
    if let Some(commander_name) = config.commander_name.as_deref() {
        force_commander_by_name(&mut human, commander_name);
    }
    let mut ai = prepare_registered_player("AI Opponent", card_db, &deck_to_identities(&ai_deck));
    ai.registered.starting_life = starting_life;
    let prepared_players = vec![human, ai];

    let game_id = format!("wasm-interactive-{}", js_sys::Date::now() as u64);
    let game_id_for_agents = game_id.clone();
    let abort_signal = Arc::new(AtomicBool::new(false));
    let mut rng = StdRng::from_entropy();

    let outcome = run_hosted_multiplayer_game(
        prepared_players,
        abort_signal,
        DEFAULT_MAX_TURNS,
        &mut rng,
        |game_loop| {
            if let Some(token_db) = get_token_db() {
                register_tokens_from_db(game_loop, token_db);
            }
        },
        |pid| {
            if pid.index() == 0 {
                Box::new(PromptAgent::new(
                    pid,
                    game_id_for_agents.clone(),
                    WasmTransport::new(&local_sab),
                ))
            } else {
                Box::new(PromptAgent::new(
                    pid,
                    game_id_for_agents.clone(),
                    BotResponder::default(),
                ))
            }
        },
    );

    #[derive(Serialize)]
    struct InteractiveGameResult {
        winner_id: Option<u32>,
        game_over: bool,
    }

    serde_wasm_bindgen::to_value(&InteractiveGameResult {
        winner_id: outcome.winner.map(|p| p.0),
        game_over: true,
    })
    .map_err(|e| JsError::new(&format!("Failed to serialize result: {}", e)))
}

#[wasm_bindgen]
pub fn run_multiplayer_game(
    decks_json: JsValue,
    commander_names_json: JsValue,
    player_names_json: JsValue,
    config_json: JsValue,
    local_buffer: JsValue,
    remote_buffers: JsValue,
    local_player_index: u32,
) -> Result<JsValue, JsError> {
    use forge_game_runtime::deck::{
        deck_to_identities, force_commander_by_name, prepare_registered_player,
    };
    use forge_game_runtime::host_runtime::{
        register_tokens_from_db, run_hosted_multiplayer_game, DEFAULT_MAX_TURNS,
    };
    use js_sys::{Array, SharedArrayBuffer};
    use rand::rngs::StdRng;
    use rand::SeedableRng;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    let card_db = get_card_db().ok_or_else(|| JsError::new("Card database not loaded"))?;

    let decks: Vec<WireDeck> = serde_wasm_bindgen::from_value(decks_json)
        .map_err(|e| JsError::new(&format!("Failed to parse decks: {e}")))?;
    let commander_names: Vec<Option<String>> = serde_wasm_bindgen::from_value(commander_names_json)
        .map_err(|e| JsError::new(&format!("Failed to parse commander names: {e}")))?;
    let player_names: Vec<String> = serde_wasm_bindgen::from_value(player_names_json)
        .map_err(|e| JsError::new(&format!("Failed to parse player names: {e}")))?;

    let num_players = decks.len();
    if num_players < 2 {
        return Err(JsError::new("multiplayer game needs at least 2 decks"));
    }
    if commander_names.len() != num_players {
        return Err(JsError::new(
            "commander_names length must match decks length",
        ));
    }
    if player_names.len() != num_players {
        return Err(JsError::new("player_names length must match decks length"));
    }
    if (local_player_index as usize) >= num_players {
        return Err(JsError::new("local_player_index out of range"));
    }

    let config: GameConfig = if config_json.is_undefined() || config_json.is_null() {
        GameConfig::default()
    } else {
        serde_wasm_bindgen::from_value(config_json)
            .map_err(|e| JsError::new(&format!("Failed to parse config: {e}")))?
    };
    let starting_life = config.starting_life;

    let local_sab: SharedArrayBuffer = local_buffer
        .dyn_into()
        .map_err(|_| JsError::new("Expected SharedArrayBuffer for local player"))?;

    let remote_sabs_array: Array = remote_buffers
        .dyn_into()
        .map_err(|_| JsError::new("Expected Array of SharedArrayBuffers for remote players"))?;
    if remote_sabs_array.length() as usize != num_players - 1 {
        return Err(JsError::new(
            "remote_buffers length must be num_players - 1",
        ));
    }
    let mut remote_sabs: Vec<SharedArrayBuffer> = Vec::with_capacity(num_players - 1);
    for i in 0..remote_sabs_array.length() {
        let sab: SharedArrayBuffer = remote_sabs_array
            .get(i)
            .dyn_into()
            .map_err(|_| JsError::new("remote_buffers entry is not a SharedArrayBuffer"))?;
        remote_sabs.push(sab);
    }

    // Route through the shared deck_to_identities + prepare_registered_player
    // so commander/sideboard/attractions zoning matches Tauri exactly.
    let mut prepared_players = Vec::with_capacity(num_players);
    for (i, deck) in decks.iter().enumerate() {
        let identities = deck_to_identities(deck);
        let mut prepared = prepare_registered_player(player_names[i].clone(), card_db, &identities);
        prepared.registered.starting_life = starting_life;
        // Commander comes from the lobby out-of-band, not the deck pile.
        if let Some(commander_name) = commander_names[i].as_deref() {
            force_commander_by_name(&mut prepared, commander_name);
        }
        prepared_players.push(prepared);
    }

    let game_id = format!("wasm-mp-{}", js_sys::Date::now() as u64);
    let engine_player_index = local_player_index as usize;

    // Index SABs by player id (local seat → local_sab, others → remote
    // SABs in order). Both closures below need them, so clone per closure.
    let mut sab_by_player: Vec<SharedArrayBuffer> = Vec::with_capacity(num_players);
    let mut remote_iter = remote_sabs.iter();
    for i in 0..num_players {
        if i == engine_player_index {
            sab_by_player.push(local_sab.clone());
        } else {
            sab_by_player.push(
                remote_iter
                    .next()
                    .expect("remote_sabs length already validated against num_players - 1")
                    .clone(),
            );
        }
    }
    let sab_for_agents = sab_by_player;

    let card_counts: Vec<usize> = decks.iter().map(|d| d.cards.len()).collect();
    web_sys::console::log_1(
        &format!(
            "[MultiplayerGame] Starting: {num_players} players, \
             local=player-{local_player_index}, cards per seat={card_counts:?}"
        )
        .into(),
    );

    // No external abort on WASM — the worker is just terminated. Dummy
    // signal keeps the shared runtime's abort-aware paths happy.
    let abort_signal = Arc::new(AtomicBool::new(false));
    let game_id_for_agents = game_id.clone();

    // from_entropy needs getrandom's `js` feature (see Cargo.toml) or it
    // panics at runtime on wasm32 — covered by tests/rng_smoke.rs.
    let mut rng = StdRng::from_entropy();
    let outcome = run_hosted_multiplayer_game(
        prepared_players,
        abort_signal,
        DEFAULT_MAX_TURNS,
        &mut rng,
        |game_loop| {
            if let Some(token_db) = get_token_db() {
                register_tokens_from_db(game_loop, token_db);
            }
        },
        |pid| {
            // Remote seats get a recv timeout (new_relay) so a networked
            // player who stops responding can't hang the host worker; the
            // local seat blocks indefinitely like a human at the keyboard.
            let sab = &sab_for_agents[pid.index()];
            let transport = if pid.index() == engine_player_index {
                WasmTransport::new(sab)
            } else {
                WasmTransport::new_relay(sab)
            };
            Box::new(PromptAgent::new(pid, game_id_for_agents.clone(), transport))
        },
    );

    let winner = outcome.winner;
    web_sys::console::log_1(&format!("[MultiplayerGame] Complete. Winner: {winner:?}").into());

    #[derive(Serialize)]
    struct InteractiveGameResult {
        winner_id: Option<u32>,
        game_over: bool,
    }

    serde_wasm_bindgen::to_value(&InteractiveGameResult {
        winner_id: winner.map(|p| p.0),
        game_over: true,
    })
    .map_err(|e| JsError::new(&format!("Failed to serialize result: {e}")))
}
