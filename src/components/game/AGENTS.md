# Game UI — board, modals, panels, zones

The largest UI subtree. Read first: `src/AGENTS.md`, `docs/STYLE_GUIDELINES.md`, `docs/agents/UI_THEME_RULES.md`.

## Layout

| Folder / file                             | Role                                                                                                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GameBoard.tsx`, `Game.tsx` (in `views/`) | Top-level board composition.                                                                                                                                                     |
| `panels/`                                 | Player panels, mana pool, action log, stack display, prompt actions.                                                                                                             |
| `zones/`                                  | Small React overlays — `LibraryZoneTile`, `ManaAbilityTapButton`, `HandCardActions`. The battlefield and hand themselves are rendered by Pixi (`@/pixi/BoardCanvas`), not React. |
| `modals/`                                 | Prompt modals (target picker, choose mode, choose number, library peek, …). All built on the `Modal` compound. `PromptModalController` routes engine prompts to the right modal. |
| `cost-modals/`                            | Alternative-cost prompts (kicker, buyback, replicate, phyrexian, …).                                                                                                             |
| `dice/`                                   | Dice-roll UI: animations, feedback, and the reroll/swap/ignore/modify modals.                                                                                                    |
| `game.types.ts`                           | Shared TS interfaces for board UI.                                                                                                                                               |
| `game.constants.ts`                       | Magic numbers, phase definitions, sizing values, color arrays.                                                                                                                   |
| `game.styles.ts`                          | Reusable Tailwind class-string constants.                                                                                                                                        |
| `game.utils.ts`                           | Pure utilities (no React).                                                                                                                                                       |

When adding a constant, type, util, or class string, **check the shared modules first.** Don't duplicate.

## Board canvas — single unified Pixi scene

The whole table renders on **one** Pixi canvas, not one canvas per player. `BoardCanvas` (`@/pixi/BoardCanvas`) drives a single `BoardScene` (`@/pixi/board/BoardScene`) that hosts one `BoardRegion` per player, positioned by `computeBoardLayout` (`@/pixi/board/boardLayout`). Because every player's battlefield shares one coordinate space, cards can animate across the center line (MTGA-style combat staging) without crossing a canvas boundary.

- **Regions** (`BoardRegion`) own per-player grid layout, attachment stacking, rings, combat staging, and animation. The local region gets full interaction (drag/marquee/overlay); opponent regions are tap-to-target + hover only. Each reaches orchestrator services through a `RegionHost`.
- **Local controllers** live on the scene: `HandController`, `SelectionController`, `BattlefieldOverlay`, plus the `DragHandler` gesture. They talk to the scene through the `HandHost` / `SelectionHost` / `OverlayHost` seams in `@/pixi/board/types`.
- **Arrows** are not drawn inside `BoardScene`. It exposes `getArrowDefs()`; a separate transparent overlay canvas, `BoardArrowsCanvas` (`@/pixi/BoardArrowsCanvas`), reads those each tick and draws arrows _above_ the React panels.
- **Layout** is chosen in Settings (`row` vs `perimeter` arrangement) — `perimeter` is gated behind the `wraparoundBoardLayout` feature flag (`src/featureFlags.ts`); while it's off, the board is locked to `row` and the Settings toggle is hidden. `GameBoard` anchors its React player panels to the region rects returned via `BoardCanvas`'s `onLayout`. Each opponent region carries a `RegionOrientation` (`top` / `left` / `right`); in `perimeter` (4 players) the left/right players are seated on the side columns. A side region's whole Pixi container is **rotated 90°** so its cards face the table center — the grid/layout/hit-test code is unchanged and runs in a swapped-dimension local space, with `localToCanvas` / `canvasToLocal` mapping in `BoardRegion` bridging to canvas coords for arrows and entry seeds. Combat staging is skipped for the rotated sides. In `perimeter` the self cluster also splits MTGA-style (avatar + mana far left, zone tiles far right, clear of the bottom-right action cluster), and `BoardCanvas`'s `handInsets` reserves bottom-corner space so the centered hand fan never overlaps either group. The hand is held to a minimum width: if a single zone row would squeeze it, the zones wrap into a 2-column grid (`PlayerPanel` `zonesGrid`). Every player's React panel is measured (relative to the board) and pushed to its region via `BoardScene.setPlayerBlockers` as a canvas-space keep-out, so battlefield cards never lay out under that player's own zones/avatar — converted into the region's local space (`collectLocalBlockers`), which also handles the rotated side seats.

The legacy per-player canvases (`PixiGameCanvas` / `PixiGameScene` / `PixiArrowsCanvas` / `PixiPhaseStripCanvas` / `OpponentHalf`) have been removed — do not reintroduce them.

## Modal pattern

All game modals use the `Modal` compound:

```tsx
<Modal onClose={onCancel} maxWidth="max-w-md">
  <Modal.Header>{/* title + optional source-card thumbnail */}</Modal.Header>
  <Modal.Instructions>Instruction text</Modal.Instructions>
  <Modal.Body>{/* content */}</Modal.Body>
  <Modal.Footer>{/* buttons */}</Modal.Footer>
