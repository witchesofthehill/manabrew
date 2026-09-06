import type { CardDto } from "@/protocol/game";

export type PreviewCard = CardDto & { zoneId?: string };
export interface PreviewPointerInput {
  buttons: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}
export type PreviewPlacement = "auto" | "top-center" | "pinned";
export type PreviewPhase = "hidden" | "open" | "closing";

/**
 * Every preview timing knob, in one place. The cold show delay is the
 * user-facing "Card Preview Delay" preference; everything else tunes here.
 */
export const PREVIEW_TIMING = {
  warmShowDelayMs: 100,
  warmWindowMs: 1000,
  leaveGraceMs: 120,
  enterMs: 220,
  exitMs: 130,
  battlefieldHoverOutHoldMs: 60,
} as const;

export interface PreviewShowOptions {
  pointer?: { x: number; y: number };
  anchorRect?: DOMRect | null;
  placement?: PreviewPlacement;
  delayMs?: number;
}

export interface PreviewSnapshot {
  phase: PreviewPhase;
  card: PreviewCard | null;
  sticky: boolean;
  showBackFace: boolean;
  mousePos: { x: number; y: number };
  anchorRect: DOMRect | null;
  placement: PreviewPlacement;
}

const HIDDEN: PreviewSnapshot = {
  phase: "hidden",
  card: null,
  sticky: false,
  showBackFace: false,
  mousePos: { x: 0, y: 0 },
  anchorRect: null,
  placement: "auto",
};

export class CardPreviewMachine {
  private snapshot: PreviewSnapshot = HIDDEN;
  private listeners = new Set<() => void>();
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private exitTimer: ReturnType<typeof setTimeout> | null = null;
  private pointerOnPreview = false;
  private lastVisibleAt = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PreviewSnapshot => this.snapshot;

  hoverStart(card: PreviewCard, options: PreviewShowOptions = {}): void {
    this.clearShowTimer();
    this.clearGraceTimer();
    if (this.snapshot.sticky) return;
    this.pointerOnPreview = false;
    // Hover sources re-assert on every pointermove (so a spurious hoverEnd —
    // e.g. the preview jumping positions during an instant switch — can't
    // close a preview the cursor is still justifying). Same card object while
    // open means nothing to update: timers are cleared, skip the emit.
    if (this.snapshot.phase === "open" && this.snapshot.card === card) return;
    // Instant switching is only allowed while already open: a dismissed preview
    // must always re-enter through the delay, or a pointermove racing a dismiss
    // re-shows it for a single frame (the show/hide/show flash).
    const delayMs = this.isWarm()
      ? Math.min(options.delayMs ?? 0, PREVIEW_TIMING.warmShowDelayMs)
      : (options.delayMs ?? 0);
    if (this.snapshot.phase === "open" || !delayMs) {
      this.open(card, options, false);
      return;
    }
    this.showTimer = setTimeout(() => {
      this.showTimer = null;
      this.open(card, options, false);
    }, delayMs);
  }

  private isWarm(): boolean {
    return Date.now() - this.lastVisibleAt < PREVIEW_TIMING.warmWindowMs;
  }

  hoverEnd(): void {
    this.clearShowTimer();
    if (this.snapshot.sticky) return;
    if (this.pointerOnPreview) return;
    if (this.snapshot.phase !== "open" || this.graceTimer) return;
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      this.close();
    }, PREVIEW_TIMING.leaveGraceMs);
  }

  stick(card: PreviewCard, options: PreviewShowOptions = {}): void {
    this.clearShowTimer();
    this.clearGraceTimer();
    this.open(card, options, true);
  }

  pointerEnterPreview(): void {
    this.pointerOnPreview = true;
    this.clearGraceTimer();
  }

  pointerLeavePreview(): void {
    this.pointerOnPreview = false;
    this.hoverEnd();
  }

  flip(): void {
    if (!this.snapshot.card) return;
    this.emit({ ...this.snapshot, showBackFace: !this.snapshot.showBackFace });
  }

  dismiss(): void {
    this.clearShowTimer();
    this.clearGraceTimer();
    this.clearExitTimer();
    this.pointerOnPreview = false;
    if (this.snapshot.card) this.lastVisibleAt = Date.now();
    this.emit(HIDDEN);
  }

  destroy(): void {
    this.clearShowTimer();
    this.clearGraceTimer();
    this.clearExitTimer();
    this.listeners.clear();
  }

  private open(card: PreviewCard, options: PreviewShowOptions, sticky: boolean): void {
    this.clearExitTimer();
    this.lastVisibleAt = Date.now();
    this.emit({
      phase: "open",
      card,
      sticky,
      showBackFace: card.isTransformed,
      mousePos: options.pointer ?? this.snapshot.mousePos,
      anchorRect: options.anchorRect ?? null,
      placement: options.placement ?? "auto",
    });
  }

  private close(): void {
    if (this.snapshot.phase !== "open") return;
    this.pointerOnPreview = false;
    this.lastVisibleAt = Date.now();
    this.emit({ ...this.snapshot, phase: "closing" });
    this.exitTimer = setTimeout(() => {
      this.exitTimer = null;
      this.emit(HIDDEN);
    }, PREVIEW_TIMING.exitMs);
  }

  private emit(snapshot: PreviewSnapshot): void {
    if (snapshot === this.snapshot) return;
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  private clearShowTimer(): void {
    if (this.showTimer !== null) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
  }

  private clearGraceTimer(): void {
    if (this.graceTimer !== null) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }

  private clearExitTimer(): void {
    if (this.exitTimer !== null) {
      clearTimeout(this.exitTimer);
      this.exitTimer = null;
    }
  }
}
