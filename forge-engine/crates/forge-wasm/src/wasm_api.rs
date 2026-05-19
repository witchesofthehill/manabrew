//! Main WASM API for the game engine.
//!
//! This module provides the JavaScript-facing API for the forge-engine.

use forge_agent_interface::deck_dto::Deck as WireDeck;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::card_loader::{get_card_db, get_token_db, DeckCard};
use crate::game_runner::{card_rules_to_instance, GameConfig as RustGameConfig, WasmGame};

/// Flatten every playable pile of a wire `Deck` (main + sideboard +
/// commanders + supplementary decks) into the internal `DeckCard`
/// shape the engine consumes.
fn deck_cards_for_engine(deck: &WireDeck) -> Vec<DeckCard> {
    let mut out: Vec<DeckCard> = Vec::with_capacity(deck.cards.len());
    let push = |out: &mut Vec<DeckCard>, list: &[forge_agent_interface::deck_dto::DeckCard]| {
        for c in list {
            out.push(DeckCard {
                name: c.identity.name.clone(),
                count: 1,
                set_code: c.identity.set_code.clone(),
                card_number: c.identity.card_number.clone(),
            });
        }
    };
    push(&mut out, &deck.cards);
    push(&mut out, &deck.sideboard);
    if let Some(commanders) = &deck.commanders {
        push(&mut out, commanders);
    }
    if let Some(attractions) = &deck.attractions {
        push(&mut out, attractions);
    }
    if let Some(contraptions) = &deck.contraptions {
        push(&mut out, contraptions);
    }
    if let Some(schemes) = &deck.schemes {
        push(&mut out, schemes);
    }
    if let Some(planes) = &deck.planes {
        push(&mut out, planes);
    }
    out
}

/// Game configuration.
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

/// Engine information for version checking.
#[derive(Debug, Clone, Serialize)]
pub struct EngineInfo {
    pub version: String,
    pub wasm_ready: bool,
}

/// Get engine information.
#[wasm_bindgen]
pub fn get_engine_info() -> JsValue {
    let info = EngineInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        wasm_ready: true,
    };
    serde_wasm_bindgen::to_value(&info).unwrap_or(JsValue::NULL)
}

/// Verify WASM is working by echoing back a message.
#[wasm_bindgen]
pub fn echo(msg: &str) -> String {
    format!("forge-wasm echo: {}", msg)
}

/// Parse a deck from JSON.
///
/// Returns a summary of the parsed deck for verification.
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

// ============================================================================
// Full Game API
// ============================================================================

// ============================================================================
// Interactive Game API (uses shared PromptAgent + Atomics.wait)
// ============================================================================

use crate::wasm_transport::{WasmAiTransport, WasmTransport};
use forge_agent_interface::agent_impl::PromptAgent;

