import { LONG_PRESS_CANCEL_DIST_SQ, LONG_PRESS_PREVIEW_MS } from "./responsive";

export class LongPressTimer {
  private timer: number | null = null;
  private origin: { x: number; y: number } | null = null;

  start(x: number, y: number, onFire: () => void): void {
    this.cancel();
    this.origin = { x, y };
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.origin = null;
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
}
