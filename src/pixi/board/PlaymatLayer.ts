import {
  BlurFilter,
  ColorMatrixFilter,
  Container,
  Graphics,
  ImageSource,
  Sprite,
  Texture,
  TilingSprite,
} from "pixi.js";
import type { PlaymatSettings } from "@/protocol/game";
import { getTheme, type GameTheme } from "@/hooks/useTheme";
import type { PlayZoneRect } from "../types";
import { TABLE_RADIUS } from "../constants";
import { hexToNum } from "../colorUtils";
import { safeDestroy } from "./pixiHelpers";

export const DEFAULT_PLAYMAT_SETTINGS: Required<PlaymatSettings> = {
  opacity: 0.62,
  texture: 0.5,
  borderWidth: 2,
  get borderColor() {
    return getTheme().gameTheme.canvas.neutral;
  },
  fit: "cover",
  offsetX: 0.5,
  offsetY: 0.5,
  zoom: 1,
  blur: 0,
  brightness: 1,
  color: "",
};

export const PLAYMAT_ZOOM_MIN = 1;
export const PLAYMAT_ZOOM_MAX = 4;
export const clampPlaymatZoom = (z: number): number =>
  Math.max(PLAYMAT_ZOOM_MIN, Math.min(PLAYMAT_ZOOM_MAX, Number.isFinite(z) ? z : 1));

export const PLAYMAT_BLUR_MAX = 20;
export const PLAYMAT_BRIGHTNESS_MIN = 0.3;
export const PLAYMAT_BRIGHTNESS_MAX = 1.5;
export const clampPlaymatBlur = (b: number): number =>
  Math.max(0, Math.min(PLAYMAT_BLUR_MAX, Number.isFinite(b) ? b : 0));
export const clampPlaymatBrightness = (b: number): number =>
  Math.max(PLAYMAT_BRIGHTNESS_MIN, Math.min(PLAYMAT_BRIGHTNESS_MAX, Number.isFinite(b) ? b : 1));

const PLAYMAT_DROP_DIM = 0.29;
const PLAYMAT_PADDING = 0.04;
export const playmatPad = (width: number, height: number): number =>
  Math.min(width, height) * PLAYMAT_PADDING;
const PLAYMAT_VIGNETTE_ALPHA = 0.42;
const PLAYMAT_FABRIC_TILE_SCALE = 0.6;
const PLAYMAT_FABRIC_MAX_ALPHA = 0.2;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

