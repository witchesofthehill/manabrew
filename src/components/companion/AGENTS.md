# Companion — Life tracker UI

Standalone IRL play helper. Tracks life, counters, commander damage, monarch / initiative / blessing, and table layout for a paper game shared on one device. **No engine integration.** Persists to `localStorage` under `STORAGE_KEYS.COMPANION`.

Read first: `src/AGENTS.md`, `docs/agents/UI_THEME_RULES.md`.

## Folder map

| File                        | Purpose                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `CompanionBar.tsx`          | Top bar: new game, player count, starting life, commander toggle, layout, dice, undo, reset, end                          |
| `CompanionBoard.tsx`        | Grid-template layout dispatcher + free-board container                                                                    |
| `FreeTile.tsx`              | Free-layout tile owner: rotate / scale / move handles, body press-state-machine, keyboard ±life                           |
| `PlayerTile.tsx`            | One player tile: tap zones, life total, status chips, commander menu, counters rail                                       |
| `StatusChips.tsx`           | Monarch / Initiative / Ascend pill chips                                                                                  |
| `PlayerMenu.tsx`            | Top-right ⋮ menu (commander picker, status toggles, accent picker, reset, eliminate/revive)                               |
| `TapFlash.tsx`              | Side-flash overlay rendered when life ticks (red left, green right)                                                       |
| `CommanderArt.tsx`          | Banner / avatar render for one or two commander refs                                                                      |
| `CommanderDamageStrip.tsx`  | Side rail of opponent avatars (accent-bordered for owner ID); tap opens `CommanderDamageDialog`                           |
| `CommanderDamageDialog.tsx` | Centred modal with big touch steppers per source × commander slot; mirrors the dice-roll modal                            |
| `CommanderPickerDialog.tsx` | Scryfall-name-search picker with partner toggle                                                                           |
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
- **Theme colors only.** Tile accents map to the active theme via `COMPANION_ACCENT_COLORS`, which references `--format-badge-*` CSS variables emitted by `useTheme` from `gameTheme.formatBadge`. Switching theme preset recolors every tile; never hard-code hex/oklch tile colors here. Status chips for Monarch/Initiative/Ascend keep fixed semantic Tailwind palette classes (`bg-amber-400`, `bg-violet-500`, `bg-sky-500`) because those colors are part of the MTG iconography. Keep additions sparing.
- **Gestures.** Every ± control goes through `usePressHold` so tap-vs-hold behaviour is uniform. Tap = ±1, hold = ±1 every 110ms after a 320ms delay.
- **Pending life delta.** `useCompanionStore.adjustLife` batches consecutive presses inside a ~1.4s window into one history entry. Tile shows the running total via `state.pendingDeltas[playerId]`.
- **Undo / redo.** Both are routed through `revertEvent` / `replayEvent` reducers so every event variant goes through one switch. The redo stack lives on `session.redoStack` and is cleared by any new history push (`pushEvent`). Setup actions (layout, player count, starting life, commander rules, monarch / initiative / blessing / ring / speed toggles, rename, accent, free position, day/night, phase, timer mode, session tag) intentionally do NOT push history. Active pending life deltas are snapshotted and reverted before consulting the history stack so an undo right after a tap still rolls back the visible damage.
- **Active-player accent.** Read `COMPANION_ACCENT_COLORS[active.accentKey]` everywhere that needs to mirror whose turn it is — currently `PlayerTile` ring, `CompanionBar` T# pill, `PhaseStrip` active pill, `DiceRoller` numeric and coin variants, and the "Goes first" chip on `lastFirstPlayerId`. All four pull from the same selector so a single accent change recolours them in lock-step.
- **Commander damage and life stay in sync.** `adjustCommanderDamage` subtracts the delta from the target's life in the same store update.

## When to extend

- New counter preset → add to `COMPANION_COUNTER_PRESETS` in `useCompanionStore.constants.ts` and (if its icon is new) add a `case` to `CompanionIcon` in `icons.tsx`.
- New named layout → add the id to `CompanionLayout` (`useCompanionStore.types.ts`), add an entry to `LAYOUT_SPECS` in `layouts/slots.ts`, add a glyph to `SHAPES` in `LayoutIcon.tsx` (that `Record<CompanionLayout, …>` is exhaustive — tsc fails without it), then update `COMPANION_LAYOUT_LABELS`, `COMPANION_LAYOUT_OPTIONS`, and `COMPANION_DEFAULT_LAYOUT_BY_COUNT`. Variable-player layouts (`landscape-row`, `vertical-stack`) build their template at runtime inside `getCompanionSlots`. Slot rotation follows the seat convention: `0` = near/bottom edge, `180` = far/top, `90` = left edge, `-90` = right edge — mirror an existing layout rather than inventing angles. `grid-template` strings must use an explicit column list (`1fr 1fr …`), not `repeat()`, which the shorthand rejects.
- Layouts that rotate any slot ±90° rely on `PlayerTile`'s container-query dim-swap (`100cqh`/`100cqw`) to keep the rotated content within the grid cell. Don't reintroduce `transform: rotate()` on a `size-full` div without also swapping width/height.
- Free layout offers three pointer handles in a row at the bottom-centre of each tile: rotate (tap → snap to next 90°, drag → free rotation snapped to 15°), scale (tap → reset to 1×, drag → resize relative to distance from tile centre, snapped to 0.05 between 0.55× and 2×, persisted as `freeLayout.scale`), and grip (move-only). The card body itself is also a move target: capture-phase pointer handlers on the FreeTile wrapper start a maybe-drag on `pointerdown`, promote it to a real drag after 8px of motion, dispatch a `pointercancel` on the inner press-hold so the tap doesn't fire, and skip entirely when the press began inside a `[data-companion-handle]` element. Free-rotation angles outside ±90° intentionally let the rotated tile spill over its bounding box — the board container has `overflow-hidden` so the spill doesn't break layout. Two-finger pinch on the tile body zooms and rotates in one gesture: `FreeTile` tracks live pointers in an `activePointers` map, and the second `pointerdown` aborts the in-flight life tap/drag and snapshots `pinch` (finger distance → `scale`, finger angle → `rotation`, snapped to `SCALE_SNAP` / `ROTATION_SNAP_DEG` and clamped to `SCALE_MIN`/`SCALE_MAX`). It writes the same `{x, y, rotation, scale}` model as the handles — position is unchanged (no pan). The body keeps `touch-none` so the browser doesn't claim the second finger for page pinch-zoom.
- New accent → add to `COMPANION_ACCENT_KEYS` and `COMPANION_ACCENT_COLORS`; update the type union in `useCompanionStore.types.ts`.

## Non-goals

- Multiplayer sync. Companion is single-device by design.
- Engine prompts, stack, real card state. For online games use `Play` / `Game`.
- Per-device profiles. Roster lives entirely in the session.
