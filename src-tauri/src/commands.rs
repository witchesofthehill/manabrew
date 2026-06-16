use tauri::{AppHandle, State};

use crate::game_manager::GameManager;
use crate::multiplayer_controller::relay_response;
use crate::preset_decks::{wire_deck_to_identities, PresetDeckInfo};
use crate::server_client::ServerClient;
use manabrew_agent_interface::deck_dto::Deck;
use manabrew_agent_interface::prompt::PlayerAction;
use serde_json::Value;

#[tauri::command]
pub async fn start_game(
    app: AppHandle,
    gm: State<'_, GameManager>,
    deck: Deck,
    starting_life: i32,
    commander_name: Option<String>,
    opponent_deck: Option<Deck>,
) -> Result<String, String> {
    let deck_list = wire_deck_to_identities(&deck);
    let opponent_deck_list = opponent_deck.as_ref().map(wire_deck_to_identities);
    gm.start_game(
        app,
        deck_list,
        starting_life,
        commander_name,
        opponent_deck_list,
    )
}

#[tauri::command]
pub async fn respond(
    gm: State<'_, GameManager>,
    client: State<'_, ServerClient>,
    action: PlayerAction,
    player_slot: Option<String>,
) -> Result<(), String> {
    match gm.respond(action.clone()) {
        Ok(()) => Ok(()),
        Err(e) if e == "No active game session" => {
            let slot =
                player_slot.ok_or_else(|| "Missing player slot for relay response".to_string())?;
            relay_response(&client, &slot, action)
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn end_game(gm: State<'_, GameManager>) -> Result<(), String> {
    gm.end_game()
}

#[tauri::command]
pub async fn restore_snapshot(
    gm: State<'_, GameManager>,
    checkpoint_id: u64,
) -> Result<(), String> {
    gm.restore_snapshot(checkpoint_id)
}

#[tauri::command]
pub async fn get_prompt(gm: State<'_, GameManager>) -> Result<Option<Value>, String> {
    Ok(gm.get_latest_prompt_payload())
}

#[tauri::command]
pub fn get_preset_decks() -> Vec<PresetDeckInfo> {
    crate::preset_decks::list_preset_decks()
}

#[tauri::command]
pub fn is_card_supported(name: String) -> bool {
    crate::card_db::card_name_known(&name)
}

#[tauri::command]
pub async fn start_multiplayer_game(
    app: AppHandle,
    gm: State<'_, GameManager>,
    player_names: Vec<String>,
    decks: Vec<Deck>,
    commander_names: Vec<Option<String>>,
    engine_player_index: usize,
    local_is_host: bool,
    starting_life: i32,
) -> Result<String, String> {
    let deck_lists: Vec<Vec<crate::preset_decks::CardIdentity>> =
        decks.iter().map(wire_deck_to_identities).collect();
    gm.start_multiplayer_game(
        app,
        player_names,
        deck_lists,
        commander_names,
        engine_player_index,
        local_is_host,
        starting_life,
    )
}
