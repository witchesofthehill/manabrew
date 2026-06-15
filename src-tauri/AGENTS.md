# Tauri shell

Native desktop wrapper. Tauri v2, Rust backend, hosts either the native ManaBrew engine or (opt-in) the Forge bridge.

Read first: `/AGENTS.md`.

## Layout

| File                                                                        | Role                                                                                                                                                     |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib.rs`, `src/main.rs`                                                 | Tauri entry — registers handlers, loads bundled resources.                                                                                               |
| `src/commands.rs`                                                           | Game commands exposed to the UI (`start_game`, `respond`, `end_game`, `restore_snapshot`, `get_prompt`, …).                                              |
| `src/server_commands.rs`                                                    | Lobby/server commands (`server_connect`, `server_join_room`, …).                                                                                         |
| `src/game_manager.rs`                                                       | Owns the active game session(s).                                                                                                                         |
| `src/engine_backend.rs`, `src/engine_backend/`                              | Two backends: `rust_backend.rs` (production) and `java_backend.rs` (parity-debug bridge). DTO shapes must match between the two — the UI doesn't branch. |
| `src/ai_agent.rs`, `src/client_bot.rs`                                      | AI agent and bot manager.                                                                                                                                |
| `src/multiplayer_controller.rs`, `src/network.rs`, `src/tauri_transport.rs` | Networking + IPC transport.                                                                                                                              |
| `src/server_client.rs`                                                      | Client-side connection to the optional matchmaking server.                                                                                               |
| `src/card_db.rs`, `src/preset_decks.rs`                                     | Card database loader, preset deck loader.                                                                                                                |
| `tauri.conf.json`                                                           | Bundle config — including the generated Forge runtime bundle, preset decks, and the Tauri cardset archive copied into the app at install time.           |

## Conventions

- **Bundled resources** — `scripts/harness.mjs` stages the Java Forge harness JAR and engine Forge assets into generated `src-tauri/resources/forge-runtime/`, with `forge-gui/res/cardsfolder/cardsfolder.zip` matching Forge's packaged-resource lookup. Tauri copies that bundle to `engine/forge/`; `public/preset_decks/` is copied to `preset_decks/` (the same directory the web build serves at `/preset_decks/`). Runtime paths are exposed via env vars (`CARDS_DIR`, `TOKEN_SCRIPTS_DIR`, `MANA_BREW_FORGE_ASSETS_DIR`, `MANA_BREW_FORGE_HARNESS_JAR`, `PRESET_DECKS_DIR`, …) set in `lib.rs::run()` before any command runs. `CARDSET_ARCHIVE` remains the separate Tauri archive resource at bundled `cardset.rkyv`, produced from `src-tauri/resources/cardset.rkyv` by `src-tauri/build.rs`. Don't read paths relative to the source tree at runtime — packaged builds don't have it.
- **Backend selection.** `MANA_BREW_ENGINE_BACKEND=forge` switches to the Forge bridge. Without it (or `=manabrew`), the native ManaBrew engine runs. Confirm the active backend in terminal logs (`backend=forge` or `backend=manabrew`); the UI alone doesn't reveal it.
- **DTO parity.** `engine_backend/rust_backend.rs` and `engine_backend/java_backend.rs` must emit identical DTO shapes. If you add a field to one, add it to the other.
- **Tauri command surface.** Every UI-facing command is registered in `lib.rs::run()` via `tauri::generate_handler![…]`. Adding a command means: implement, add to the handler list, expose from the appropriate module.
- **Long-running work runs off the command thread.** Tauri commands are async; spawn into the game/transport runtime, don't block.
