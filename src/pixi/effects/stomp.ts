import { STOMP } from "./config";
import { animationsEnabled } from "./enabled";
import { gsap } from "./gsap";

export interface StompOptions {
  fxScale: { x: number; y: number };
}

export function playStomp({ fxScale }: StompOptions): void {
  gsap.killTweensOf(fxScale);
  if (!animationsEnabled()) {
    fxScale.x = 1;
    fxScale.y = 1;
    return;
  }
  gsap
    .timeline()
    .set(fxScale, { x: STOMP.squashX, y: STOMP.squashY })
    .to(fxScale, { x: 1, y: 1, duration: STOMP.settleSec, ease: STOMP.settleEase });
}
