# UI — React + TypeScript

The web frontend for Manabrew. Tailwind CSS 4, Shadcn/UI, Zustand, React Router. PIXI.js for the game board canvas. (TanStack Query has been removed from the stack — see "Card data" below.)

Read first: `/AGENTS.md`, `docs/STYLE_GUIDELINES.md`, `docs/agents/UI_THEME_RULES.md`.

## Folder map

| Folder                  | What lives there                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `components/ui/`        | Shadcn primitives (Button, Card, Dialog, …). No domain logic.                                                           |
| `components/game/`      | Game board UI — has its own AGENTS.md.                                                                                  |
| `components/editor/`    | Deck builder.                                                                                                           |
| `components/deck/`      | Deck card displays, label badges. Stateless.                                                                            |
| `components/lobby/`     | Room list, chat, deck picker.                                                                                           |
| `components/companion/` | Paper-play life tracker — has its own AGENTS.md.                                                                        |
| `components/layout/`    | App shell, sidebar, logo. Visible everywhere — change with care.                                                        |
| `components/dev/`       | Dev-only panels, gated behind a flag. Don't import in production paths.                                                 |
| `components/icons/`     | Hand-rolled SVG icon components for brands lucide lacks (Discord). Stateless.                                           |
| `views/`                | Page-level views routed by `router.tsx`. Compose components; no heavy logic.                                            |
| `stores/`               | Zustand stores. One per concern. Types in `*.types.ts` siblings, constants in `*.constants.ts`.                         |
| `hooks/`                | App-wide hooks. Component-specific hooks co-locate with the component.                                                  |
| `themes/`               | The 12 color presets. Schema is `GameThemeColors`. See `docs/agents/UI_THEME_RULES.md`.                                 |
| `types/`                | Shared TS interfaces. `manabrew.ts` is the engine ↔ UI DTO contract.                                                    |
| `game/`                 | Frontend game runtime: room host, relay, runtime registry, multiplayer draft host/peer (`draft*.ts`). UI ↔ engine seam. |
| `pixi/`                 | PIXI.js scene. Reads theme directly via `getTheme().gameTheme.*` — never literal hex.                                   |
| `platform/`             | Web vs Tauri detection / IPC. New platform calls route through this — never `window.__TAURI__` directly.                |
| `lib/`                  | Pure utilities (no React). Scryfall helpers, mana parsing, deck import.                                                 |
| `api/`                  | External I/O: Scryfall HTTP client and Tauri IPC. (`queryClient.ts` is a legacy TanStack remnant — do not build on it.) |
| `workers/`              | Web worker hosting the WASM engine — used by both browser and desktop (Tauri) builds.                                   |
| `wasm/`                 | wasm-bindgen output. Don't hand-edit; regenerate via `scripts/build-wasm.mjs`.                                          |

## Conventions

- **Colors are theme-driven.** No hex / rgb / rgba / hsl / `0xRRGGBB` literals. No semantic palette tailwind (`ring-red-500`). See `docs/agents/UI_THEME_RULES.md` — read it before any color work.
- **Always `cn()` for conditional classes**, never template literals. Tailwind's JIT cannot detect dynamic class names.
- **Always `import type` for type-only imports.**
- **Path aliases (`@/`) only.** Never `../../` that escapes the current directory.
- **State lives close to where it's used.** Hoist to a Zustand store only when state needs to persist across unmounts or be read from non-React code.
- **The page never scrolls.** `body` is `overflow:hidden; overscroll-behavior:none` and `html/body/#root` are `height:100%` (`index.css` base layer); `AppShell` is `h-[100dvh]` and owns scrolling via its inner `<main overflow-auto>`. Views must fit the viewport and scroll their own content — don't rely on body scroll. Immersive routes (`isImmersiveRoute` in `AppShell`: game + companion) get `!p-0 !overflow-hidden`. Use `100dvh`, not `100vh`/`h-screen`, for full-height on mobile, and `env(safe-area-inset-*)` for notch/home-indicator padding (the viewport meta sets `viewport-fit=cover`).
- **One exported component per file.** Files past ~200 lines split.
- **No new abstractions for one-off patterns.** Three similar lines beat a helper.
- **Tests** run via `yarn test` (vitest); co-locate `*.test.ts` next to the code. The prompt-handling test (`stores/gameStore.constants.test.ts`) runs the rust `emit_prompt_fixtures` bin on demand and replays every `AgentPromptInner` variant through `applyPrompt` — no committed fixture, so it can't drift from the engine types.

## Feature flags

Compile-time feature flags live in **one** file: `src/featureFlags.ts`. Add a boolean to the `featureFlags` object (default `false` to ship a feature dark) and gate code with `isFeatureEnabled("<flag>")`. Don't scatter ad-hoc flags elsewhere — this is the single source of truth, flipped by hand in the file. (Currently empty — the registry stays as the home for the next flag.)

