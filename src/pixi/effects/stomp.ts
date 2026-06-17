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
  gsap
    .timeline()
    .set(fxScale, { x: 0.92, y: 1.12 }) // falling: narrow + tall
    .to(fxScale, { x: 1.28, y: 0.74, duration: 0.12, ease: "power2.in" }) // slam: wide + short
    .call(onImpact, undefined, ">-0.02")
    .to(fxScale, { x: 1, y: 1, duration: 0.62, ease: "elastic.out(1, 0.4)" }); // springy settle
}
