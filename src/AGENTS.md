# UI — React + TypeScript

The web frontend for ManaBrew. Tailwind CSS 4, Shadcn/UI, Zustand, React Router. PIXI.js for the game board canvas. (TanStack Query has been removed from the stack — see "Card data" below.)

Read first: `/AGENTS.md`, `docs/STYLE_GUIDELINES.md`, `docs/agents/UI_THEME_RULES.md`.

## Folder map

| Folder               | What lives there                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `components/ui/`     | Shadcn primitives (Button, Card, Dialog, …). No domain logic.                                                           |
| `components/game/`   | Game board UI — has its own AGENTS.md.                                                                                  |
| `components/editor/` | Deck builder.                                                                                                           |
| `components/deck/`   | Deck card displays, label badges. Stateless.                                                                            |
| `components/lobby/`  | Room list, chat, deck picker.                                                                                           |
| `components/layout/` | App shell, sidebar, logo. Visible everywhere — change with care.                                                        |
| `components/dev/`    | Dev-only panels, gated behind a flag. Don't import in production paths.                                                 |
| `views/`             | Page-level views routed by `router.tsx`. Compose components; no heavy logic.                                            |
| `stores/`            | Zustand stores. One per concern. Types in `*.types.ts` siblings, constants in `*.constants.ts`.                         |
| `hooks/`             | App-wide hooks. Component-specific hooks co-locate with the component.                                                  |
| `themes/`            | The 12 color presets. Schema is `GameThemeColors`. See `docs/agents/UI_THEME_RULES.md`.                                 |
| `types/`             | Shared TS interfaces. `manabrew.ts` is the engine ↔ UI DTO contract.                                                    |
| `game/`              | Frontend game runtime: room host, relay, runtime registry. The seam between UI and engine transports.                   |
| `pixi/`              | PIXI.js scene. Reads theme directly via `getTheme().gameTheme.*` — never literal hex.                                   |
| `platform/`          | Web vs Tauri detection / IPC. New platform calls route through this — never `window.__TAURI__` directly.                |
| `lib/`               | Pure utilities (no React). Scryfall helpers, mana parsing, deck import.                                                 |
| `api/`               | External I/O: Scryfall HTTP client and Tauri IPC. (`queryClient.ts` is a legacy TanStack remnant — do not build on it.) |
| `workers/`           | Web worker hosting the WASM engine in browser builds.                                                                   |
| `wasm/`              | wasm-bindgen output. Don't hand-edit; regenerate via `scripts/build-wasm.mjs`.                                          |

## Conventions

- **Colors are theme-driven.** No hex / rgb / rgba / hsl / `0xRRGGBB` literals. No semantic palette tailwind (`ring-red-500`). See `docs/agents/UI_THEME_RULES.md` — read it before any color work.
- **Always `cn()` for conditional classes**, never template literals. Tailwind's JIT cannot detect dynamic class names.
- **Always `import type` for type-only imports.**
- **Path aliases (`@/`) only.** Never `../../` that escapes the current directory.
- **State lives close to where it's used.** Hoist to a Zustand store only when state needs to persist across unmounts or be read from non-React code.
- **One exported component per file.** Files past ~200 lines split.
- **No new abstractions for one-off patterns.** Three similar lines beat a helper.
- **Tests** run via `yarn test` (vitest); co-locate `*.test.ts` next to the code. The prompt-handling test (`stores/gameStore.constants.test.ts`) runs the rust `emit_prompt_fixtures` bin on demand and replays every `AgentPromptInner` variant through `applyPrompt` — no committed fixture, so it can't drift from the engine types.

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

## Engine ↔ UI DTOs

Game state reaches the UI through `src/types/manabrew.ts` and the prompt types in `src/types/promptType.ts`. These shapes are mirrored on the Rust side in `forge-engine/crates/forge-agent-interface/`. **Both sides change together**, or the UI breaks.
