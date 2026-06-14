/**
 * PointerLayer — Pixi canvas overlay that renders targeting pointers.
 *
 * A "pointer" is the non-arrow counterpart to `ArrowLayer`: a floating
 * icon anchored to the cursor (or to a locked target) with an animated
 * glow on the target card. The icon, colour, and
 * glow derive from the `TargetingIntent` carried by each spec.
 *
 * Inputs:
 *   - `pointers`  — stack-object → target relationships, one per active
 *                   target choice (e.g. multi-target spell).
 *   - `casting`   — the live cursor-follow pointer shown while the human
 *                   player is picking a target.
 *
 *
 * Textures for each intent are preloaded from `src/assets/pointers/`.
 */

import { Container, Graphics, Sprite, Texture } from "pixi.js";
// NOTE: icons render in their original white fill — no `.tint` applied —
// so the pointer glyph stays visually neutral against any background.
// The colored glow under + around it carries the per-intent semantics.
import { TargetingIntent, intentIsHostile } from "@/types/promptType";
import type { Theme } from "@/hooks/useTheme";
import { getTheme } from "@/hooks/useTheme";
import { hexToNum, colorAlpha } from "./colorUtils";
import { INTENT_GLYPH_SVG as POINTER_ICON_SVGS } from "./pointerGlyphs";

/** Rewrite a Game-Icons SVG so its paths render as opaque white pixels
 *  in a headless raster (Pixi's texture loader). The source ships with
 *  `fill="currentColor"` which resolves to black (or transparent) when
 *  the `<svg>` has no surrounding CSS context. Replacing every `fill`
 *  attribute and adding a root-level `fill="#ffffff"` forces visibility. */
function patchSvgFill(svg: string): string {
  const withReplacedFills = svg.replace(/fill="[^"]*"/g, 'fill="#ffffff"');
  if (/<svg[^>]*\bfill=/.test(withReplacedFills)) return withReplacedFills;
  return withReplacedFills.replace(/<svg\b/, '<svg fill="#ffffff"');
}

/**
 * Native raster size for the offscreen canvas we decode each SVG into.
 * Game-Icons SVGs have a 512×512 viewBox; rasterising at 128 keeps the
 * glyph sharp under the 40 px sprite anchor (and up to the hand's
 * ~4× hover scale) without paying for a full 512×512 buffer per glyph.
 */
const ICON_RASTER_SIZE = 128;

/**
 * Rasterise a Game-Icons SVG string into a Pixi `Texture`.
 *
 * Cross-browser quirks we have to work around:
 *   - Pixi v8 decodes textures via `createImageBitmap`, and **WebKit
 *     rejects SVG data URLs** in both `createImageBitmap` and
 *     `img.decode()`. Under Tauri on macOS the renderer is WebKit.
 *   - WebKit *does* accept an SVG blob URL loaded through the classic
 *     `<img>` `onload` event, but only when the SVG has an `xmlns`
 *     attribute on its root element — `unplugin-icons` strips that in
 *     its raw output, so we re-add it before creating the blob.
 *   - Game-Icons SVGs ship with `width="1.2em"` / `height="1.2em"`
 *     which resolve to ~19 px in a detached `<img>`; we rewrite both
 *     to `ICON_RASTER_SIZE` so the decoded intrinsic size is sharp.
 *
 * The decoded image is stamped onto an offscreen canvas, then handed
 * to `Texture.from(canvas)` — Pixi's asset pipeline never sees the
 * blob URL or data URL.
 */
