import type { Application } from "pixi.js";
import { isCoarsePointer } from "@/lib/responsive";
import { PIXI_MAX_FPS } from "../constants";

const MAX_BACKING_PIXELS = 8_388_608;
const MIN_FRAME_INTERVAL_MS = 1000 / PIXI_MAX_FPS;
const PHONE_SHORT_EDGE = 700;
const PHONE_RESOLUTION_CAP = 1.5;
const DEFAULT_RESOLUTION_CAP = 2;

export function overlayResolution(width: number, height: number): number {
  const dpr = window.devicePixelRatio || 1;
  const shortEdge = Math.min(width, height);
  const deviceCap =
    isCoarsePointer() && shortEdge < PHONE_SHORT_EDGE
      ? PHONE_RESOLUTION_CAP
      : DEFAULT_RESOLUTION_CAP;
  const pixelCap =
    width > 0 && height > 0
      ? Math.sqrt(MAX_BACKING_PIXELS / (width * height))
      : DEFAULT_RESOLUTION_CAP;
  return Math.min(dpr, deviceCap, pixelCap);
}

type FrameUpdate = (deltaMs: number) => boolean;

export class OverlayRenderScheduler {
  private frameId: number | null = null;
  private lastTimestamp = 0;
  private pending = false;
  private disposed = false;
  private readonly app: Application;
  private readonly update: FrameUpdate;

  constructor(app: Application, update: FrameUpdate) {
    this.app = app;
    this.update = update;
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  request(): void {
    if (this.disposed) return;
    this.pending = true;
    this.schedule();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      if (this.frameId !== null) cancelAnimationFrame(this.frameId);
      this.frameId = null;
      this.lastTimestamp = 0;
      return;
    }
    this.pending = true;
    this.schedule();
  };

  private schedule(): void {
    if (this.frameId !== null || document.hidden || this.disposed) return;
    this.frameId = requestAnimationFrame(this.renderFrame);
  }

  private readonly renderFrame = (timestamp: number): void => {
    this.frameId = null;
    if (this.disposed || document.hidden) return;
    if (this.lastTimestamp !== 0 && timestamp - this.lastTimestamp < MIN_FRAME_INTERVAL_MS) {
      this.schedule();
      return;
    }

    const deltaMs = this.lastTimestamp === 0 ? 0 : timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;
    this.pending = false;
    const active = this.update(deltaMs);
    this.app.render();

    if (active || this.pending) {
      this.schedule();
    } else {
      this.lastTimestamp = 0;
    }
  };
}