/// Run an interactive game with a human player (blocking on Atomics.wait).
///
/// This function blocks the worker thread until the game is complete.
/// The human player's prompts are written to the SharedArrayBuffer,
/// and the worker blocks until the main thread provides a response.
///
/// Call this from a Web Worker — it will block the thread.
#[wasm_bindgen]
pub fn run_interactive_game(
    human_deck_json: JsValue,
    ai_deck_json: JsValue,
    config_json: JsValue,
    shared_buffer: JsValue,
) -> Result<JsValue, JsError> {
    use forge_engine_core::agent::PlayerAgent;
    use forge_engine_core::ids::PlayerId;
    use js_sys::SharedArrayBuffer;

    // Check card database
    if get_card_db().is_none() {
        return Err(JsError::new("Card database not loaded"));
    }

    // Parse decks
    let human_deck: WireDeck = serde_wasm_bindgen::from_value(human_deck_json)
        .map_err(|e| JsError::new(&format!("Failed to parse human deck: {}", e)))?;
    let ai_deck: WireDeck = serde_wasm_bindgen::from_value(ai_deck_json)
        .map_err(|e| JsError::new(&format!("Failed to parse AI deck: {}", e)))?;

    // Parse config
    let config: RustGameConfig = if config_json.is_undefined() || config_json.is_null() {
        RustGameConfig::default()
    } else {
        serde_wasm_bindgen::from_value(config_json)
            .map_err(|e| JsError::new(&format!("Failed to parse config: {}", e)))?
    };

    // Convert decks
    let human_cards: Vec<DeckCard> = deck_cards_for_engine(&human_deck);
    let ai_cards: Vec<DeckCard> = deck_cards_for_engine(&ai_deck);

    web_sys::console::log_1(
        &format!(
            "[InteractiveGame] Starting game: {} human cards vs {} AI cards",
            human_cards.len(),
            ai_cards.len()
        )
        .into(),
    );

    // Create the game
    let mut wasm_game = WasmGame::new(&human_cards, &ai_cards, &config)
        .map_err(|e| JsError::new(&format!("Failed to create game: {}", e)))?;

    // Create the SharedArrayBuffer-backed transport for human player
    let sab: SharedArrayBuffer = shared_buffer
        .dyn_into()
        .map_err(|_| JsError::new("Expected SharedArrayBuffer"))?;

    let human_transport = WasmTransport::new(&sab);
    let ai_transport = WasmAiTransport;

    let game_id = format!("wasm-interactive-{}", js_sys::Date::now() as u64);

    // Create agents using the shared crate's PromptAgent
    let human_agent = PromptAgent::new(PlayerId(0), game_id.clone(), human_transport);
    let ai_agent = PromptAgent::new(PlayerId(1), game_id.clone(), ai_transport);

    let mut agents: Vec<Box<dyn PlayerAgent>> = vec![Box::new(human_agent), Box::new(ai_agent)];

    web_sys::console::log_1(&"[InteractiveGame] Agents created, starting game loop".into());

    // Run the game loop — this BLOCKS on Atomics.wait() when human input is needed
    let winner = wasm_game.game_loop.run(
        &mut wasm_game.game_state,
        &mut agents,
        &mut wasm_game.rng,
        5000, // max turns
    );

    web_sys::console::log_1(
        &format!("[InteractiveGame] Game complete. Winner: {:?}", winner).into(),
    );

    // Return final result
    #[derive(Serialize)]
    struct InteractiveGameResult {
        winner_id: Option<u32>,
        game_over: bool,
    }

    let result = InteractiveGameResult {
        winner_id: winner.map(|p| p.0),
        game_over: true,
    };

    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| JsError::new(&format!("Failed to serialize result: {}", e)))
}

