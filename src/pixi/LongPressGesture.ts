import { LongPressTimer } from "@/lib/longPress";

export class LongPressGesture {
  private timer = new LongPressTimer();
  private firedKey: string | null = null;

  start(
    e: { pointerType: string; global: { x: number; y: number } },
    key: string,
    onFire: () => void,
  ): void {
    if (e.pointerType !== "touch") return;
    this.timer.start(e.global.x, e.global.y, () => {
      this.firedKey = key;
      onFire();
    });
  }

  move(x: number, y: number): void {
    this.timer.move(x, y);
  }

  cancel(): void {
    this.timer.cancel();
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
