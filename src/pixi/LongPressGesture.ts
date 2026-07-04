import { LONG_PRESS_CANCEL_DIST_SQ, LONG_PRESS_PREVIEW_MS } from "@/lib/responsive";

export class LongPressGesture {
  private timer: number | null = null;
  private origin: { x: number; y: number } | null = null;
  private firedKey: string | null = null;

  start(
    e: { pointerType: string; global: { x: number; y: number } },
    key: string,
    onFire: () => void,
  ): void {
    if (e.pointerType !== "touch") return;
    this.cancel();
    this.origin = { x: e.global.x, y: e.global.y };
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.firedKey = key;
      onFire();
    }, LONG_PRESS_PREVIEW_MS);
  }

  move(x: number, y: number): void {
    if (this.timer === null || !this.origin) return;
    const dx = x - this.origin.x;
    const dy = y - this.origin.y;
    if (dx * dx + dy * dy > LONG_PRESS_CANCEL_DIST_SQ) this.cancel();
  }

  cancel(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.origin = null;
  }

  /** Abort path (pinch takeover, gesture cancel): also disarm the tap
   *  suppression, or the next plain tap on the same key would be eaten. */
  reset(): void {
    this.cancel();
    this.firedKey = null;
  }

  /** The suppressed tap fires synchronously right after the up event; clear
   *  the marker on the next tick so it can't leak into a later tap. */
  releaseFired(): void {
    if (this.firedKey === null) return;
    window.setTimeout(() => {
      this.firedKey = null;
    }, 0);
  }

  consumeTap(key: string): boolean {
    if (this.firedKey !== key) return false;
    this.firedKey = null;
    return true;
  }
}
