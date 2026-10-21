import { closeRaster, rasterCanvas } from "card-glint/canvas";
import type { CanvasRaster } from "card-glint/canvas";

const scratch = new Map<CanvasRaster, number>();
let bytes = 0;
let peakBytes = 0;

export function createCardScratchCanvas(
  width: number,
  height: number,
  offscreen = false,
): CanvasRaster {
  const canvas =
    offscreen && typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(width, height)
      : rasterCanvas([width, height]);
  const size = width * height * 4;
  scratch.set(canvas, size);
  bytes += size;
  peakBytes = Math.max(peakBytes, bytes);
  return canvas;
}

export function closeCardScratchCanvas(canvas: CanvasRaster): void {
  const size = scratch.get(canvas);
  if (size !== undefined) {
    scratch.delete(canvas);
    bytes -= size;
  }
  closeRaster(canvas);
}

export function cardScratchStats() {
  return { scratchBytes: bytes, peakScratchBytes: peakBytes, scratchCanvases: scratch.size };
}
