#![allow(clippy::too_many_arguments)]

mod asset_server;
mod card_db;
mod commands;
mod forge_room;
mod limited_bootstrap;
mod limited_commands;
mod limited_dto;
mod limited_manager;
mod local_relay;

use limited_manager::LimitedManager;
use manabrew_engine::game::TypeRegistry;
use tauri::Manager;

// Embedded at compile time so packaged builds don't depend on the build
// machine's source tree layout.
const TYPE_LISTS: &str = include_str!("../../forge/forge-gui/res/lists/TypeLists.txt");

// Tauri copies these resources into the app's resource_dir at install
// time (see tauri.conf.json bundle.resources). The card/token/edition
// loaders pick them up via env vars set before any command runs.
//
// `CARDSET_ARCHIVE` points at a single bundled file, not a directory —
// without it, packaged builds fall back to scanning the 32k-file
// cardsfolder, which on Windows takes ~10 minutes due to NTFS + Defender
// per-file overhead.
const RESOURCE_ENV_MAP: &[(&str, &str)] = &[
    ("CARDS_DIR", "engine/forge/forge-gui/res/cardsfolder"),
    (
        "TOKEN_SCRIPTS_DIR",
        "engine/forge/forge-gui/res/tokenscripts",
    ),
    ("EDITIONS_DIR", "engine/forge/forge-gui/res/editions"),
    ("MANA_BREW_FORGE_ASSETS_DIR", "engine/forge/forge-gui"),
    ("CARDSET_ARCHIVE", "cardset.rkyv"),
];

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            TypeRegistry::load(TYPE_LISTS);

            if let Ok(resource_dir) = app.path().resource_dir() {
                for (key, subdir) in RESOURCE_ENV_MAP {
                    let path = resource_dir.join(subdir);
                    if path.exists() {
                        std::env::set_var(key, &path);
                    } else {
                        eprintln!(
                            "[startup] bundled resource missing: {} (env {} left unset)",
                            path.display(),
                            key
                        );
                    }
                }
            }

            let url = asset_server::main_window_url(app.handle());
            let builder = tauri::WebviewWindowBuilder::new(app, "main", url);
            // Sizing/decoration builder methods are desktop-only in tauri v2;
            // mobile windows are always fullscreen.
            #[cfg(desktop)]
            let builder = builder
                .title("Manabrew")
                .inner_size(1400.0, 900.0)
                .resizable(true)
                .maximized(true);
            builder.build()?;

            Ok(())
        })
        .manage(LimitedManager::new())
        .manage(forge_room::ForgeRoomHost::new())
        .manage(local_relay::LocalRelayHost::new())
        .invoke_handler(tauri::generate_handler![
            commands::is_card_supported,
            forge_room::start_forge_host,
            forge_room::stop_forge_host,
            local_relay::start_local_relay,
            local_relay::stop_local_relay,
            limited_commands::limited_start_sealed,
            limited_commands::limited_get_sealed_pool,
            limited_commands::limited_get_edition_info,
            limited_commands::limited_get_set_pool,
            limited_commands::limited_list_sealed_templates,
            limited_commands::limited_start_booster_draft,
            limited_commands::limited_pick_card,
            limited_commands::limited_undo_pick,
            limited_commands::limited_get_draft_state,
            limited_commands::limited_start_multiplayer_draft,
            limited_commands::limited_submit_pick,
            limited_commands::limited_get_seat_state,
            limited_commands::limited_start_winston,
            limited_commands::limited_winston_take,
            limited_commands::limited_winston_pass,
            limited_commands::limited_get_winston_state,
            limited_commands::limited_cubecobra_url,
            limited_commands::limited_import_cube,
            limited_commands::limited_list_chaos_themes,
            limited_commands::limited_start_gauntlet_from_sealed,
            limited_commands::limited_record_gauntlet_outcome,
            limited_commands::limited_get_gauntlet_match_decks,
            limited_commands::limited_update_gauntlet_human_deck,
            limited_commands::limited_advance_gauntlet_round,
            limited_commands::limited_get_gauntlet_state,
            limited_commands::limited_list_conspiracy_hooks,
            limited_commands::limited_drop_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
