# Tauri shell

Native desktop wrapper. Tauri v2, Rust backend. **The desktop shell does not run games.** Manabrew games run in WASM (the same web worker the browser build uses), and lobby/relay traffic runs through the JS WebSocket client. Tauri's only game-specific job is hosting a **Forge** engine room via the bundled self-hosted-node.

Read first: `/AGENTS.md`.

## Layout

| File                        | Role                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib.rs`, `src/main.rs` | Tauri entry — registers handlers, sets bundled-resource env vars, manages state.                                                |
| `src/commands.rs`           | `is_card_supported` — the one card-db command the UI still calls natively.                                                      |
| `src/forge_room.rs`         | `start_forge_host` / `stop_forge_host` — spin up / tear down the bundled self-hosted-node Forge room (feature `forge-room`).    |
| `src/card_db.rs`            | Card database loader (rkyv archive) backing `is_card_supported` and the limited stack.                                          |
| `src/limited_*.rs`          | Sealed / draft / winston / gauntlet / cube — the limited-format command surface and its session manager.                        |
| `tauri.conf.json`           | Bundle config (forge runtime + cardset archive) and the COOP/COEP headers that make WASM/SharedArrayBuffer work in the webview. |

## Conventions

- **The shell hosts the web frontend; the frontend runs the engine.** `src/platform/tauri.ts` (`TauriPlatform`) wraps a `WebPlatform`: `game`, `storage`, `events`, and `server` all delegate to it. The only override is `server.createRoom` with `engine === "Forge"` (and `stopRoom`), which call the native `start_forge_host` / `stop_forge_host` commands. `TauriPlatform.invoke` stays on native IPC for `is_card_supported` and the `limited_*` commands (the WASM worker only implements a subset of the limited surface).
- **Cross-origin isolation is mandatory.** WASM needs `SharedArrayBuffer`, which needs COOP `same-origin` + COEP. macOS Tauri runs on WKWebView (WebKit), which only isolates with COEP **`require-corp`** — it ignores `credentialless` (the value web/Chromium uses). So desktop must serve `require-corp`: the packaged webview gets it from `tauri.conf.json` → `app.security.headers`; the dev server gets it from `vite.config.ts`, which switches to `require-corp` when launched under Tauri (detected via `TAURI_ENV_PLATFORM`). `require-corp` means cross-origin subresources must be CORS-loaded — Scryfall images already set `crossOrigin="anonymous"`. Without isolation the engine can't start (the `PlatformRuntimeChecks` diagnostic in `App.tsx` surfaces this on both platforms).
- **Forge rooms need a live relay connection.** `start_forge_host` takes the relay `host` / `port` / `relay_password` as command args (passed from the JS relay client's current connection), then the local player joins the room it created through the normal web relay path.
- **Bundled resources.** `scripts/harness.mjs` stages Forge engine assets into generated `src-tauri/resources/forge-runtime/`, with `cardsfolder.zip` matching Forge's packaged-resource lookup. Tauri copies that bundle to `engine/forge/`. `CARDSET_ARCHIVE` is the separate `cardset.rkyv` resource produced from `src-tauri/resources/cardset.rkyv` by `src-tauri/build.rs`. Runtime paths are exposed via env vars (`CARDS_DIR`, `TOKEN_SCRIPTS_DIR`, `EDITIONS_DIR`, `MANA_BREW_FORGE_ASSETS_DIR`, `CARDSET_ARCHIVE`) set in `lib.rs::run()` before any command runs. Don't read paths relative to the source tree at runtime — packaged builds don't have it.
- **Tauri command surface.** Every UI-facing command is registered in `lib.rs::run()` via `tauri::generate_handler![…]`. Adding a command means: implement, add to the handler list, expose from the appropriate module.
- **Long-running work runs off the command thread.** Tauri commands are async; spawn into the runtime, don't block.
