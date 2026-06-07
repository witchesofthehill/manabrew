# Game UI — board, modals, panels, zones

The largest UI subtree. Read first: `src/AGENTS.md`, `docs/STYLE_GUIDELINES.md`, `docs/agents/UI_THEME_RULES.md`.

## Layout

| Folder / file                             | Role                                                                                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GameBoard.tsx`, `Game.tsx` (in `views/`) | Top-level board composition.                                                                                                                                                        |
| `panels/`                                 | Player panels, mana pool, action log, stack display, prompt actions.                                                                                                                |
| `zones/`                                  | Small React overlays — `LibraryZoneTile`, `ManaAbilityTapButton`, `HandCardActions`. The battlefield and hand themselves are rendered by Pixi (`@/pixi/PixiGameCanvas`), not React. |
| `modals/`                                 | Prompt modals (target picker, choose mode, choose number, library peek, …). All built on the `Modal` compound. `PromptModalController` routes engine prompts to the right modal.    |
| `cost-modals/`                            | Alternative-cost prompts (kicker, buyback, replicate, phyrexian, …).                                                                                                                |
| `dice/`                                   | Dice-roll UI: animations, feedback, and the reroll/swap/ignore/modify modals.                                                                                                       |
| `game.types.ts`                           | Shared TS interfaces for board UI.                                                                                                                                                  |
| `game.constants.ts`                       | Magic numbers, phase definitions, sizing values, color arrays.                                                                                                                      |
| `game.styles.ts`                          | Reusable Tailwind class-string constants.                                                                                                                                           |
| `game.utils.ts`                           | Pure utilities (no React).                                                                                                                                                          |

When adding a constant, type, util, or class string, **check the shared modules first.** Don't duplicate.

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

## Mana text

Any text that may contain `{W}`, `{2}{R}`, etc. renders through `TextWithMana`:

```tsx
<TextWithMana text={description} manaSize="sm" />
```

Don't roll your own symbol parsing.

## Sizing

Use the standard size constants. Don't invent pixel values.

| Constant             | Usage                                                                              |
| -------------------- | ---------------------------------------------------------------------------------- |
| `BATTLEFIELD_CARD`   | `w-[70px] h-[98px]` — battlefield (where React is involved)                        |
| `HAND_CARD`          | `w-[80px] h-[112px]` — hand / zone viewer                                          |
| `HAND_CARD_BASES`    | Per-size pixel dims (`small`/`medium`/`large`) scaled at runtime by `useHandScale` |
| `MODAL_CARD_SIZE`    | `w-[100px] h-[140px]` — cards inside modal grids                                   |
| `MULLIGAN_CARD_SIZE` | `w-[160px] h-[222px]` — cards inside mulligan modals                               |
| `FLASH_CARD_SIZE`    | `{ w: 310, h: 434 }` (numeric — for Pixi-rendered preview, not a Tailwind class)   |

## Prompt routing

The engine sends a `Prompt` (from `@/protocol`) → `PromptModalHost` (in `prompts/promptComponents.tsx`) looks up `prompt.input.type` in the `PROMPT_MODALS` registry and renders that entry inside `PromptModalController`. Each registry entry receives `{ prompt, respond, ctx }` — it reads the typed `prompt.input`, renders a leaf modal from `modals/`, and answers by calling `respond(<PromptOutput>)` directly (no per-prompt store callback). `ctx` carries the misc UI extras the engine prompt doesn't (`sourceDeckCard`, `revealedDeckCard`); non-prompt overlays (zone viewer, spell stack, ability picker) live in `GameOverlays`, not the registry.

To support a new prompt: add `src/protocol/prompts/<name>.ts` (`Type`/`Input`/`Output`), add it to the unions in `protocol/prompts/index.ts`, add a `PROMPT_MODALS` entry, and build the modal under `modals/`. The Rust counterpart lives in `forge-engine/crates/forge-agent-interface/src/prompt.rs`.

## Theme

This subtree is the most color-heavy in the app. **No hex / rgba / palette tailwind.** Add a semantic key to `GameThemeColors` (in `src/themes/gameTheme.ts`), wire it in `buildGameColors()` (in `src/themes/buildGameColors.ts`), regenerate the Tailwind `@theme` block with `node scripts/generate-theme-css.mjs --write`, then use the generated token utility (`bg-pointer-hostile`, `text-counter-p1p1`, `ring-card-ring`, `bg-pt-buffed`, …). See `docs/agents/UI_THEME_RULES.md`.
