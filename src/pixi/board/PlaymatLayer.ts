import { Container, Graphics, ImageSource, Sprite, Texture, TilingSprite } from "pixi.js";
import type { PlaymatSettings } from "@/types/manabrew";
import type { PlayZoneRect } from "../types";
import { TABLE_RADIUS } from "../constants";
import { hexToNum } from "../colorUtils";
import { safeDestroy } from "./pixiHelpers";

export const DEFAULT_PLAYMAT_SETTINGS: Required<PlaymatSettings> = {
  opacity: 0.62,
  texture: 0.5,
  borderWidth: 2,
  borderColor: "#000000",
  fit: "cover",
  offsetX: 0.5,
  offsetY: 0.5,
  color: "",
};

const PLAYMAT_DROP_DIM = 0.29;
const PLAYMAT_VIGNETTE_ALPHA = 0.7;
const PLAYMAT_TINT = 0xe4e4e4;
const PLAYMAT_FABRIC_TILE_SCALE = 0.6;
const PLAYMAT_FABRIC_MAX_ALPHA = 0.75;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** A tileable woven-cloth tile on a white base (white = identity under MULTIPLY,
 *  so only the darker threads register as cloth grain over the playmat art). */
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

/** Radial darkening overlay — transparent center fading to near-black at the
 *  corners — so the playmat sinks into the table instead of reading as a hard
 *  stretched rectangle. */
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

/** Renders a deck's playmat — cover-fit art + woven cloth + edge vignette +
 *  optional border — clipped to the felt's rounded rect. Shared by the in-game
 *  battlefield (`BoardRegion`) and the deck-editor preview so the two match
 *  pixel-for-pixel. The owner adds `container` to its scene and drives it via
 *  `setImage` / `setSettings` / `layout`. */
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
  private url: string | null = null;
  private settings: Required<PlaymatSettings> = { ...DEFAULT_PLAYMAT_SETTINGS };
  private rect: PlayZoneRect | null = null;
  private dropActive = false;

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
    // The border is intentionally NOT a child of `content`: a Graphics mask clips
    // through the (1-bit, non-antialiased) stencil buffer, so its rounded corners
    // are aliased and would chop the stroke. Drawn unmasked and on top, the stroke
    // keeps Pixi's crisp antialiased corners and covers the content's clipped edge.
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

  private updateVisibility(): void {
    this.container.visible = !!this.url || !!this.settings.color;
  }

  private applySettings(): void {
    this.fabric.alpha = clamp01(this.settings.texture) * PLAYMAT_FABRIC_MAX_ALPHA;
  }

  layout(rect: PlayZoneRect, opts: { dropActive: boolean }): void {
    this.rect = rect;
    this.dropActive = opts.dropActive;

    this.colorFill.clear();
    if (this.settings.color) {
      this.colorFill.rect(rect.x, rect.y, rect.width, rect.height);
      this.colorFill.fill({ color: hexToNum(this.settings.color) });
    }

    const tw = this.image.texture.width || 1;
    const th = this.image.texture.height || 1;
    const sx = rect.width / tw;
    const sy = rect.height / th;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    if (this.settings.fit === "stretch") {
      this.image.scale.set(sx, sy);
      this.image.x = cx;
      this.image.y = cy;
    } else if (this.settings.fit === "fit") {
      this.image.scale.set(Math.min(sx, sy));
      this.image.x = cx;
      this.image.y = cy;
    } else {
      const scale = Math.max(sx, sy);
      this.image.scale.set(scale);
      const ox = clamp01(this.settings.offsetX);
      const oy = clamp01(this.settings.offsetY);
      this.image.x = cx + (0.5 - ox) * (tw * scale - rect.width);
      this.image.y = cy + (0.5 - oy) * (th * scale - rect.height);
    }

    for (const overlay of [this.fabric, this.vignette]) {
      overlay.x = rect.x;
      overlay.y = rect.y;
      overlay.width = rect.width;
      overlay.height = rect.height;
    }

    this.mask.clear();
    this.mask.roundRect(rect.x, rect.y, rect.width, rect.height, TABLE_RADIUS);
    this.mask.fill({ color: 0xffffff });

    this.border.clear();
    const bw = this.settings.borderWidth;
    if (bw > 0) {
      this.border.roundRect(
        rect.x + bw / 2,
        rect.y + bw / 2,
        rect.width - bw,
        rect.height - bw,
        Math.max(0, TABLE_RADIUS - bw / 2),
      );
      this.border.stroke({ width: bw, color: hexToNum(this.settings.borderColor) });
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