async function svgToTexture(svg: string, intent: string): Promise<Texture> {
  let patched = patchSvgFill(svg)
    .replace(/width="[^"]*"/i, `width="${ICON_RASTER_SIZE}"`)
    .replace(/height="[^"]*"/i, `height="${ICON_RASTER_SIZE}"`);
  if (!/<svg[^>]*\bxmlns=/.test(patched)) {
    patched = patched.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  const blob = new Blob([patched], { type: "image/svg+xml;charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`[pointer-layer] ${intent}: img.onerror`));
      el.src = blobUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = ICON_RASTER_SIZE;
    canvas.height = ICON_RASTER_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(`[pointer-layer] ${intent}: 2d context unavailable`);
    ctx.drawImage(img, 0, 0, ICON_RASTER_SIZE, ICON_RASTER_SIZE);
    return Texture.from(canvas);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

// ── Visual tuning ──────────────────────────────────────────────────────────
const POINTER_Z_INDEX = 8100; // above arrows (8000)
const ICON_SIZE = 40; // target sprite size in CSS px
const ICON_FLOAT_AMPLITUDE = 3; // px vertical bob
const ICON_FLOAT_PERIOD_MS = 1800; // one full bob cycle
const ICON_PULSE_PERIOD_MS = 1400; // glow ring pulse cycle
// Glyph centre sits exactly at the cursor position. Previously the icon
// was lifted above the cursor so the OS arrow stayed visible, but the
// OS cursor is now hidden during targeting — keeping the glyph off-axis
// only confuses aiming, so clicks land where the glyph is drawn.
const ICON_CURSOR_OFFSET_Y = 0;
const GLOW_BASE_RADIUS = 22; // glow ring under the icon
const GLOW_MAX_RADIUS = 30; // outer radius when fully pulsed
const GLOW_BASE_ALPHA = 0.45;
const GLOW_PULSE_ALPHA = 0.25;
const LINK_BOW = 0.3;
const LINK_TAIL_SHORTEN = 26;
const LINK_TIP_SHORTEN = 28;
const LINK_UNDER_WIDTH = 5;
const LINK_UNDER_ALPHA = 0.28;
const LINK_CORE_WIDTH = 2;
const LINK_CORE_ALPHA = 0.8;
const LINK_HEAD_LEN = 12;
const LINK_HEAD_WIDTH = 13;
const LINK_HEAD_STROKE = 2;
const TARGET_CLUSTER_RADIUS = 26;
const TARGET_CLUSTER_KEY_PX = 4;

interface PointerLayerRenderOptions {
  showLinks: boolean;
  showSourceGlyphs: boolean;
}

interface Point {
  x: number;
  y: number;
}

interface CubicCurve {
  p0: Point;
  c1: Point;
  c2: Point;
  p1: Point;
}

interface LaidOutPointer extends ResolvedPointer {
  targetX: number;
  targetY: number;
  sourceGlyphX: number;
  sourceGlyphY: number;
}

function unit(dx: number, dy: number): { ux: number; uy: number; len: number } {
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return { ux: 0, uy: 0, len: 0 };
  return { ux: dx / len, uy: dy / len, len };
}

function cubicCurve(x1: number, y1: number, x2: number, y2: number, bow: number): CubicCurve {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const { len } = unit(dx, dy);
  if (len === 0) {
    const p = { x: x1, y: y1 };
    return { p0: p, c1: p, c2: p, p1: p };
  }
  const nx = -dy / len;
  const ny = dx / len;
  const offset = len * bow * 0.4;
  return {
    p0: { x: x1, y: y1 },
    c1: { x: x1 + dx * 0.25 + nx * offset, y: y1 + dy * 0.25 + ny * offset },
    c2: { x: x1 + dx * 0.75 + nx * offset, y: y1 + dy * 0.75 + ny * offset },
    p1: { x: x2, y: y2 },
  };
}

function cubicTangent(curve: CubicCurve, t: number): { ux: number; uy: number } {
  const u = 1 - t;
  const dx =
    3 * u * u * (curve.c1.x - curve.p0.x) +
    6 * u * t * (curve.c2.x - curve.c1.x) +
    3 * t * t * (curve.p1.x - curve.c2.x);
  const dy =
    3 * u * u * (curve.c1.y - curve.p0.y) +
    6 * u * t * (curve.c2.y - curve.c1.y) +
    3 * t * t * (curve.p1.y - curve.c2.y);
  const { ux, uy } = unit(dx, dy);
  return { ux, uy };
}

function shortenEndpoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { ax1: number; ay1: number; ax2: number; ay2: number } {
  const { ux, uy, len } = unit(x2 - x1, y2 - y1);
  if (len === 0) return { ax1: x1, ay1: y1, ax2: x2, ay2: y2 };
  return {
    ax1: x1 + ux * LINK_TAIL_SHORTEN,
    ay1: y1 + uy * LINK_TAIL_SHORTEN,
    ax2: x2 - ux * LINK_TIP_SHORTEN,
    ay2: y2 - uy * LINK_TIP_SHORTEN,
  };
}

function pointClusterKey(x: number, y: number): string {
  return `${Math.round(x / TARGET_CLUSTER_KEY_PX)}:${Math.round(y / TARGET_CLUSTER_KEY_PX)}`;
}

function targetClusterOffset(index: number, count: number): Point {
  if (count <= 1) return { x: 0, y: 0 };
  if (count === 2) {
    return {
      x: (index === 0 ? -1 : 1) * TARGET_CLUSTER_RADIUS,
      y: 0,
    };
  }
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
  return {
    x: Math.cos(angle) * TARGET_CLUSTER_RADIUS,
    y: Math.sin(angle) * TARGET_CLUSTER_RADIUS,
  };
}

function layoutPointerTargets(
  pointers: ResolvedPointer[],
  showSourceGlyphs: boolean,
): LaidOutPointer[] {
  const laidOut = pointers.map((pointer) => ({
    ...pointer,
    targetX: pointer.toX,
    targetY: pointer.toY,
    sourceGlyphX: pointer.fromX,
    sourceGlyphY: pointer.fromY,
  }));
  const groups = new Map<string, number[]>();
  for (let i = 0; i < pointers.length; i += 1) {
    const pointer = pointers[i]!;
    if (!pointer.locked) continue;
    const key = pointClusterKey(pointer.toX, pointer.toY);
    const group = groups.get(key);
    if (group) group.push(i);
    else groups.set(key, [i]);
  }

  for (const indexes of groups.values()) {
    if (indexes.length <= 1) continue;
    indexes.forEach((pointerIndex, groupIndex) => {
      const pointer = laidOut[pointerIndex]!;
      const offset = targetClusterOffset(groupIndex, indexes.length);
      pointer.targetX = pointer.toX + offset.x;
      pointer.targetY = pointer.toY + offset.y;
    });
  }

  if (showSourceGlyphs) {
    const sourceGroups = new Map<string, number[]>();
    for (let i = 0; i < pointers.length; i += 1) {
      const pointer = pointers[i]!;
      const key = pointClusterKey(pointer.fromX, pointer.fromY);
      const group = sourceGroups.get(key);
      if (group) group.push(i);
      else sourceGroups.set(key, [i]);
    }
    for (const indexes of sourceGroups.values()) {
      if (indexes.length <= 1) continue;
      indexes.forEach((pointerIndex, groupIndex) => {
        const pointer = laidOut[pointerIndex]!;
        const offset = targetClusterOffset(groupIndex, indexes.length);
        pointer.sourceGlyphX = pointer.fromX + offset.x;
        pointer.sourceGlyphY = pointer.fromY + offset.y;
      });
    }
  }

  return laidOut;
}

// ── Spec types ─────────────────────────────────────────────────────────────
export interface ResolvedPointer {
  /** Source position (centre of source entity in canvas-local pixels). */
  fromX: number;
  fromY: number;
  /** Icon tip position (cursor or target centre). */
  toX: number;
  toY: number;
  intent: TargetingIntent;
  /** True when the icon is locked onto a target rather than following the
   *  cursor. Locked pointers get a slightly bigger glow to signal commit. */
  locked: boolean;
}

// ── Internal state ─────────────────────────────────────────────────────────
interface IconEntry {
  link: Graphics;
  sourceSprite: Sprite;
  sourceGlow: Graphics;
  sprite: Sprite;
  glow: Graphics;
}

export class PointerLayer {
  private root: Container;
  private pool: IconEntry[] = [];
  // Seeded synchronously from the active preset so the first frame renders
  // in theme-correct colours; `setTheme` keeps it in sync afterwards.
  private theme: Theme = getTheme();
  private textures: Partial<Record<TargetingIntent, Texture>> = {};
  private elapsedMs = 0;
  private ready = false;
  private clear = true;

  constructor() {
    this.root = new Container();
    this.root.zIndex = POINTER_Z_INDEX;
    this.root.sortableChildren = true;
  }

  get graphics(): Container {
    return this.root;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  /** Preload every pointer texture. Returns a promise that resolves once
   *  Pixi's Assets loader finishes; the layer can still render before then
   *  (sprites just won't have textures yet). */
  async loadAssets(): Promise<void> {
    const jobs: { intent: TargetingIntent; svg: string }[] = [];
    for (const [intent, svg] of Object.entries(POINTER_ICON_SVGS)) {
      if (svg == null) continue;
      if (typeof svg !== "string" || !svg.includes("<svg")) {
        console.error(
          `[pointer-layer] raw SVG for ${intent} did not parse — got: ${String(svg).slice(0, 80)}`,
        );
        continue;
      }
      jobs.push({ intent: intent as TargetingIntent, svg });
    }

    await Promise.all(
      jobs.map(async ({ intent, svg }) => {
        try {
          this.textures[intent] = await svgToTexture(svg, intent);
        } catch (err) {
          console.error(`[pointer-layer] failed to load ${intent} icon:`, err);
        }
      }),
    );
    this.ready = true;
  }

  /** Replace the live pointer set and tick the animation. */
  update(
    pointers: ResolvedPointer[],
    deltaMs: number,
    options: PointerLayerRenderOptions = { showLinks: true, showSourceGlyphs: false },
  ): void {
    if (pointers.length === 0 && this.clear) return;
    this.elapsedMs += deltaMs;
    const laidOutPointers = layoutPointerTargets(pointers, options.showSourceGlyphs);
    this.ensurePool(laidOutPointers.length);

    for (let i = 0; i < this.pool.length; i += 1) {
      const entry = this.pool[i]!;
      if (i < laidOutPointers.length) {
        this.renderPointer(entry, laidOutPointers[i]!, options);
        entry.link.visible = options.showLinks;
        entry.sourceSprite.visible = options.showSourceGlyphs;
        entry.sourceGlow.visible = options.showSourceGlyphs;
        entry.sprite.visible = true;
        entry.glow.visible = true;
      } else {
        entry.link.visible = false;
        entry.sourceSprite.visible = false;
        entry.sourceGlow.visible = false;
        entry.sprite.visible = false;
        entry.glow.visible = false;
      }
    }
    this.clear = laidOutPointers.length === 0;
  }

  get isClear(): boolean {
    return this.clear;
  }

  private ensurePool(count: number): void {
    while (this.pool.length < count) {
      const link = new Graphics();
      const sourceGlow = new Graphics();
      const sourceSprite = new Sprite();
      const glow = new Graphics();
      const sprite = new Sprite();
      sourceSprite.anchor.set(0.5);
      sourceSprite.width = ICON_SIZE;
      sourceSprite.height = ICON_SIZE;
      sprite.anchor.set(0.5);
      sprite.width = ICON_SIZE;
      sprite.height = ICON_SIZE;
      this.root.addChild(link);
      this.root.addChild(sourceGlow);
      this.root.addChild(glow);
      this.root.addChild(sourceSprite);
      this.root.addChild(sprite);
      this.pool.push({ link, sourceSprite, sourceGlow, sprite, glow });
    }
  }

  private renderPointer(
    entry: IconEntry,
    p: LaidOutPointer,
    options: PointerLayerRenderOptions,
  ): void {
    const { color, alpha } = this.colorFor(p.intent);

    // ── Float animation: small vertical bob relative to the anchor ─────
    const bob =
      Math.sin((this.elapsedMs / ICON_FLOAT_PERIOD_MS) * Math.PI * 2) * ICON_FLOAT_AMPLITUDE;
    const anchorY = p.targetY + (p.locked ? 0 : ICON_CURSOR_OFFSET_Y) + bob;

    entry.link.clear();
    if (options.showLinks && p.locked) {
      this.drawLink(entry.link, p.fromX, p.fromY, p.targetX, anchorY, color, alpha);
    }

    const sourceY = p.sourceGlyphY + bob;
    if (options.showSourceGlyphs) {
      this.renderGlyph(
        entry.sourceGlow,
        entry.sourceSprite,
        p.sourceGlyphX,
        sourceY,
        p,
        color,
        alpha,
      );
    }

    this.renderGlyph(entry.glow, entry.sprite, p.targetX, anchorY, p, color, alpha);
  }

  private renderGlyph(
    glow: Graphics,
    sprite: Sprite,
    x: number,
    y: number,
    p: ResolvedPointer,
    color: number,
    alpha: number,
  ): void {
    const pulse = 0.5 + 0.5 * Math.sin((this.elapsedMs / ICON_PULSE_PERIOD_MS) * Math.PI * 2);
    const radius =
      GLOW_BASE_RADIUS + pulse * (GLOW_MAX_RADIUS - GLOW_BASE_RADIUS) * (p.locked ? 1.15 : 1.0);
    const glowAlpha = alpha * (GLOW_BASE_ALPHA + pulse * GLOW_PULSE_ALPHA);

    glow.clear();
    glow.circle(x, y, radius);
    glow.fill({ color, alpha: glowAlpha * 0.35 });
    glow.circle(x, y, radius * 0.7);
    glow.fill({ color, alpha: glowAlpha });

    // ── Icon (monochrome — no tint so the glyph stays neutral white) ──
    const texture = this.textures[p.intent];
    sprite.texture = texture ?? Texture.EMPTY;
    sprite.x = x;
    sprite.y = y;
    sprite.alpha = alpha;
  }

  private drawLink(
    gfx: Graphics,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    color: number,
    alpha: number,
  ): void {
    const { ax1, ay1, ax2, ay2 } = shortenEndpoints(fromX, fromY, toX, toY);
    const curve = cubicCurve(ax1, ay1, ax2, ay2, LINK_BOW);
    gfx
      .moveTo(curve.p0.x, curve.p0.y)
      .bezierCurveTo(curve.c1.x, curve.c1.y, curve.c2.x, curve.c2.y, curve.p1.x, curve.p1.y)
      .stroke({
        color,
        width: LINK_UNDER_WIDTH,
        alpha: alpha * LINK_UNDER_ALPHA,
        cap: "round",
        join: "round",
      });
    gfx
      .moveTo(curve.p0.x, curve.p0.y)
      .bezierCurveTo(curve.c1.x, curve.c1.y, curve.c2.x, curve.c2.y, curve.p1.x, curve.p1.y)
      .stroke({
        color,
        width: LINK_CORE_WIDTH,
        alpha: alpha * LINK_CORE_ALPHA,
        cap: "round",
        join: "round",
      });
    this.drawLinkHead(gfx, curve, color, alpha);
  }

  private drawLinkHead(gfx: Graphics, curve: CubicCurve, color: number, alpha: number): void {
    const tan = cubicTangent(curve, 1);
    if (tan.ux === 0 && tan.uy === 0) return;
    const tip = curve.p1;
    const px = -tan.uy;
    const py = tan.ux;
    const baseX = tip.x - tan.ux * LINK_HEAD_LEN;
    const baseY = tip.y - tan.uy * LINK_HEAD_LEN;
    const halfW = LINK_HEAD_WIDTH / 2;
    gfx
      .moveTo(baseX + px * halfW, baseY + py * halfW)
      .lineTo(tip.x, tip.y)
      .lineTo(baseX - px * halfW, baseY - py * halfW)
      .stroke({
        color,
        width: LINK_HEAD_STROKE,
        alpha: alpha * LINK_CORE_ALPHA,
        cap: "round",
        join: "round",
      });
  }

  private colorFor(intent: TargetingIntent): { color: number; alpha: number } {
    // Pointer palette is binary — the monochrome icon carries the
    // specific semantic; the glow colour only signals valence.
    const raw = intentIsHostile(intent)
      ? this.theme.gameTheme.pointer.hostile
      : this.theme.gameTheme.pointer.friendly;
    return { color: hexToNum(raw), alpha: colorAlpha(raw) };
  }

  destroy(): void {
    for (const { link, sourceSprite, sourceGlow, sprite, glow } of this.pool) {
      link.destroy();
      sourceSprite.destroy();
      sourceGlow.destroy();
      sprite.destroy();
      glow.destroy();
    }
    this.pool = [];
    this.root.destroy({ children: true });
    this.textures = {};
  }

  /** True once `loadAssets()` has resolved — callers that require textures
   *  (e.g. glow layers reading them for an additive pass) can await. */
  isReady(): boolean {
    return this.ready;
  }
}
