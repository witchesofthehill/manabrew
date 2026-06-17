/**
 * The creature-ETB "stomp": a quick GSAP squash on the card plus a ground dust
 * burst + cracks at its foot. Kept snappy — an instant squash on contact and a
 * fast settle; the dust/cracks carry the lingering part. The region applies
 * `fxScale` to the sprite each frame and supplies the ground reaction.
 */

import { STOMP } from "./config";
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
    .set(fxScale, { x: STOMP.squashX, y: STOMP.squashY })
    .call(onImpact)
    .to(fxScale, { x: 1, y: 1, duration: STOMP.settleSec, ease: STOMP.settleEase });
}