## Card data — Scryfall store

Scryfall card lookups, image textures, set lists, and rulings flow through `src/stores/useScryfallStore.ts` (Zustand + immer). It is the **only** sanctioned path for card data; do not introduce TanStack Query, `useQuery`, or one-off `fetch` calls for card or set lookups.

Use the exported hook helpers, not the raw store:

| Need                                       | Use                                                |
| ------------------------------------------ | -------------------------------------------------- |
| Card metadata by name / set+collector / id | `useCard({ name, setCode?, collectorNumber? })`    |
| Pixi `Texture` for a card image            | `useCardTexture(...)`                              |
| Card rulings                               | `useCardRulings(card)`                             |
| Set list as a `Map`                        | `useSetLookup()`                                   |
| Bulk warm the cache before a view loads    | `prefetchCards([...])`                             |
| Force a refresh of a single card           | `useScryfallStore.getState().invalidateCard(name)` |
| Promote a chosen printing                  | `useScryfallStore.getState().updatePrinting(card)` |

Lookup keys are normalized internally (`id:` / `set:…::cn:…` / `name:…[::set:…]`); always pass structured args, never assemble keys yourself. Token cards resolve through the same store from `public/token_archive.json`; do not add per-component token fetch/discovery hooks.

## Deck analysis — combos & bracket

Commander deck analysis (combos, Game Changers, bracket estimate) lives in `stores/useDeckAnalysisStore.ts`, driven by `hooks/useDeckAnalysis.ts` (mounted once in `DeckBuilder`). Combos come from Commander Spellbook (`api/commanderSpellbook.ts`); the Game Changers list and bracket logic come from Scryfall + `lib/brackets.ts` (`lib/gameChangers.ts`). Card cells read membership via the name-keyed selectors `useIsComboCard` / `useIsGameChangerCard` — the same pattern as `useIsUnsupported`, so no prop-drilling through `DeckListView`. This is deck-level analysis, not card lookup; it is exempt from the "Scryfall store only" rule above.

## Engine ↔ UI DTOs

The engine→UI channel carries **three separate message families**, never conflated: `state` (a `StateUpdate` = `{ gameView }`, the sole carrier of game state), `display` (a `DisplayEvent` animation hint), and `prompt` (a `Prompt` call-to-action that carries **no** gameView). The store has one apply fn each — `applyState` / `applyDisplay` / `applyPrompt` (`stores/gameStore.constants.ts`) — and `useGameEventListeners` routes `game:state` / `game:display` / `game:prompt` (plus `game:remote_*` for relay seats) to them. State is applied for whichever player it is addressed to; a prompt only becomes actionable when `forPlayer === myPlayerSlot`. Prompt modals read gameView from the store (via `ctx.gameView`), never off the prompt.

Per-prompt `Type`/`Input`/`Output` payloads live under `protocol/prompts/`; the `Prompt`/`StateUpdate` shapes and `Response` envelope under `protocol/transport/`. (`src/types/promptType.ts` holds only shared helper types like `TargetingIntent`.) These shapes are mirrored on the Rust side in `manabrew-rs/crates/manabrew-agent-interface/` (`AgentMessage { State | Display | Prompt }`). **Both sides change together**, or the UI breaks.

## Multiplayer reconnection

A multiplayer engine game arms a localStorage marker (`lib/activeGameSession.ts`) when it starts; `useGameStore.endGame` clears it. After a page reload, `useGameSessionResume` (mounted once in `AppShell`) sees the marker, reconnects with persisted prefs, and — for non-host seats — pulls a relay replay via `server.requestResync()` (GameStarted → navigate to `/play`; state + pending prompt are pulled again by `useGameEventListeners` once mounted, because `game:remote_*` events are dropped while no listener is attached). A reloaded host cannot resume (the WASM engine died with the tab) — it sends `EndGame`, which the relay fans out as `GameAborted`. Router state survives reloads but a game launch must not: engine-game route state is stamped with `PAGE_LOAD_ID` (`game/engineGameLaunch.ts`) and `Play.tsx` ignores any state minted by an earlier page load — only the resume flow may start a game after a reload. The waiting overlay + abort countdown live in `useMultiplayerInterruption` / `WaitingForPlayerScreen`, driven by `reconnect.phase` (own socket) and `RoomPlayerInfo.connected` (opponents), with the timeout from `RoomInfo.reconnect_timeout_s`. Relay-side, an aborted in-game room is always **reset to Lobby** (`lobby.rs::reset_room_to_lobby`, shared by `EndGame` and the per-disconnect abort timer that fires at exactly `reconnect_timeout_s + 5s`) — never torn down with connected sessions still attached, and never deferred to a periodic sweep.
