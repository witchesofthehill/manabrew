import { gsap } from "@/pixi/effects/gsap";
import { animationsEnabled, subscribeAnimationsEnabled } from "@/pixi/effects/enabled";
import { PREVIEW_TIMING } from "@/lib/cardPreview";

export class PreviewFlipAnimation {
  private readonly pose = { progress: 0 };
  private complete: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly apply: (scale: number) => void;
  readonly isReady: () => boolean;

  constructor(apply: (scale: number) => void, isReady: () => boolean) {
    this.apply = apply;
    this.isReady = isReady;
  }

  get scale(): number {
    return Math.cos((this.pose.progress * Math.PI) / 2);
  }

  close(): Promise<void> {
    this.stop();
    return new Promise<void>((resolve) => {
      this.complete = resolve;
      this.animate(1);
    });
  }

  open(): void {
    this.stop();
    this.animate(0);
  }

  setClosed(): void {
    this.stop();
    this.pose.progress = 1;
    this.apply(this.scale);
  }

  cancel(): void {
    this.stop();
    this.pose.progress = 0;
    this.apply(1);
  }

  private stop(): void {
    gsap.killTweensOf(this.pose);
    this.complete?.();
    this.complete = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private animate(progress: number): void {
    if (!animationsEnabled()) {
      this.pose.progress = progress;
      this.apply(this.scale);
      this.complete?.();
      this.complete = null;
      return;
    }
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const policyChanged = () => {
      if (animationsEnabled()) return;
      this.stop();
      this.pose.progress = progress;
      this.apply(this.scale);
    };
    const unsubscribe = subscribeAnimationsEnabled(policyChanged);
    media.addEventListener("change", policyChanged);
    this.unsubscribe = () => {
      unsubscribe();
      media.removeEventListener("change", policyChanged);
    };
    gsap.to(this.pose, {
      progress,
      duration: (PREVIEW_TIMING.flipHalfMs / 1000) * Math.abs(progress - this.pose.progress),
      ease: "none",
      onUpdate: () => this.apply(this.scale),
      onComplete: () => {
        this.complete?.();
        this.complete = null;
        this.unsubscribe?.();
        this.unsubscribe = null;
      },
    });
  }
}
