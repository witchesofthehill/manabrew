# Companion — Life tracker UI

> **Parity is DEPRECATED and NOT FUNCTIONING.** Do not run `yarn parity`, the parity harness (`manabrew-rs/crates/parity`), the parity debugger, or `DeterministicController`. Do not limit or shape a change to keep parity behavior; ignore any instruction here that exists only to keep parity runs passing.

Standalone IRL play helper. Tracks life, counters, commander damage, monarch / initiative / blessing, and table layout for a paper game shared on one device. **No engine integration.** Persists to `localStorage` under `STORAGE_KEYS.COMPANION`.

Read first: `src/AGENTS.md`, `docs/agents/UI_THEME_RULES.md`.

## Folder map

| File                        | Purpose                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `CompanionBar.tsx`          | Responsive dock: Game, Layout, clock, dice, undo, More, and turn advance                                                  |
| `StartGameDialog.tsx`       | Choose the first player, turn direction, and order before applying grid seating                                           |
| `CompanionBoard.tsx`        | Grid-template layout dispatcher + free-board container                                                                    |
| `FreeTile.tsx`              | Free-layout tile owner: rotate / scale / move handles, body press-state-machine, keyboard ±life                           |
| `PlayerTile.tsx`            | One seat: life readout, adjustment zones, player header, and Player tools dialog                                          |
| `PlayerResources.tsx`       | Shared counter, mana, status, tax, and damage controls for inline and compact views                                       |
| `PlayerMenu.tsx`            | Seat actions: Set life, Player tools, commander, status, accent, notes, reset, eliminate/revive                           |
| `SetLifeDialog.tsx`         | Button keypad with signed integer entry and explicit apply/cancel                                                         |
| `StatusChips.tsx`           | Monarch / Initiative / Ascend pill chips                                                                                  |
| `TapFlash.tsx`              | Side-flash overlay rendered when life ticks (red left, green right)                                                       |
| `CommanderArt.tsx`          | Banner / avatar render for one or two commander refs                                                                      |
| `CommanderDamageStrip.tsx`  | Side rail of opponent avatars (accent-bordered for owner ID); tap opens `CommanderDamageDialog`                           |
| `CommanderDamageDialog.tsx` | Centred modal with big touch steppers per source × commander slot; mirrors the dice-roll modal                            |
| `CommanderPickerDialog.tsx` | Choose commanders from the lobby deck picker or search Scryfall; optionally rename the player                             |
| `CountersRail.tsx`          | Chips with ±/remove for non-life counters                                                                                 |
| `AddCounterMenu.tsx`        | Preset + custom counter dropdown                                                                                          |
| `CustomCounterDialog.tsx`   | Label / starting value / icon picker for custom counters                                                                  |
| `NewSessionDialog.tsx`      | New-game form (format presets, players, starting life, commander, oathbreaker, layout, roster)                            |
| `DiceRoller.tsx`            | Animated roll modal: first-player picker, d4–d100 die roll, coin flip                                                     |
| `DiceTray.tsx`              | Bar dropdown of d4 / d6 / d8 / d10 / d12 / d20 / d100 / coin → opens `DiceRoller` in die mode                             |
| `DieShape.tsx`              | SVG polygon silhouette per die type (triangle / square / pentagon / hexagon / octagon / circle)                           |
| `TurnTimer.tsx`             | Elapsed clock backed by `session.timer`; mode dropdown switches shared / chess clock                                      |
| `PhaseStrip.tsx`            | Below-bar segmented phase indicator (untap … end); pill tints with the active player's accent                             |
| `GameLog.tsx`               | Right-side `Sheet` listing every history event with timestamps and a per-row rewind button                                |
| `GameSummaryDialog.tsx`     | Post-`endSession` modal: final scores, length, turns, copy-to-clipboard recap                                             |
| `WinBanner.tsx`             | Overlay shown when `living.length === 1`; archive / keep-playing; keyed by id+history.length                              |
| `StatsDialog.tsx`           | Aggregate stats derived from `archive[]`: total games, avg length, avg turns, wins by name                                |
| `ManaPoolRail.tsx`          | Floating-mana pips (WUBRGC) rendered in the tile footer; tap +1, hold -1                                                  |
| `CommanderTaxRail.tsx`      | Per-commander tax pip in the tile header by the status chips (tax = 2× casts); tap +1 cast, hold -1; commander rules only |
| `PlayerNotesDialog.tsx`     | Multi-line free-form note for a player, persisted via `setPlayerNotes`                                                    |
| `usePressHold.ts`           | Tap vs. hold gesture binding used by every stepper                                                                        |
| `icons.tsx`                 | Counter-icon name → lucide JSX switch                                                                                     |
| `layouts/slots.ts`          | Layout id → grid template + per-slot rotation                                                                             |

## Conventions