</Modal>
```

Use `MODAL_CARD_THUMBNAIL` / `MODAL_CARD_IMAGE` / `MODAL_FOOTER_BETWEEN` constants. Use `useModalKeyboard` for Enter/Escape handling. Use `CardImageThumbnail` for header art.

For a modal that renders a list/grid of cards the user searches through (zone viewers, tutors, choose-from-zone), gate a name filter with `useCardNameFilter(cards)` (shows only past ~10 cards) and render `<ModalCardFilter>` between the header/instructions and `Modal.Body`, mapping its `filtered` instead of the raw `cards`. Pass `autoFocus` only when the modal has no Space/Enter-to-confirm (otherwise the focused input swallows the shortcut).

## Mana text

Any text that may contain `{W}`, `{2}{R}`, etc. renders through `TextWithMana`:

```tsx
<TextWithMana text={description} manaSize="sm" />
```

Don't roll your own symbol parsing.

## Sizing

Use the standard size constants. Don't invent pixel values.

| Constant             | Usage                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `BATTLEFIELD_CARD`   | `w-[70px] h-[98px]` — battlefield (where React is involved)                                                                                 |
| `HAND_CARD`          | `w-[80px] h-[112px]` — hand / zone viewer                                                                                                   |
| `HAND_CARD_BASE`     | Hand-card base pixel dims, scaled at runtime by `useHandScale` (`HAND_FAN_PARAMS` in `pixi/HandLayout.ts` holds the fan spread/lift params) |
| `MODAL_CARD_SIZE`    | `w-[100px] h-[140px]` — cards inside modal grids                                                                                            |
| `MULLIGAN_CARD_SIZE` | `w-[160px] h-[222px]` — cards inside mulligan modals                                                                                        |
| `FLASH_CARD_SIZE`    | `{ w: 310, h: 434 }` (numeric — for Pixi-rendered preview, not a Tailwind class)                                                            |

## Prompt routing

The engine sends a `Prompt` (from `@/protocol`) → `PromptModalHost` (in `prompts/promptComponents.tsx`) looks up `prompt.input.type` in the `PROMPT_MODALS` registry and renders that entry inside `PromptModalController`. Each registry entry receives `{ prompt, respond, ctx }` — it reads the typed `prompt.input`, renders a leaf modal from `modals/`, and answers by calling `respond(<PromptOutput>)` directly (no per-prompt store callback). `ctx` carries the misc UI extras the engine prompt doesn't (`sourceDeckCard`, `revealedDeckCard`); non-prompt overlays (zone viewer, spell stack, ability picker) live in `GameOverlays`, not the registry.

To support a new prompt: add `src/protocol/prompts/<name>.ts` (`Type`/`Input`/`Output`), add it to the unions in `protocol/prompts/index.ts`, add a `PROMPT_MODALS` entry, and build the modal under `modals/`. The Rust counterpart lives in `manabrew-rs/crates/manabrew-agent-interface/src/prompt.rs`.

## Theme

This subtree is the most color-heavy in the app. **No hex / rgba / palette tailwind.** Add a semantic key to `GameThemeColors` (in `src/themes/gameTheme.ts`), wire it in `buildGameColors()` (in `src/themes/buildGameColors.ts`), regenerate the Tailwind `@theme` block with `node scripts/generate-theme-css.mjs --write`, then use the generated token utility (`bg-pointer-hostile`, `text-counter-p1p1`, `ring-card-ring`, `bg-pt-buffed`, …). See `docs/agents/UI_THEME_RULES.md`.
