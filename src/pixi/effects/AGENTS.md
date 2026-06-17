# Board effects — `src/pixi/effects/`

In-game board feedback (entrances, glows, pops, flashes, the active-turn cue). Lives in-game only (Pixi), so the card-face DOM-parity rule in `src/components/game/AGENTS.md` does not apply here.

Two complementary timing systems:

- **GSAP** (`gsap.ts`) for transient, hand-tuned **feel** (anticipation → overshoot → springy settle, sequenced timelines). Import `gsap` from `gsap.ts` (never `"gsap"` directly) so `PixiPlugin` is registered against our Pixi v8 first.
- **Pure `now`-driven math** (`easing.ts`, `animation.ts`) for simple loops/one-shots advanced from the existing tick — when a full GSAP timeline is overkill.

## Modules

| File              | What it is                                                                                                                                                                                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gsap.ts`         | GSAP + `PixiPlugin` registered for Pixi v8. Re-exports `gsap`.                                                                                                                                                                                                                                              |
| `easing.ts`       | Pure easings (`easeOutCubic`, `easeInOutSine`, `easeOutBack`, `bump`). `t` 0..1 → eased value.                                                                                                                                                                                                              |
| `animation.ts`    | Pure time math: `oneShot`/`oneShotProgress` (transient), `pulse` (loops). Callers pass `now`.                                                                                                                                                                                                               |
| `EffectsLayer.ts` | Pooled transient effects via Pixi v8's native `ParticleContainer` (the ETB dust burst). `@pixi/particle-emitter` is v7-only, so we don't use it. Mounted above the felt / below cards; ticked from the region's animate loop.                                                                               |
| `stomp.ts`        | The creature-ETB stomp: a GSAP squash-and-settle timeline + a dust burst.                                                                                                                                                                                                                                   |
| `config/`         | One `*.const.ts` per effect (`CRACKLE`, `DUST`, `FLASH`, `SHOCKWAVE`, `STOMP`, `EDGE_GLOW`, `DAMAGE_HIT`, `STAT_POP`, `SUMMONING_FILTER`), re-exported from `config/index.ts`. **All tunable numbers live here** — colors are still theme tokens at the call site. Tweak feel here, not in the effect body. |

## Principles

- **One Pixi tick.** Per-frame board state is advanced from `BoardScene.tick → BoardRegion.animate(now)` (→ `CardSprite.tickEffects(now)` + `EffectsLayer.tick()`). GSAP runs its own rAF ticker, but it only mutates plain data (e.g. a sprite's `fxScale`) that the region reads each Pixi frame — it never drives the Pixi clock.
- **Compose, don't fight.** The region owns a sprite's final scale (card + hover, via `entry.scaleBase`). Effects that scale a card write a **multiplier** (`CardSprite.fxScale`) the region multiplies in — they never set `sprite.scale` directly.
- **No animated render-to-texture filters.** Animating under a filter re-renders it every frame (see the summoning-sick desaturate filter). For motion use particles / GSAP transforms; filters only as cheap static or very short one-shots.

## Adding an effect

Hand-tuned motion → a GSAP timeline (see `stomp.ts`), driving `fxScale` or other plain props. Simple loop (breathing glow) → a flag + `pulse()` in `animate`. Particles → `EffectsLayer`. Fire it from `BoardRegion.updateBattlefield`'s state diff (it already diffs new entries / power / toughness / damage).

## Current effects

- **Entrance stomp** (`stomp.ts`, creatures only) — GSAP squash-and-settle on the card's `fxScale` + the `EffectsLayer.stompGround` reaction (impact flash bloom + expanding shockwave ring + radial cracks + native-particle dust burst) + the existing `etbGlow` fade. The flash/shockwave are the MTGA-style "pop"; cracks/dust carry the weight. Dev-previewable via the panel's "Flash ETB" button → `triggerEtbGlow` → `BoardScene.previewEtb`.
- **Stat pop** (`CardSprite.playStatPop`) — P/T badge bump on power/toughness change.
- **Damage hit** (`playDamageHit`) — white flash, alongside the existing shake + `-N` floater.
