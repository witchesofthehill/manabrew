/**
 * The creature-ETB "stomp": a GSAP squash-and-settle on the card plus a ground
 * dust burst at its foot. GSAP owns the timing (anticipation → slam → springy
 * settle) — the region just applies `fxScale` to the sprite each frame and
 * supplies the dust burst.
 */

import { gsap } from "./gsap";

export interface StompOptions {
  /** Mutable squash multiplier the region applies to the sprite ({1,1} = none). */
  fxScale: { x: number; y: number };
  /** Fire the ground reaction (dust cloud + cracks) at the moment of impact. */
  onImpact: () => void;
}

export function playStomp({ fxScale, onImpact }: StompOptions): void {
  gsap.killTweensOf(fxScale);
  // A weighty landing reads as: an instant squash on contact, then a tight
  // settle with a single small overshoot — not a springy/rubbery wobble.
  gsap
    .timeline()
    .set(fxScale, { x: 1.2, y: 0.84 }) // impact: wide + short
    .call(onImpact)
    .to(fxScale, { x: 1, y: 1, duration: 0.36, ease: "back.out(2)" });
}
