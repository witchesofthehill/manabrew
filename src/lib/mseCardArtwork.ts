import type { MseCanvas, MseRaster, MseRenderResult } from "@mse-renderer";
import { loadScryfallImage } from "@/lib/scryfallImageSource";

export const MSE_CARD_WIDTH = 375;
export const MSE_CARD_HEIGHT = 525;
export const MSE_ARTWORK_FACE_FRAGMENT = "#manabrew-mse-art-face=";
const MAX_ARTWORK_BYTES = 32 * 1024 * 1024;
const artwork = new Map<string, MseRaster>();
const pendingArtwork = new Map<string, Promise<MseRaster>>();
let artworkBytes = 0;

export interface MseCardArtwork {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  inkColor: string;
}

const rulesBounds = new WeakMap<MseCanvas, readonly MseCardArtwork[]>();

export function getMseCardRules(canvas: MseCanvas): readonly MseCardArtwork[] {
  return rulesBounds.get(canvas) ?? [];
}

export function createMseCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function decodeArtwork(url: string): Promise<MseRaster> {
  const separator = url.lastIndexOf(MSE_ARTWORK_FACE_FRAGMENT);
  if (separator >= 0) {
    const faceIndex = Number(url.slice(separator + MSE_ARTWORK_FACE_FRAGMENT.length));
    if (faceIndex !== 0 && faceIndex !== 1) throw new Error("Invalid multipart artwork face");
    const source = await loadMseCardArtwork(url.slice(0, separator));
    const horizontal = source.width >= source.height;
    const start = faceIndex * Math.floor((horizontal ? source.width : source.height) / 2);
    const width = horizontal
      ? faceIndex === 0
        ? Math.floor(source.width / 2)
        : source.width - start
      : source.width;
    const height = horizontal
      ? source.height
      : faceIndex === 0
        ? Math.floor(source.height / 2)
        : source.height - start;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row += 1) {
      const offset =
        ((row + (horizontal ? 0 : start)) * source.width + (horizontal ? start : 0)) * 4;
      data.set(source.data.subarray(offset, offset + width * 4), row * width * 4);
    }
    return { width, height, data, hasAlpha: source.hasAlpha };
  }
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = await loadScryfallImage(url);
  await image.decode();
  const canvas = createMseCanvas(image.naturalWidth, image.naturalHeight);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("MSE artwork requires a 2D canvas context");
  context.drawImage(image, 0, 0);
  return {
    width: canvas.width,
    height: canvas.height,
    data: context.getImageData(0, 0, canvas.width, canvas.height).data,
    hasAlpha: true,
  };
}

export function loadMseCardArtwork(url: string): Promise<MseRaster> {
  const cached = artwork.get(url);
  if (cached) {
    artwork.delete(url);
    artwork.set(url, cached);
    return Promise.resolve(cached);
  }
  const existing = pendingArtwork.get(url);
  if (existing) return existing;
  const pending = decodeArtwork(url)
    .then((raster) => {
      if (raster.data.byteLength <= MAX_ARTWORK_BYTES) {
        while (artworkBytes + raster.data.byteLength > MAX_ARTWORK_BYTES) {
          const oldest = artwork.entries().next().value;
          if (!oldest) break;
          artworkBytes -= oldest[1].data.byteLength;
          artwork.delete(oldest[0]);
        }
        artwork.set(url, raster);
        artworkBytes += raster.data.byteLength;
      }
      return raster;
    })
    .finally(() => pendingArtwork.delete(url));
  pendingArtwork.set(url, pending);
  return pending;
}

export function normalizeMseCanvas(result: MseRenderResult): MseCanvas {
  const { width, height, context } = result;
  const landscape = width > height;
  const canvas = createMseCanvas(MSE_CARD_WIDTH, MSE_CARD_HEIGHT);
  const drawing = canvas.getContext("2d");
  if (!drawing) throw new Error("MSE rendering requires a 2D canvas context");
  if (landscape) {
    drawing.translate(0, canvas.height);
    drawing.rotate(-Math.PI / 2);
    drawing.drawImage(result.canvas, 0, 0, canvas.height, canvas.width);
  } else {
    drawing.drawImage(result.canvas, 0, 0, canvas.width, canvas.height);
  }
  const rules: MseCardArtwork[] = [];
  for (const { name, ...typography } of result.rulesFields) {
    const x = Number(context.property(name, "left", "card"));
    const y = Number(context.property(name, "top", "card"));
    const w = Number(context.property(name, "width", "card"));
    const h = Number(context.property(name, "height", "card"));
    const angle = -Number(context.property(name, "angle", "card")) || 0;
    if (![x, y, w, h, angle].every(Number.isFinite) || w <= 0 || h <= 0) continue;
    const radians = (angle * Math.PI) / 180;
    const corners = [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ].map(([dx = 0, dy = 0]) => {
      const nativeX = x + dx * Math.cos(radians) - dy * Math.sin(radians);
      const nativeY = y + dx * Math.sin(radians) + dy * Math.cos(radians);
      return landscape
        ? [(nativeY * canvas.width) / height, ((width - nativeX) * canvas.height) / width]
        : [(nativeX * canvas.width) / width, (nativeY * canvas.height) / height];
    });
    const left = Math.max(0, Math.min(...corners.map((point) => point[0]!)));
    const top = Math.max(0, Math.min(...corners.map((point) => point[1]!)));
    const right = Math.min(canvas.width, Math.max(...corners.map((point) => point[0]!)));
    const bottom = Math.min(canvas.height, Math.max(...corners.map((point) => point[1]!)));
    if (right <= left || bottom <= top) continue;
    const bounds = Object.freeze({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      angle: (((angle - (landscape ? 90 : 0)) % 360) + 360) % 360,
      ...typography,
    });
    rules.push(bounds);
  }
  rulesBounds.set(canvas, Object.freeze(rules));
  return canvas;
}