- **Pure UI.** No imports from `@/types/manabrew`, `@/stores/useGameStore`, `@/api/scryfall` except the `searchCards` helper used by the commander picker. The companion never reads engine state.
- **Persisted state lives in `useCompanionStore`.** Component-local state is for UI only (open dialogs, in-flight rename).
- **Theme colors only.** Tile accents map to the resolved theme via `COMPANION_ACCENT_COLORS`, which references `--format-badge-*` CSS variables emitted by `useTheme` from `gameTheme.formatBadge`. Personal game-color overrides recolor every tile; never hard-code hex/oklch tile colors here. Status chips for Monarch/Initiative/Ascend keep fixed semantic Tailwind palette classes (`bg-amber-400`, `bg-violet-500`, `bg-sky-500`) because those colors are part of the MTG iconography. Keep additions sparing.
- **Gestures.** Grid life zones and resource steppers use `usePressHold`. Free seats track body gestures in `FreeTile`. Life taps change the total by one; holds repeat every 110ms after 320ms.
- **Responsive chrome.** `companion.css` uses table and seat dimensions. Only two-row opposing layouts with room for the center dock reserve a center gap. Keep Game → Layout and Player menu → Counters, mana & damage available when direct controls collapse. Preserve the rotated dimension swap and the 44px touch targets.
- **Fullscreen.** `Companion.tsx` hides `TopBar` through the route override, not by overlaying the shell. Keep the dock and enabled phases mounted so More can exit even when the browser denies fullscreen.
- **Deck picks.** Use the complete lobby `CreateGameDialog` for My Decks, Community, and Presets. Tracker import checks for a usable commander instead of online deck legality. Copy names and art into editable slots; deck card IDs identify editor occurrences, not Scryfall printings.
- **Pending life delta.** `adjustLife` batches presses into a history entry and displays `pendingDeltas[playerId]`. `setLife` flushes pending presses before recording an explicit correction so Undo sees the correction first. The board's total is a readout, not a field.
- **Undo / redo.** Both are routed through `revertEvent` / `replayEvent` reducers so every event variant goes through one switch. The redo stack lives on `session.redoStack` and is cleared by any new history push (`pushEvent`). Setup actions (layout, player count, starting life, commander rules, monarch / initiative / blessing / ring / speed toggles, rename, accent, free position, day/night, phase, timer mode, session tag) intentionally do NOT push history. Active pending life deltas are snapshotted and reverted before consulting the history stack so an undo right after a tap still rolls back the visible damage.
- **Turn order.** `layouts/turnOrder.ts` reads seat centers at setup. Grid seats follow `session.gridSeatOrder` from the first player's current slot without changing roster order; free seats keep their transforms. Turn advance reads `session.turnOrder` independently of layout and skips eliminated players. Older saves fall back to roster order.
- **Active-player accent.** `COMPANION_ACCENT_COLORS[active.accentKey]` ties the seat ring, table turn indicator, phase strip and dice to the player's accent.
- **Commander damage and life stay in sync.** `adjustCommanderDamage` subtracts the delta from the target's life in the same store update.

## When to extend

- New counter preset → add to `COMPANION_COUNTER_PRESETS` in `useCompanionStore.constants.ts` and (if its icon is new) add a `case` to `CompanionIcon` in `icons.tsx`.
- New named layout → add the id to `CompanionLayout` (`useCompanionStore.types.ts`), add an entry to `LAYOUT_SPECS` in `layouts/slots.ts`, add a glyph to `SHAPES` in `LayoutIcon.tsx` (that `Record<CompanionLayout, …>` is exhaustive — tsc fails without it), then update `COMPANION_LAYOUT_LABELS`, `COMPANION_LAYOUT_OPTIONS`, and `COMPANION_DEFAULT_LAYOUT_BY_COUNT`. Variable-player layouts (`landscape-row`, `vertical-stack`) build their template at runtime inside `getCompanionSlots`. Slot rotation follows the seat convention: `0` = near/bottom edge, `180` = far/top, `90` = left edge, `-90` = right edge — mirror an existing layout rather than inventing angles. `grid-template` strings must use an explicit column list (`1fr 1fr …`), not `repeat()`, which the shorthand rejects.
- Layouts that rotate any slot ±90° rely on `PlayerTile`'s container-query dim-swap (`100cqh`/`100cqw`) to keep the rotated content within the grid cell. Don't reintroduce `transform: rotate()` on a `size-full` div without also swapping width/height.
- **Free layout.** Rotate, scale and grip handles stay separate from body gestures. Body taps use the seat's rotated coordinates; the life readout can start a drag or pinch but cannot change life. Exclude portaled controls by DOM containment and local seat controls by `[data-companion-no-body-drag]`.
- New accent → add to `COMPANION_ACCENT_KEYS` and `COMPANION_ACCENT_COLORS`; update the type union in `useCompanionStore.types.ts`.

## Non-goals

- Multiplayer sync. Companion is single-device by design.
- Engine prompts, stack, real card state. For online games use `Play` / `Game`.
- Per-device profiles. Roster lives entirely in the session.
