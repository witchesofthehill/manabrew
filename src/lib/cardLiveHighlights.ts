import { CARD_RENDER_WIDTH } from "@/lib/cardRenderGeometry";

export const CARD_LIVE_PULSE = {
  minScale: 1,
  maxScale: 1.055,
  floatPx: 1.25,
  halfDurationS: 1.8,
} as const;

export interface CardLiveHighlightRegion {
  readonly x: number;
  readonly y: number;
  readonly ink: HTMLCanvasElement;
  readonly paper: HTMLCanvasElement;
}

export interface CardLiveHighlightLayers {
  readonly width: number;
  readonly height: number;
  readonly floatPx: number;
  readonly regions: readonly CardLiveHighlightRegion[];
}

const highlights = new WeakMap<object, CardLiveHighlightLayers>();
const WORD_JOIN_DISTANCE = 3;
const MATTE_COLOR_TOLERANCE = 3;

export function getCardLiveHighlights(source: object): CardLiveHighlightLayers | undefined {
  return highlights.get(source);
}

export function copyCardLiveHighlights(from: object, to: object): void {
  const layers = highlights.get(from);
  if (layers) highlights.set(to, layers);
  else highlights.delete(to);
}

function extractInk(
  canvas: HTMLCanvasElement,
  backing: HTMLCanvasElement,
  colors: readonly string[],
): ImageData {
  const painted = canvas.getContext("2d");
  const paper = backing.getContext("2d");
  if (!painted || !paper) throw new Error("Card highlighting requires a 2D canvas context");
  const ink = painted.getImageData(0, 0, canvas.width, canvas.height);
  const baseline = paper.getImageData(0, 0, canvas.width, canvas.height).data;
  const palette = colors.map((hex) =>
    [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)),
  );
  const pixels = ink.data;
  for (let i = 0; i < pixels.length; i += 4) {
    let difference = 0;
    for (let c = 0; c < 3; c++)
      difference = Math.max(difference, Math.abs(pixels[i + c]! - baseline[i + c]!));
    if (difference === 0) {
      pixels[i + 3] = 0;
      continue;
    }
    let bestError = Number.POSITIVE_INFINITY;
    let coverage = 0;
    let selected: readonly number[] | undefined;
    for (const color of palette) {
      let channel = 0;
      for (let c = 1; c < 3; c++) {
        if (
          Math.abs(color[c]! - baseline[i + c]!) >
          Math.abs(color[channel]! - baseline[i + channel]!)
        )
          channel = c;
      }
      const distance = color[channel]! - baseline[i + channel]!;
      if (distance === 0) continue;
      const alpha = Math.max(
        0,
        Math.min(1, (pixels[i + channel]! - baseline[i + channel]!) / distance),
      );
      let error = 0;
      for (let c = 0; c < 3; c++)
        error += Math.abs(
          pixels[i + c]! - (baseline[i + c]! + (color[c]! - baseline[i + c]!) * alpha),
        );
      if (error < bestError) {
        bestError = error;
        coverage = alpha;
        selected = color;
      }
    }
    if (selected && bestError <= MATTE_COLOR_TOLERANCE) {
      for (let c = 0; c < 3; c++) pixels[i + c] = selected[c]!;
    } else {
      coverage = 0;
      for (let c = 0; c < 3; c++) {
        const original = baseline[i + c]!;
        const value = pixels[i + c]!;
        const alpha =
          value < original
            ? (original - value) / original
            : value > original
              ? (value - original) / (255 - original)
              : 0;
        coverage = Math.max(coverage, alpha);
      }
      for (let c = 0; c < 3; c++)
        pixels[i + c] = Math.round((pixels[i + c]! - baseline[i + c]! * (1 - coverage)) / coverage);
    }
    pixels[i + 3] = Math.round(coverage * 255);
  }
  return ink;
}

function wordComponents(ink: ImageData, joinDistance: number): number[][] {
  const { width, height, data } = ink;
  const visited = new Uint8Array(width * height);
  const components: number[][] = [];
  for (let start = 0; start < visited.length; start++) {
    if (visited[start] || !data[start * 4 + 3]) continue;
    const component = [start];
    visited[start] = 1;
    for (let cursor = 0; cursor < component.length; cursor++) {
      const pixel = component[cursor]!;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      for (
        let row = Math.max(0, y - joinDistance);
        row <= Math.min(height - 1, y + joinDistance);
        row++
      ) {
        for (
          let col = Math.max(0, x - joinDistance);
          col <= Math.min(width - 1, x + joinDistance);
          col++
        ) {
          const neighbor = row * width + col;
          if (visited[neighbor] || !data[neighbor * 4 + 3]) continue;
          visited[neighbor] = 1;
          component.push(neighbor);
        }
      }
    }
    components.push(component);
  }
  return components;
}

export function registerCardLiveHighlights(
  canvas: HTMLCanvasElement,
  backing: HTMLCanvasElement,
  colors: readonly string[],
): void {
  const ink = extractInk(canvas, backing, colors);
  const density = canvas.width / CARD_RENDER_WIDTH;
  const floatPx = CARD_LIVE_PULSE.floatPx * density;
  const regions: CardLiveHighlightRegion[] = [];
  for (const component of wordComponents(ink, Math.round(WORD_JOIN_DISTANCE * density))) {
    let left = ink.width;
    let right = 0;
    let top = ink.height;
    let bottom = 0;
    for (const pixel of component) {
      const x = pixel % ink.width;
      const y = Math.floor(pixel / ink.width);
      left = Math.min(left, x);
      right = Math.max(right, x + 1);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y + 1);
    }
    const padding = Math.max(
      2,
      Math.ceil(Math.max(right - left, bottom - top) * (CARD_LIVE_PULSE.maxScale - 1) + floatPx),
    );
    const x = Math.max(0, left - padding);
    const y = Math.max(0, top - padding);
    const width = Math.min(ink.width, right + padding) - x;
    const height = Math.min(ink.height, bottom + padding) - y;
    const foreground = document.createElement("canvas");
    const paper = document.createElement("canvas");
    foreground.width = paper.width = width;
    foreground.height = paper.height = height;
    const drawing = foreground.getContext("2d");
    const background = paper.getContext("2d");
    if (!drawing || !background) throw new Error("Card highlighting requires a 2D canvas context");
    const crop = drawing.createImageData(width, height);
    for (const pixel of component) {
      const destination =
        ((Math.floor(pixel / ink.width) - y) * width + (pixel % ink.width) - x) * 4;
      for (let c = 0; c < 4; c++) crop.data[destination + c] = ink.data[pixel * 4 + c]!;
    }
    drawing.putImageData(crop, 0, 0);
    background.drawImage(backing, x, y, width, height, 0, 0, width, height);
    regions.push({ x, y, ink: foreground, paper });
  }
  if (regions.length)
    highlights.set(canvas, { width: canvas.width, height: canvas.height, floatPx, regions });
}
