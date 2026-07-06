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
import type { PlayZoneRect } from "../types";
import { TABLE_RADIUS } from "../constants";
import { hexToNum } from "../colorUtils";
import { safeDestroy } from "./pixiHelpers";

export const DEFAULT_PLAYMAT_SETTINGS: Required<PlaymatSettings> = {
  opacity: 0.62,
  texture: 0.5,
  borderWidth: 2,
  borderColor: "#27272a",
  fit: "cover",
  offsetX: 0.5,
  offsetY: 0.5,
  zoom: 1,
  blur: 0,
  brightness: 1,
  color: "",
};

/** Bounds for the playmat zoom (uniform resize) in `cover` fit. */
export const PLAYMAT_ZOOM_MIN = 1;
export const PLAYMAT_ZOOM_MAX = 4;
export const clampPlaymatZoom = (z: number): number =>
  Math.max(PLAYMAT_ZOOM_MIN, Math.min(PLAYMAT_ZOOM_MAX, Number.isFinite(z) ? z : 1));

/** Render-time readability filters applied to the playmat image. */
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
const PLAYMAT_VIGNETTE_ALPHA = 0.7;
const PLAYMAT_TINT = 0xe4e4e4;
const PLAYMAT_FABRIC_TILE_SCALE = 0.6;
const PLAYMAT_FABRIC_MAX_ALPHA = 0.75;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

const BORDER_LIGHTNESS_MIN = 0.04;
const BORDER_LIGHTNESS_MAX = 0.42;
const BORDER_SATURATION_MAX = 0.5;
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
  if (!match) return "#000000";
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

export const clampBorderColor = (hex: string): string =>
  clampColor(hex, BORDER_LIGHTNESS_MIN, BORDER_LIGHTNESS_MAX, BORDER_SATURATION_MAX);

export const clampPlaymatColor = (hex: string): string =>
  clampColor(hex, BACKGROUND_LIGHTNESS_MIN, BACKGROUND_LIGHTNESS_MAX, BACKGROUND_SATURATION_MAX);

let fabricTextureCache: Texture | null = null;
function getFabricTexture(): Texture {
  if (fabricTextureCache) return fabricTextureCache;
  const tile = 64;
  const cell = 8;
  const canvas = document.createElement("canvas");
  canvas.width = tile;
  canvas.height = tile;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Texture.EMPTY;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, tile, tile);
  for (let y = 0; y < tile; y += cell) {
    for (let x = 0; x < tile; x += cell) {
      const over = (x / cell + y / cell) % 2 === 0;
      ctx.fillStyle = over ? "rgba(0,0,0,0.05)" : "rgba(0,0,0,0.11)";
      ctx.fillRect(x, y, cell, cell);
    }
  }
  ctx.strokeStyle = "rgba(0,0,0,0.07)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= tile; i += cell) {
    ctx.beginPath();
    ctx.moveTo(i + 0.5, 0);
    ctx.lineTo(i + 0.5, tile);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i + 0.5);
    ctx.lineTo(tile, i + 0.5);
    ctx.stroke();
  }
  fabricTextureCache = Texture.from(canvas);
  return fabricTextureCache;
}

let vignetteTextureCache: Texture | null = null;
function getVignetteTexture(): Texture {
  if (vignetteTextureCache) return vignetteTextureCache;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Texture.EMPTY;
  const c = size / 2;
  const gradient = ctx.createRadialGradient(c, c, size * 0.3, c, c, size * 0.62);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.75, "rgba(0,0,0,0.35)");
  gradient.addColorStop(1, "rgba(0,0,0,0.92)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  vignetteTextureCache = Texture.from(canvas);
  return vignetteTextureCache;
}

export class PlaymatLayer {
  readonly container: Container;
  private content: Container;
  private colorFill: Graphics;
  private image: Sprite;
  private fabric: TilingSprite;
  private vignette: Sprite;
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

  constructor() {
    this.container = new Container();
    this.container.eventMode = "none";
    this.container.visible = false;

    this.content = new Container();
    this.colorFill = new Graphics();
    this.image = new Sprite();
    this.image.anchor.set(0.5);
    this.image.tint = PLAYMAT_TINT;
    this.image.visible = false;
    this.fabric = new TilingSprite({ texture: getFabricTexture() });
    this.fabric.tileScale.set(PLAYMAT_FABRIC_TILE_SCALE);
    this.fabric.blendMode = "multiply";
    this.vignette = new Sprite(getVignetteTexture());
    this.vignette.alpha = PLAYMAT_VIGNETTE_ALPHA;
    this.content.addChild(this.colorFill, this.image, this.fabric, this.vignette);

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
    img.onload = () => {
      if (this.url !== next) return;
      this.imageTexture?.destroy(true);
      this.imageTexture = new Texture({ source: new ImageSource({ resource: img }) });
      this.image.texture = this.imageTexture;
      this.image.visible = true;
      this.updateVisibility();
      if (this.rect) this.layout(this.rect, { dropActive: this.dropActive });
    };
    img.src = next;
  }

  setSettings(settings: PlaymatSettings | undefined): void {
    this.settings = { ...DEFAULT_PLAYMAT_SETTINGS, ...(settings ?? {}) };
    this.applySettings();
    this.updateVisibility();
    if (this.rect) this.layout(this.rect, { dropActive: this.dropActive });
  }

  setMirrored(mirrored: boolean): void {
    if (mirrored === this.mirrored) return;
    this.mirrored = mirrored;
    if (this.rect) this.layout(this.rect, { dropActive: this.dropActive });
  }

  private updateVisibility(): void {
    this.container.visible = !!this.url || !!this.settings.color;
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

  layout(rect: PlayZoneRect, opts: { dropActive: boolean }): void {
    this.rect = rect;
    this.dropActive = opts.dropActive;

    const pad = playmatPad(rect.width, rect.height);
    const r = {
      x: rect.x + pad,
      y: rect.y + pad,
      width: Math.max(1, rect.width - pad * 2),
      height: Math.max(1, rect.height - pad * 2),
    };

    this.colorFill.clear();
    if (this.settings.color) {
      this.colorFill.rect(r.x, r.y, r.width, r.height);
      this.colorFill.fill({ color: hexToNum(clampPlaymatColor(this.settings.color)) });
    }

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

    for (const overlay of [this.fabric, this.vignette]) {
      overlay.x = r.x;
      overlay.y = r.y;
      overlay.width = r.width;
      overlay.height = r.height;
    }

    this.mask.clear();
    this.mask.roundRect(r.x, r.y, r.width, r.height, TABLE_RADIUS);
    this.mask.fill({ color: 0xffffff });

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
        color: hexToNum(clampBorderColor(this.settings.borderColor)),
      });
    }

    const opacity = clamp01(this.settings.opacity);
    this.content.alpha = opts.dropActive ? opacity * PLAYMAT_DROP_DIM : opacity;
    this.border.alpha = this.content.alpha;
  }

  destroy(): void {
    this.content.mask = null;
    safeDestroy(this.container);
    this.imageTexture?.destroy(true);
    this.imageTexture = null;
  }
}
