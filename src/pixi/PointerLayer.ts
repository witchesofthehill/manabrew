/**
 * PointerLayer — Pixi canvas overlay that renders targeting pointers.
 *
 * A "pointer" is the non-arrow counterpart to `ArrowLayer`: a floating
 * icon anchored to the cursor (or to a locked target) with an animated
 * glow on the source card and the target card. The icon, colour, and
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

// ── Source-card glow tuning ───────────────────────────────────────────────
// The source card (spell on the stack) gets a wider, softer halo ring —
// slightly different visual language from the target glow so the two read
// as "this is acting on that".
const SOURCE_GLOW_BASE_RADIUS = 38;
const SOURCE_GLOW_MAX_RADIUS = 52;
const SOURCE_GLOW_BASE_ALPHA = 0.3;
const SOURCE_GLOW_PULSE_ALPHA = 0.18;
// Phase the source glow's pulse so it never peaks in sync with the target —
// the two alternating creates a back-and-forth "tethered" feel.
const SOURCE_PULSE_PHASE_OFFSET = Math.PI;

// ── Internal state ─────────────────────────────────────────────────────────
interface IconEntry {
  sprite: Sprite;
  glow: Graphics;
  sourceGlow: Graphics;
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
  update(pointers: ResolvedPointer[], deltaMs: number): void {
    if (pointers.length === 0 && this.clear) return;
    this.elapsedMs += deltaMs;
    this.ensurePool(pointers.length);

    for (let i = 0; i < this.pool.length; i += 1) {
      const entry = this.pool[i]!;
      if (i < pointers.length) {
        this.renderPointer(entry, pointers[i]!);
        entry.sprite.visible = true;
        entry.glow.visible = true;
        entry.sourceGlow.visible = true;
      } else {
        entry.sprite.visible = false;
        entry.glow.visible = false;
        entry.sourceGlow.visible = false;
      }
    }
    this.clear = pointers.length === 0;
  }

  get isClear(): boolean {
    return this.clear;
  }

  private ensurePool(count: number): void {
    while (this.pool.length < count) {
      const sourceGlow = new Graphics();
      const glow = new Graphics();
      const sprite = new Sprite();
      sprite.anchor.set(0.5);
      sprite.width = ICON_SIZE;
      sprite.height = ICON_SIZE;
      // Order: source glow (behind source card) → target glow → icon.
      this.root.addChild(sourceGlow);
      this.root.addChild(glow);
      this.root.addChild(sprite);
      this.pool.push({ sprite, glow, sourceGlow });
    }
  }

  private renderPointer(entry: IconEntry, p: ResolvedPointer): void {
    const { color, alpha } = this.colorFor(p.intent);

    // ── Float animation: small vertical bob relative to the anchor ─────
    const bob =
      Math.sin((this.elapsedMs / ICON_FLOAT_PERIOD_MS) * Math.PI * 2) * ICON_FLOAT_AMPLITUDE;
    const anchorY = p.toY + (p.locked ? 0 : ICON_CURSOR_OFFSET_Y) + bob;

    // ── Target glow (under the icon) ───────────────────────────────────
    const pulse = 0.5 + 0.5 * Math.sin((this.elapsedMs / ICON_PULSE_PERIOD_MS) * Math.PI * 2);
    const radius =
      GLOW_BASE_RADIUS + pulse * (GLOW_MAX_RADIUS - GLOW_BASE_RADIUS) * (p.locked ? 1.15 : 1.0);
    const glowAlpha = alpha * (GLOW_BASE_ALPHA + pulse * GLOW_PULSE_ALPHA);

    entry.glow.clear();
    entry.glow.circle(p.toX, anchorY, radius);
    entry.glow.fill({ color, alpha: glowAlpha * 0.35 });
    entry.glow.circle(p.toX, anchorY, radius * 0.7);
    entry.glow.fill({ color, alpha: glowAlpha });

    // ── Source-card glow (counter-phased pulse around the source) ─────
    const sourcePhase =
      (this.elapsedMs / ICON_PULSE_PERIOD_MS) * Math.PI * 2 + SOURCE_PULSE_PHASE_OFFSET;
    const sourcePulse = 0.5 + 0.5 * Math.sin(sourcePhase);
    const sourceRadius =
      SOURCE_GLOW_BASE_RADIUS + sourcePulse * (SOURCE_GLOW_MAX_RADIUS - SOURCE_GLOW_BASE_RADIUS);
    const sourceAlpha = alpha * (SOURCE_GLOW_BASE_ALPHA + sourcePulse * SOURCE_GLOW_PULSE_ALPHA);

    entry.sourceGlow.clear();
    entry.sourceGlow.circle(p.fromX, p.fromY, sourceRadius);
    entry.sourceGlow.fill({ color, alpha: sourceAlpha * 0.3 });
    entry.sourceGlow.circle(p.fromX, p.fromY, sourceRadius * 0.75);
    entry.sourceGlow.fill({ color, alpha: sourceAlpha });

    // ── Icon (monochrome — no tint so the glyph stays neutral white) ──
    const texture = this.textures[p.intent];
    entry.sprite.texture = texture ?? Texture.EMPTY;
    entry.sprite.x = p.toX;
    entry.sprite.y = anchorY;
    entry.sprite.alpha = alpha;
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
    for (const { sprite, glow, sourceGlow } of this.pool) {
      sprite.destroy();
      glow.destroy();
      sourceGlow.destroy();
    }
    this.pool = [];
    this.root.destroy({ children: true });
    for (const tex of Object.values(this.textures)) tex?.destroy(true);
    this.textures = {};
  }

  /** True once `loadAssets()` has resolved — callers that require textures
   *  (e.g. glow layers reading them for an additive pass) can await. */
  isReady(): boolean {
    return this.ready;
  }
}
