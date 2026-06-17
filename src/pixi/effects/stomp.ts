import { STOMP } from "./config";
import { gsap } from "./gsap";

export interface StompOptions {
  fxScale: { x: number; y: number };
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
