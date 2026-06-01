# Companion — Life tracker UI

Standalone IRL play helper. Tracks life, counters, commander damage, monarch / initiative / blessing, and table layout for a paper game shared on one device. **No engine integration.** Persists to `localStorage` under `STORAGE_KEYS.COMPANION`.

Read first: `src/AGENTS.md`, `docs/agents/UI_THEME_RULES.md`.

## Folder map

| File                        | Purpose                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `CompanionBar.tsx`          | Top bar: new game, player count, starting life, commander toggle, layout, dice, undo, reset, end |
| `CompanionBoard.tsx`        | Grid-template layout dispatcher + free-position drag tile                                        |
| `PlayerTile.tsx`            | One player tile: tap zones, life total, status chips, commander menu, counters rail              |
| `CommanderArt.tsx`          | Banner / avatar render for one or two commander refs                                             |
| `CommanderDamageStrip.tsx`  | Side rail of opponent avatars; popover stepper per source × commander slot                       |
| `CommanderPickerDialog.tsx` | Scryfall-name-search picker with partner toggle                                                  |
| `CountersRail.tsx`          | Chips with ±/remove for non-life counters                                                        |
| `AddCounterMenu.tsx`        | Preset + custom counter dropdown                                                                 |
| `CustomCounterDialog.tsx`   | Label / starting value / icon picker for custom counters                                         |
| `NewSessionDialog.tsx`      | New-game form (players, starting life, commander, layout, carry roster)                          |
| `DiceRoller.tsx`            | Animated first-player randomizer; calls store `pickRandomFirstPlayer`                            |
| `TurnTimer.tsx`             | Single elapsed clock backed by `session.timer`                                                   |
| `usePressHold.ts`           | Tap vs. hold gesture binding used by every stepper                                               |
| `icons.tsx`                 | Counter-icon name → lucide JSX switch                                                            |
| `layouts/slots.ts`          | Layout id → grid template + per-slot rotation                                                    |

## Conventions

- **Pure UI.** No imports from `@/types/manabrew`, `@/stores/useGameStore`, `@/api/scryfall` except the `searchCards` helper used by the commander picker. The companion never reads engine state.
- **Persisted state lives in `useCompanionStore`.** Component-local state is for UI only (open dialogs, in-flight rename).
- **Theme colors only.** Tile accents come from `COMPANION_ACCENT_COLORS` (OKLCH). No semantic-palette tailwind classes like `bg-red-500` inside this folder; status chips that need a fixed semantic color use Tailwind v4's palette like `bg-amber-400` etc. since they map to bg/accent themes that already exist in the design system. Keep additions sparing.
- **Gestures.** Every ± control goes through `usePressHold` so tap-vs-hold behaviour is uniform. Tap = ±1, hold = ±1 every 110ms after a 320ms delay.
- **Pending life delta.** `useCompanionStore.adjustLife` batches consecutive presses inside a ~1.4s window into one history entry. Tile shows the running total via `state.pendingDeltas[playerId]`.
- **Undo.** Reads `session.history` (capped at 80 entries). Active pending deltas are flushed/discarded before undo to keep the timeline consistent.
- **Commander damage and life stay in sync.** `adjustCommanderDamage` subtracts the delta from the target's life in the same store update.

## When to extend

- New counter preset → add to `COMPANION_COUNTER_PRESETS` in `useCompanionStore.constants.ts` and (if its icon is new) add a `case` to `CompanionIcon` in `icons.tsx`.
- New named layout → add the id to `CompanionLayout` (`useCompanionStore.types.ts`), add an entry to `LAYOUT_SPECS` in `layouts/slots.ts`, then update `COMPANION_LAYOUT_LABELS`, `COMPANION_LAYOUT_OPTIONS`, and `COMPANION_DEFAULT_LAYOUT_BY_COUNT`. Variable-player layouts (`landscape-row`, `vertical-stack`) build their template at runtime inside `getCompanionSlots`.
- Layouts that rotate any slot ±90° rely on `PlayerTile`'s container-query dim-swap (`100cqh`/`100cqw`) to keep the rotated content within the grid cell. Don't reintroduce `transform: rotate()` on a `size-full` div without also swapping width/height.
- New accent → add to `COMPANION_ACCENT_KEYS` and `COMPANION_ACCENT_COLORS`; update the type union in `useCompanionStore.types.ts`.

## Non-goals

- Multiplayer sync. Companion is single-device by design.
- Engine prompts, stack, real card state. For online games use `Play` / `Game`.
- Per-device profiles. Roster lives entirely in the session.
