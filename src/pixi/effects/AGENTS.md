# Board effects — `src/pixi/effects/`

In-game board feedback (entrances, glows, pops, flashes, the active-turn cue). Lives in-game only (Pixi), so the card-face DOM-parity rule in `src/components/game/AGENTS.md` does not apply here.

Two complementary timing systems:

- **GSAP** (`gsap.ts`) for transient, hand-tuned **feel** (anticipation → overshoot → springy settle, sequenced timelines). Import `gsap` from `gsap.ts` (never `"gsap"` directly) so `PixiPlugin` is registered against our Pixi v8 first.
- **Pure `now`-driven math** (`easing.ts`, `animation.ts`) for simple loops/one-shots advanced from the existing tick — when a full GSAP timeline is overkill.

## Modules

| File           | What it is                                                                                                                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gsap.ts`      | GSAP + `PixiPlugin` registered for Pixi v8. Re-exports `gsap`.                                                                                                                                                              |
| `easing.ts`    | Pure easings (`easeOutCubic`, `easeInOutSine`, `easeOutBack`, `bump`). `t` 0..1 → eased value.                                                                                                                              |
| `animation.ts` | Pure time math: `oneShot`/`oneShotProgress` (transient), `pulse` (loops). Callers pass `now`.                                                                                                                               |
| `stomp.ts`     | A short creature-entry squash and settle on `fxScale`.                                                                                                                                                                      |
| `PulseRing.ts` | Shared GSAP alpha pulse used by `CardSprite.setPlayableRing`. `show` is idempotent, so repeated layout calls do not restart it. The stack keeps its own pulse because the seat stroke and ring share one `Graphics` object. |
| `config/`      | Tunable values for `CARD_SHADOW`, `STOMP`, `EDGE_GLOW`, `DAMAGE_HIT`, `STAT_POP`, `SUMMONING_FILTER`, and `PULSE_RING`, re-exported from `config/index.ts`. Colors remain theme tokens.                                     |

## Principles

- **One Pixi tick.** Board animation advances from `BoardScene.tick` through regions, hand, HUD, and phase strip. GSAP mutates plain effect data such as `fxScale`; it never drives the Pixi clock. `animationsEnabled()` combines the user preference with `prefers-reduced-motion`.
- **Compose, don't fight.** The region owns a sprite's final scale (card + hover, via `entry.scaleBase`). Effects that scale a card write a **multiplier** (`CardSprite.fxScale`) the region multiplies in — they never set `sprite.scale` directly.
- **No animated render-to-texture filters.** Animating under a filter re-renders it every frame (see the summoning-sick desaturate filter). For motion use particles / GSAP transforms; filters only as cheap static or very short one-shots.

## Adding an effect

Use a GSAP timeline for transient motion, driving `fxScale` or other plain props. Use `pulse()` or one-shot math for simple tick-driven effects. Fire effects from the existing battlefield state diff.

## Current effects

- **Entrance settle** (`stomp.ts`, creatures only) uses a small GSAP squash-and-settle plus the existing entry glow. The dev panel's "Flash ETB" action reaches `BoardScene.previewEtb`.
- **Card depth** uses cached layered `GraphicsContext` shadows in `CardSprite`. `setElevation` changes shadow offset, spread, and opacity without changing the card's transform or hit area. These shadows belong to in-game objects, not DOM card-face chrome.
- **Stat pop** (`CardSprite.playStatPop`) — P/T badge bump on power/toughness change.
- **Damage hit** (`playDamageHit`) — white flash, alongside the existing shake + `-N` floater.
