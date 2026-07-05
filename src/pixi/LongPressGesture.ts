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

  reset(): void {
    this.cancel();
    this.firedKey = null;
  }

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