/// Run an N-player multiplayer game using one SharedArrayBuffer per seat.
///
/// `local_buffer` carries prompts for `local_player_index` — the seat
/// the worker is hosting from. `remote_buffers` is an array of length
/// `num_players - 1`, ordered by player index with the local seat
/// skipped: for a 4-player game with local=player-2 the array is
/// `[sab_for_p0, sab_for_p1, sab_for_p3]`. Each SAB is consumed by a
/// dedicated `WasmTransport`; the worker blocks on `Atomics.wait()` per
/// seat sequentially (never concurrently).
///
/// `commander_names_json` is an array of `Option<String>` matching the
/// deck order; non-null entries pull the named card into the command
/// zone before the loop starts.
#[wasm_bindgen]
pub fn run_multiplayer_game(
    decks_json: JsValue,
    commander_names_json: JsValue,
    config_json: JsValue,
    local_buffer: JsValue,
    remote_buffers: JsValue,
    local_player_index: u32,
) -> Result<JsValue, JsError> {
    use forge_agent_interface::prompt::{AgentPrompt, AgentPromptInner};
    use forge_engine_core::ids::PlayerId;
    use forge_game_runtime::deck::{
        deck_to_identities, force_commander_by_name, prepare_registered_player,
    };
    use forge_game_runtime::host_runtime::run_hosted_multiplayer_game;
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

    let num_players = decks.len();
    if num_players < 2 {
        return Err(JsError::new("multiplayer game needs at least 2 decks"));
    }
    if commander_names.len() != num_players {
        return Err(JsError::new(
            "commander_names length must match decks length",
        ));
    }
    if (local_player_index as usize) >= num_players {
        return Err(JsError::new("local_player_index out of range"));
    }

    let config: RustGameConfig = if config_json.is_undefined() || config_json.is_null() {
        RustGameConfig::default()
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

    // Build prepared players from the wire decks. We route through the
    // shared `deck_to_identities` + `prepare_registered_player` so the
    // commander / sideboard / attractions zoning matches Tauri exactly
    // — the wasm side used to flatten everything into the library and
    // then yank the commander out, which got us subtle drift.
    let mut prepared_players = Vec::with_capacity(num_players);
    for (i, deck) in decks.iter().enumerate() {
        let identities = deck_to_identities(deck);
        let name = format!("player-{i}");
        let mut prepared = prepare_registered_player(name, card_db, &identities);
        prepared.registered.starting_life = starting_life;
        // Commander identity comes from the lobby out-of-band, not from
        // the deck pile. If the deck already encoded it, this is a no-op.
        if let Some(commander_name) = commander_names[i].as_deref() {
            force_commander_by_name(&mut prepared, commander_name);
        }
        prepared_players.push(prepared);
    }

    let game_id = format!("wasm-mp-{}", js_sys::Date::now() as u64);
    let engine_player_index = local_player_index as usize;

    // SABs are needed both inside the agent factory (to build each seat's
    // transport) and inside on_game_over (to write the final view). Clone
    // them up-front so each closure owns what it needs without fighting
    // the borrow checker.
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
    let sab_for_agents = sab_by_player.clone();
    let sab_for_game_over = sab_by_player;

    web_sys::console::log_1(
        &format!(
            "[MultiplayerGame] Starting: {num_players} players, local=player-{local_player_index}"
        )
        .into(),
    );

    // The WASM host has no external abort signal — the worker just gets
    // terminated by the main thread when the user leaves. Pass a dummy
    // `Arc<AtomicBool>` so the shared runtime's abort-aware paths still
    // work (they read it via `Ordering::Relaxed`).
    let abort_signal = Arc::new(AtomicBool::new(false));
    let game_id_for_agents = game_id.clone();

    // `from_entropy()` pulls from crypto.getRandomValues in the browser —
    // requires getrandom's `js` feature (enabled in this crate's Cargo.toml),
    // or it panics at runtime on wasm32.
    let mut rng = StdRng::from_entropy();
    let outcome = run_hosted_multiplayer_game(
        game_id,
        prepared_players,
        engine_player_index,
        abort_signal,
        5000,
        &mut rng,
        |game_loop| {
            if let Some(token_db) = get_token_db() {
                for (script_name, rules) in token_db.iter() {
                    let template = card_rules_to_instance(rules, PlayerId(0));
                    game_loop.register_token(script_name, template);
                }
            }
        },
        |pid, _is_local| {
            let sab = &sab_for_agents[pid.index()];
            Box::new(PromptAgent::new(
                pid,
                game_id_for_agents.clone(),
                WasmTransport::new(sab),
            ))
        },
        |pid, _is_local, view| {
            // Mirror Tauri's post-loop emission: send a final GameOver
            // through each seat's transport so every client transitions
            // to the game-over screen instead of stalling on the last
            // mid-game prompt.
            let transport = WasmTransport::new(&sab_for_game_over[pid.index()]);
            let prompt = AgentPrompt {
                deciding_player_id: format!("player-{}", pid.index()),
                display_events: vec![],
                source_card_id: None,
                inner: AgentPromptInner::GameOver { game_view: view },
            };
            <WasmTransport as forge_agent_interface::agent_impl::AgentTransport>::send_prompt(
                &transport, prompt,
            );
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
