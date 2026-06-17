# Board effects — `src/pixi/effects/`

Shared, **pure** animation primitives for in-game board feedback (glows, pops, flashes, the active-turn glow). These make the game easy to follow; they live in-game only (Pixi) and are **not** card-face style, so the DOM-parity rule in `src/components/game/AGENTS.md` does not apply here.

## Modules

| File              | What it is                                                                                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `easing.ts`       | Pure easing functions (`easeOutCubic`, `easeInOutSine`, `easeOutBack`, `bump`). `t` in 0..1 → eased value.                                                                                                                               |
| `animation.ts`    | Pure time math: `oneShot(now, dur)` + `oneShotProgress(s, now)` for transient tweens, `pulse(now, period, …)` for loops. Callers pass `now` in — nothing reads the clock.                                                                |
| `EffectsLayer.ts` | A self-culling pool of transient canvas-space effects (the ETB ground stomp). Mounted by its owner (the board region, just above the felt / below cards) and ticked from that owner's animate loop. Drawing is pure (progress → shapes). |

## Principles

- **One tick.** Every effect is advanced from the existing loop: `BoardScene.tick → BoardRegion.animate(now)`, which calls `CardSprite.tickEffects(now)` per card and pulses region-level glows. No new tickers, no per-effect `requestAnimationFrame`.
- **Pure math, mutable edges.** Timing/easing are pure functions of `now`. The only mutable state is the small set of `OneShot | null` fields on a sprite (and the region's `active` flag).
- **No animated filters.** Animating a value under a render-to-texture filter re-runs the filter every frame (see the summoning-sick desaturate filter). Keep one-shots to cheap alpha/scale/Graphics redraws.

## Adding an effect

Transient (a one-shot on a card): add a `OneShot | null` field + a `play…(now)` trigger on `CardSprite`, advance it in `tickEffects` via `oneShotProgress`, and fire the trigger from `BoardRegion.updateBattlefield`'s state diff (it already diffs entries/power/toughness/damage). Looping (a breathing glow): keep a flag + draw once, and `pulse()` its alpha in `animate`.

## Current effects

- **Entrance** — the `etbGlow` fade + a ground **dust ring** (`EffectsLayer.spawnStomp`, creatures only). Dev-previewable via `BoardScene.previewEtb` (the dev panel's "Flash ETB" button → `triggerEtbGlow`).
- **Stat pop** (`playStatPop`) — P/T badge bump on power/toughness change.
- **Damage hit** (`playDamageHit`) — white flash, alongside the existing shake + `-N` floater.
- **Active-turn glow** (`BoardRegion.setActive`) — breathing felt-edge glow on the active player's region; plumbed `activePlayerId` → `BoardCanvas` → `BoardScene.setActivePlayer`.