const BACKGROUND_LIGHTNESS_MIN = 0.03;
const BACKGROUND_LIGHTNESS_MAX = 0.4;
const BACKGROUND_SATURATION_MAX = 0.5;

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function clampColor(hex: string, lMin: number, lMax: number, sMax: number): string {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return getTheme().gameTheme.canvas.background;
  const int = parseInt(match[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  const cl = Math.min(lMax, Math.max(lMin, l));
  const cs = Math.min(sMax, s);
  let cr: number;
  let cg: number;
  let cb: number;
  if (cs === 0) {
    cr = cg = cb = cl;
  } else {
    const q = cl < 0.5 ? cl * (1 + cs) : cl + cs - cl * cs;
    const p = 2 * cl - q;
    cr = hue2rgb(p, q, h + 1 / 3);
    cg = hue2rgb(p, q, h);
    cb = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (v: number) =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(cr)}${toHex(cg)}${toHex(cb)}`;
}

export const clampPlaymatColor = (hex: string): string =>
  clampColor(hex, BACKGROUND_LIGHTNESS_MIN, BACKGROUND_LIGHTNESS_MAX, BACKGROUND_SATURATION_MAX);

const materialTextures = new Map<"fabric" | "vignette" | "light", Texture>();

function getMaterialTexture(kind: "fabric" | "vignette" | "light"): Texture {
  const cached = materialTextures.get(kind);
  if (cached) return cached;
  const size = kind === "fabric" ? 64 : 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const pixels = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      const distance = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2;
      const weave = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0;
      const grain = ((x * 37 + y * 17 + x * y * 13) % 31) / 31;
      const alpha =
        kind === "fabric"
          ? (weave ? 0.35 : 0.65) + grain * 0.2
          : kind === "light"
            ? Math.pow(Math.max(0, 1 - distance), 2)
            : Math.pow(clamp01((distance - 0.25) / 0.95), 2);
      pixels.data[offset] = 255;
      pixels.data[offset + 1] = 255;
      pixels.data[offset + 2] = 255;
      pixels.data[offset + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(pixels, 0, 0);
  const texture = Texture.from(canvas);
  materialTextures.set(kind, texture);
  return texture;
}

export class PlaymatLayer {
  readonly container: Container;
  private content: Container;
  private colorFill: Graphics;
  private image: Sprite;
  private fabric: TilingSprite;
  private vignette: Sprite;
  private lightPool: Sprite;
  private seatLight: Sprite;
  private overlays: (Sprite | TilingSprite)[];
  private border: Graphics;
  private mask: Graphics;
  private imageTexture: Texture | null = null;
  private blurFilter = new BlurFilter({ strength: 0, quality: 4 });
  private brightnessFilter = new ColorMatrixFilter();
  private url: string | null = null;
  private settings: Required<PlaymatSettings> = { ...DEFAULT_PLAYMAT_SETTINGS };
  private rect: PlayZoneRect | null = null;
  private dropActive = false;
  private mirrored = false;
  private seatColor: string | null = null;
  private seatActive = false;
  private materialDirty = true;
  private materialTheme: GameTheme | null = null;
  private insetRect: PlayZoneRect = { x: 0, y: 0, width: 0, height: 0 };

  constructor() {
    this.container = new Container();
    this.container.eventMode = "none";
    this.container.visible = false;

    this.content = new Container();
    this.colorFill = new Graphics();
    this.image = new Sprite();
    this.image.anchor.set(0.5);
    this.image.visible = false;
    this.fabric = new TilingSprite({ texture: getMaterialTexture("fabric") });
    this.fabric.tileScale.set(PLAYMAT_FABRIC_TILE_SCALE);
    this.vignette = new Sprite(getMaterialTexture("vignette"));
    this.vignette.alpha = PLAYMAT_VIGNETTE_ALPHA;
    this.lightPool = new Sprite(getMaterialTexture("light"));
    this.lightPool.alpha = 0.08;
    this.seatLight = new Sprite(getMaterialTexture("light"));
    this.seatLight.visible = false;
    this.overlays = [this.fabric, this.vignette, this.lightPool, this.seatLight];
    this.content.addChild(this.colorFill, this.image, ...this.overlays);

    this.mask = new Graphics();
    this.border = new Graphics();
    this.container.addChild(this.content, this.mask, this.border);
    this.content.mask = this.mask;
    this.applySettings();
  }

  setImage(url: string | undefined): void {
    const next = url ?? null;
    if (next === this.url) return;
    this.url = next;
    if (!next) {
      this.imageTexture?.destroy(true);
      this.imageTexture = null;
      this.image.visible = false;
      this.updateVisibility();
      if (this.rect) this.layout(this.rect, { dropActive: this.dropActive });
      return;
    }
    const img = new Image();
    this.materialDirty = true;
    // The blur and brightness filters read this texture back through WebGL,
    // which throws on a tainted cross-origin image.
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (this.container.destroyed) return;
      if (this.url !== next) return;
      this.imageTexture?.destroy(true);
      this.imageTexture = new Texture({ source: new ImageSource({ resource: img }) });
      this.materialDirty = true;
      this.image.texture = this.imageTexture;
      this.image.visible = true;
      this.updateVisibility();
      if (this.rect) this.layout(this.rect, { dropActive: this.dropActive });
    };
    img.src = next;
  }

  setSettings(settings: PlaymatSettings | undefined): void {
    this.settings = { ...DEFAULT_PLAYMAT_SETTINGS, ...(settings ?? {}) };
    this.materialDirty = true;
    this.applySettings();
    this.updateVisibility();
    if (this.rect) this.layout(this.rect, { dropActive: this.dropActive });
  }

  setMirrored(mirrored: boolean): void {
    if (mirrored === this.mirrored) return;
    this.mirrored = mirrored;
    this.materialDirty = true;
    if (this.rect) this.layout(this.rect, { dropActive: this.dropActive });
  }

  private updateVisibility(): void {
    this.container.visible = this.rect !== null;
  }

  private applySettings(): void {
    this.fabric.alpha = clamp01(this.settings.texture) * PLAYMAT_FABRIC_MAX_ALPHA;

    const blur = clampPlaymatBlur(this.settings.blur);
    const brightness = clampPlaymatBrightness(this.settings.brightness);
    const filters: (BlurFilter | ColorMatrixFilter)[] = [];
    if (brightness !== 1) {
      this.brightnessFilter.brightness(brightness, false);
      filters.push(this.brightnessFilter);
    }
    if (blur > 0) {
      this.blurFilter.strength = blur;
      filters.push(this.blurFilter);
    }
    this.image.filters = filters;
  }

  setSeatState(color: string, active: boolean): void {
    if (this.seatColor === color && this.seatActive === active) return;
    const colorChanged = this.seatColor !== color;
    this.seatColor = color;
    this.seatActive = active;
    this.seatLight.tint = hexToNum(color);
    this.seatLight.alpha = active ? 0.18 : 0.045;
    this.seatLight.visible = true;
    this.lightPool.alpha = active ? 0.12 : 0.08;
    if (colorChanged) {
      this.materialDirty = true;
      if (this.rect) this.layout(this.rect, { dropActive: this.dropActive });
    }
  }

  layout(rect: PlayZoneRect, opts: { dropActive: boolean }): void {
    this.rect = rect;
    this.dropActive = opts.dropActive;
    this.updateVisibility();
    const opacity = clamp01(this.settings.opacity);
    this.content.alpha = opts.dropActive ? opacity * PLAYMAT_DROP_DIM : opacity;
    this.border.alpha = 1;
    const gt = getTheme().gameTheme;
    const pad = playmatPad(rect.width, rect.height);
    const x = rect.x + pad;
    const y = rect.y + pad;
    const width = Math.max(1, rect.width - pad * 2);
    const height = Math.max(1, rect.height - pad * 2);
    const r = this.insetRect;
    if (
      !this.materialDirty &&
      this.materialTheme === gt &&
      r.x === x &&
      r.y === y &&
      r.width === width &&
      r.height === height
    )
      return;
    this.materialDirty = false;
    this.materialTheme = gt;
    r.x = x;
    r.y = y;
    r.width = width;
    r.height = height;
    this.fabric.tint = hexToNum(gt.canvas.shadow);
    this.vignette.tint = hexToNum(gt.canvas.shadow);
    this.lightPool.tint = hexToNum(gt.textOnTinted);

    this.colorFill.clear();
    this.colorFill.rect(r.x, r.y, r.width, r.height);
    this.colorFill.fill({
      color: hexToNum(
        this.settings.color ? clampPlaymatColor(this.settings.color) : gt.canvas.background,
      ),
    });

    const tw = this.image.texture.width || 1;
    const th = this.image.texture.height || 1;
    const sx = r.width / tw;
    const sy = r.height / th;
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    // Opponent mats read as their own mat rotated 180°: spin the sprite about its
    // centre (bounds unchanged) and mirror the cover-fit offset so the framing
    // rotates with it.
    this.image.rotation = this.mirrored ? Math.PI : 0;
    if (this.settings.fit === "stretch") {
      this.image.scale.set(sx, sy);
      this.image.x = cx;
      this.image.y = cy;
    } else if (this.settings.fit === "fit") {
      this.image.scale.set(Math.min(sx, sy));
      this.image.x = cx;
      this.image.y = cy;
    } else {
      const scale = Math.max(sx, sy) * clampPlaymatZoom(this.settings.zoom);
      this.image.scale.set(scale);
      const ox = clamp01(this.mirrored ? 1 - this.settings.offsetX : this.settings.offsetX);
      const oy = clamp01(this.mirrored ? 1 - this.settings.offsetY : this.settings.offsetY);
      this.image.x = cx + (0.5 - ox) * (tw * scale - r.width);
      this.image.y = cy + (0.5 - oy) * (th * scale - r.height);
    }

    for (const overlay of this.overlays) {
      overlay.x = r.x;
      overlay.y = r.y;
      overlay.width = r.width;
      overlay.height = r.height;
    }

    this.mask.clear();
    this.mask.roundRect(r.x, r.y, r.width, r.height, TABLE_RADIUS);
    this.mask.fill({ color: hexToNum(gt.canvas.neutral) });

    this.border.clear();
    const bw = this.settings.borderWidth;
    if (bw > 0) {
      this.border.roundRect(
        r.x + bw / 2,
        r.y + bw / 2,
        r.width - bw,
        r.height - bw,
        Math.max(0, TABLE_RADIUS - bw / 2),
      );
      this.border.stroke({
        width: bw,
        color: hexToNum(this.seatColor ?? gt.canvas.neutral),
      });
    }
  }

  destroy(): void {
    this.content.mask = null;
    safeDestroy(this.container);
    this.imageTexture?.destroy(true);
    this.imageTexture = null;
  }
}
