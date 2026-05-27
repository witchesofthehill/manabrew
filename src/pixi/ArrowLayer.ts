import { Container, FillGradient, Graphics } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { getTheme } from "@/hooks/useTheme";
import { hexToNum } from "./colorUtils";
import type { ArrowType } from "./types";

// Re-export so existing callers still import ArrowType from this module.
export type { ArrowType } from "./types";

export interface ArrowDef {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  type: ArrowType;
}

// ── Layer ordering ─────────────────────────────────────────────────────────
const ARROW_Z_INDEX = 8000;

// ── Curve geometry (cubic Bezier with perpendicular bow) ───────────────────
const BOW_PAINTERLY = 0.3;
const BOW_RUNE = 0.3;
const BOW_PLACEMENT = 0.22;
const TAIL_SHORTEN = 6;
const TIP_SHORTEN = 12;

// ── Painterly (combat) ─────────────────────────────────────────────────────
const PAINTERLY_UNDER_WIDTH = 3.5;
const PAINTERLY_UNDER_ALPHA = 0.55;
const PAINTERLY_CORE_WIDTH = 1.5;
const PAINTERLY_GRADIENT_STOPS: [number, number][] = [
  [0, 0.2],
  [0.4, 0.85],
  [1, 1],
];
const PAINTERLY_HEAD_LEN = 11;
const PAINTERLY_HEAD_WIDTH = 12;
const PAINTERLY_HEAD_STROKE = 2;
const PAINTERLY_PARTICLE_COUNT = 5;
const PAINTERLY_PARTICLE_CYCLE_MS = 2000;
const PAINTERLY_PARTICLE_STAGGER_MS = 320;
// Outer halo radius per particle. Inner spark sits at ~45% of this.
const PAINTERLY_PARTICLE_SIZES = [2.4, 3.2, 2.4, 3.2, 2.4];
const PAINTERLY_PARTICLE_HALO_ALPHA = 0.45;
const PAINTERLY_PARTICLE_CORE_RATIO = 0.45;

// ── Rune (attach) ──────────────────────────────────────────────────────────
const RUNE_LINE_WIDTH = 1;
const RUNE_LINE_ALPHA = 0.7;
const RUNE_DASH_ON = 2;
const RUNE_DASH_OFF = 5;
const RUNE_BEZIER_STEPS = 64;
const RUNE_RETICLE_OUTER_R = 5;
const RUNE_RETICLE_INNER_R = 2;
const RUNE_RETICLE_TICK_LEN = 4;
const RUNE_PARTICLE_COUNT = 6;
const RUNE_PARTICLE_CYCLE_MS = 2200;
const RUNE_PARTICLE_STAGGER_MS = 350;
const RUNE_PARTICLE_RADIUS = 1.4;

// ── Placement (drop-here ghost arrow, marching-ants) ───────────────────────
const PLACEMENT_STROKE_WIDTH = 3;
const PLACEMENT_ALPHA = 0.7;
const PLACEMENT_DASH = 9;
const PLACEMENT_GAP = 6;
const PLACEMENT_BEZIER_STEPS = 64;
const PLACEMENT_DASH_SPEED_PX_PER_SEC = 48;
const PLACEMENT_HEAD_LEN = 14;
const PLACEMENT_HEAD_WIDTH = 11;

// ── Helpers ────────────────────────────────────────────────────────────────
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

function unit(dx: number, dy: number): { ux: number; uy: number; len: number } {
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return { ux: 0, uy: 0, len: 0 };
  return { ux: dx / len, uy: dy / len, len };
}

/**
 * Cubic Bezier with a perpendicular bow — control points sit at 25% / 75%
 * of the line, offset perpendicular by `bow * length * 0.4`. Mirrors the
 * geometry from the design spec so the curve shape matches across variants.
 */
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

function shortenEndpoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { ax1: number; ay1: number; ax2: number; ay2: number } {
  const { ux, uy, len } = unit(x2 - x1, y2 - y1);
  if (len === 0) return { ax1: x1, ay1: y1, ax2: x2, ay2: y2 };
  return {
    ax1: x1 + ux * TAIL_SHORTEN,
    ay1: y1 + uy * TAIL_SHORTEN,
    ax2: x2 - ux * TIP_SHORTEN,
    ay2: y2 - uy * TIP_SHORTEN,
  };
}

function cubicAt(curve: CubicCurve, t: number): Point {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x:
      uu * u * curve.p0.x + 3 * uu * t * curve.c1.x + 3 * u * tt * curve.c2.x + tt * t * curve.p1.x,
    y:
      uu * u * curve.p0.y + 3 * uu * t * curve.c1.y + 3 * u * tt * curve.c2.y + tt * t * curve.p1.y,
  };
}

function cubicTangent(curve: CubicCurve, t: number): { ux: number; uy: number } {
  const u = 1 - t;
  // Derivative of cubic Bezier: 3(1-t)²(C1-P0) + 6(1-t)t(C2-C1) + 3t²(P1-C2)
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

function sampleCubic(curve: CubicCurve, steps: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) points.push(cubicAt(curve, i / steps));
  return points;
}

/**
 * Symmetric fade-in / fade-out envelope used by all particle variants —
 * matches the spec's `opacity 0;1;1;0` keyframes (fade in for 25%, hold
 * for 50%, fade out 25%).
 */
/** Pack a 0xRRGGBB hue plus separate alpha into the rgba() string form
 *  Pixi's `addColorStop` accepts via `ColorSource`. The gradient API only
 *  takes one color arg per stop, so we encode alpha into it. */
function hueAsRgba(hue: number, alpha: number): string {
  const r = (hue >> 16) & 0xff;
  const g = (hue >> 8) & 0xff;
  const b = hue & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

function particleAlpha(t: number): number {
  if (t < 0.25) return t / 0.25;
  if (t > 0.75) return (1 - t) / 0.25;
  return 1;
}

// ── Internal pool entry — one per active arrow ─────────────────────────────
interface ArrowEntry {
  root: Container;
  underGfx: Graphics;
  coreGfx: Graphics;
  headGfx: Graphics;
  particlesGfx: Graphics;
  gradKey: string;
  underGrad: FillGradient | null;
  coreGrad: FillGradient | null;
}

export class ArrowLayer {
  private root: Container;
  private theme: Theme = getTheme();
  private arrows: ArrowDef[] = [];
  private pool: ArrowEntry[] = [];
  private elapsedMs = 0;
  private placementDashOffset = 0;
  private clear = true;

  constructor() {
    this.root = new Container();
    this.root.zIndex = ARROW_Z_INDEX;
    this.root.sortableChildren = true;
  }

  get graphics(): Container {
    return this.root;
  }

  get isClear(): boolean {
    return this.clear;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    if (this.arrows.length > 0) this.redraw();
  }

  update(arrows: ArrowDef[], deltaMs = 0): void {
    if (arrows.length === 0 && this.clear) return;
    this.elapsedMs += deltaMs;
    this.placementDashOffset =
      (this.placementDashOffset + (deltaMs / 1000) * PLACEMENT_DASH_SPEED_PX_PER_SEC) %
      (PLACEMENT_DASH + PLACEMENT_GAP);
    this.arrows = arrows;
    this.ensurePool(arrows.length);
    this.redraw();
    this.clear = arrows.length === 0;
  }

  destroy(): void {
    for (const entry of this.pool) entry.root.destroy({ children: true });
    this.pool = [];
    this.root.destroy({ children: true });
    this.arrows = [];
  }

  private ensurePool(count: number): void {
    while (this.pool.length < count) {
      const root = new Container();
      const underGfx = new Graphics();
      const coreGfx = new Graphics();
      const headGfx = new Graphics();
      const particlesGfx = new Graphics();
      root.addChild(underGfx);
      root.addChild(coreGfx);
      root.addChild(headGfx);
      root.addChild(particlesGfx);
      this.root.addChild(root);
      this.pool.push({
        root,
        underGfx,
        coreGfx,
        headGfx,
        particlesGfx,
        gradKey: "",
        underGrad: null,
        coreGrad: null,
      });
    }
  }

  private redraw(): void {
    for (let i = 0; i < this.pool.length; i += 1) {
      const entry = this.pool[i]!;
      entry.underGfx.clear();
      entry.coreGfx.clear();
      entry.headGfx.clear();
      entry.particlesGfx.clear();
      if (i < this.arrows.length) {
        entry.root.visible = true;
        this.drawArrow(entry, this.arrows[i]!);
      } else {
        entry.root.visible = false;
      }
    }
  }

  private drawArrow(entry: ArrowEntry, arrow: ArrowDef): void {
    switch (arrow.type) {
      case "attack":
      case "block":
        this.drawPainterly(entry, arrow);
        return;
      case "attach":
        this.drawRune(entry, arrow);
        return;
      case "placement":
        this.drawPlacement(entry, arrow);
        return;
    }
  }

  // ── Painterly (combat) ───────────────────────────────────────────────────
  private drawPainterly(entry: ArrowEntry, arrow: ArrowDef): void {
    const { ax1, ay1, ax2, ay2 } = shortenEndpoints(arrow.fromX, arrow.fromY, arrow.toX, arrow.toY);
    const curve = cubicCurve(ax1, ay1, ax2, ay2, BOW_PAINTERLY);
    const hueHex =
      arrow.type === "attack"
        ? this.theme.gameTheme.pointer.hostile
        : this.theme.gameTheme.pointer.friendly;
    const hue = hexToNum(hueHex);

    const gradKey = `${ax1.toFixed(1)},${ay1.toFixed(1)},${ax2.toFixed(1)},${ay2.toFixed(1)},${hue}`;
    if (entry.gradKey !== gradKey || !entry.underGrad || !entry.coreGrad) {
      entry.underGrad = new FillGradient(ax1, ay1, ax2, ay2);
      entry.coreGrad = new FillGradient(ax1, ay1, ax2, ay2);
      for (const [stop, alpha] of PAINTERLY_GRADIENT_STOPS) {
        const rgba = hueAsRgba(hue, alpha);
        entry.underGrad.addColorStop(stop, rgba);
        entry.coreGrad.addColorStop(stop, rgba);
      }
      entry.gradKey = gradKey;
    }
    const underGrad = entry.underGrad;
    const coreGrad = entry.coreGrad;

    entry.underGfx
      .moveTo(curve.p0.x, curve.p0.y)
      .bezierCurveTo(curve.c1.x, curve.c1.y, curve.c2.x, curve.c2.y, curve.p1.x, curve.p1.y)
      .stroke({
        fill: underGrad,
        width: PAINTERLY_UNDER_WIDTH,
        alpha: PAINTERLY_UNDER_ALPHA,
        cap: "round",
        join: "round",
      });

    entry.coreGfx
      .moveTo(curve.p0.x, curve.p0.y)
      .bezierCurveTo(curve.c1.x, curve.c1.y, curve.c2.x, curve.c2.y, curve.p1.x, curve.p1.y)
      .stroke({
        fill: coreGrad,
        width: PAINTERLY_CORE_WIDTH,
        cap: "round",
        join: "round",
      });

    this.drawChevronHead(entry.headGfx, curve, hue);
    this.drawPainterlyParticles(entry.particlesGfx, curve, hue);
  }

  private drawChevronHead(gfx: Graphics, curve: CubicCurve, color: number): void {
    const tan = cubicTangent(curve, 1);
    if (tan.ux === 0 && tan.uy === 0) return;
    const tip = curve.p1;
    const px = -tan.uy;
    const py = tan.ux;
    const baseX = tip.x - tan.ux * PAINTERLY_HEAD_LEN;
    const baseY = tip.y - tan.uy * PAINTERLY_HEAD_LEN;
    const halfW = PAINTERLY_HEAD_WIDTH / 2;
    const left = { x: baseX + px * halfW, y: baseY + py * halfW };
    const right = { x: baseX - px * halfW, y: baseY - py * halfW };

    // Open V (no fill) — chevron silhouette per spec.
    gfx
      .moveTo(left.x, left.y)
      .lineTo(tip.x, tip.y)
      .lineTo(right.x, right.y)
      .stroke({ color, width: PAINTERLY_HEAD_STROKE, cap: "round", join: "round" });
  }

  private drawPainterlyParticles(gfx: Graphics, curve: CubicCurve, color: number): void {
    // Each ember is a white-hot spark surrounded by a colored halo so it
    // reads against the painterly gradient stroke without blending in.
    for (let i = 0; i < PAINTERLY_PARTICLE_COUNT; i += 1) {
      const phase =
        (this.elapsedMs + PAINTERLY_PARTICLE_STAGGER_MS * i) / PAINTERLY_PARTICLE_CYCLE_MS;
      const t = phase - Math.floor(phase);
      const env = particleAlpha(t);
      if (env <= 0) continue;
      const pt = cubicAt(curve, t);
      const r = PAINTERLY_PARTICLE_SIZES[i % PAINTERLY_PARTICLE_SIZES.length]!;
      gfx.circle(pt.x, pt.y, r);
      gfx.fill({ color, alpha: env * PAINTERLY_PARTICLE_HALO_ALPHA });
      gfx.circle(pt.x, pt.y, r * PAINTERLY_PARTICLE_CORE_RATIO);
      gfx.fill({ color: 0xffffff, alpha: env });
    }
  }

  // ── Rune (attach) ────────────────────────────────────────────────────────
  private drawRune(entry: ArrowEntry, arrow: ArrowDef): void {
    const { ax1, ay1, ax2, ay2 } = shortenEndpoints(arrow.fromX, arrow.fromY, arrow.toX, arrow.toY);
    const curve = cubicCurve(ax1, ay1, ax2, ay2, BOW_RUNE);
    // Attach-line color uses the app primary so it picks up the active
    // theme's accent (kanagawa blue, gruvbox green, etc.) instead of the
    // game-layer pointer palette.
    const hue = hexToNum(this.theme.appTheme.primary);

    // Dashed line — sample the cubic and toggle pen segment-by-segment so
    // dashes follow the curvature (Pixi has no native curved dash support).
    const points = sampleCubic(curve, RUNE_BEZIER_STEPS);
    let drawing = true;
    let remaining = RUNE_DASH_ON;
    let prev = points[0]!;
    if (drawing) entry.coreGfx.moveTo(prev.x, prev.y);

    for (let i = 1; i < points.length; i += 1) {
      const cur = points[i]!;
      const segLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      if (segLen <= remaining) {
        if (drawing) entry.coreGfx.lineTo(cur.x, cur.y);
        remaining -= segLen;
      } else {
        if (drawing) {
          entry.coreGfx.lineTo(cur.x, cur.y);
          entry.coreGfx.stroke({
            color: hue,
            width: RUNE_LINE_WIDTH,
            alpha: RUNE_LINE_ALPHA,
            cap: "butt",
          });
        }
        drawing = !drawing;
        remaining = drawing ? RUNE_DASH_ON : RUNE_DASH_OFF;
        if (drawing) entry.coreGfx.moveTo(cur.x, cur.y);
      }
      prev = cur;
    }
    if (drawing) {
      entry.coreGfx.stroke({
        color: hue,
        width: RUNE_LINE_WIDTH,
        alpha: RUNE_LINE_ALPHA,
        cap: "butt",
      });
    }

    this.drawReticleHead(entry.headGfx, curve, hue);
    this.drawRuneParticles(entry.particlesGfx, curve, hue);
  }

  private drawReticleHead(gfx: Graphics, curve: CubicCurve, color: number): void {
    const tip = curve.p1;
    const tan = cubicTangent(curve, 1);
    const px = -tan.uy;
    const py = tan.ux;

    // Outer circle outline.
    gfx.circle(tip.x, tip.y, RUNE_RETICLE_OUTER_R);
    gfx.stroke({ color, width: 1, alpha: RUNE_LINE_ALPHA });

    // Filled inner dot.
    gfx.circle(tip.x, tip.y, RUNE_RETICLE_INNER_R);
    gfx.fill({ color, alpha: RUNE_LINE_ALPHA });

    // Two perpendicular ticks flanking the centre — gives the reticle its
    // crosshair feel without a full plus-sign.
    const tickFrom = RUNE_RETICLE_OUTER_R + 1;
    const tickTo = tickFrom + RUNE_RETICLE_TICK_LEN;
    gfx
      .moveTo(tip.x + px * tickFrom, tip.y + py * tickFrom)
      .lineTo(tip.x + px * tickTo, tip.y + py * tickTo)
      .moveTo(tip.x - px * tickFrom, tip.y - py * tickFrom)
      .lineTo(tip.x - px * tickTo, tip.y - py * tickTo)
      .stroke({ color, width: 1, alpha: RUNE_LINE_ALPHA });
  }

  private drawRuneParticles(gfx: Graphics, curve: CubicCurve, color: number): void {
    for (let i = 0; i < RUNE_PARTICLE_COUNT; i += 1) {
      const phase = (this.elapsedMs + RUNE_PARTICLE_STAGGER_MS * i) / RUNE_PARTICLE_CYCLE_MS;
      const t = phase - Math.floor(phase);
      const pt = cubicAt(curve, t);
      gfx.circle(pt.x, pt.y, RUNE_PARTICLE_RADIUS);
      gfx.fill({ color, alpha: particleAlpha(t) * RUNE_LINE_ALPHA });
    }
  }

  // ── Placement (drop-here marching-ants — unchanged from original) ────────
  private drawPlacement(entry: ArrowEntry, arrow: ArrowDef): void {
    const { ax1, ay1, ax2, ay2 } = shortenEndpoints(arrow.fromX, arrow.fromY, arrow.toX, arrow.toY);
    const curve = cubicCurve(ax1, ay1, ax2, ay2, BOW_PLACEMENT);
    const color = hexToNum(this.theme.gameTheme.activeAction.active);
    const points = sampleCubic(curve, PLACEMENT_BEZIER_STEPS);

    const cycle = PLACEMENT_DASH + PLACEMENT_GAP;
    let drawing = this.placementDashOffset % cycle < PLACEMENT_DASH;
    let remaining = drawing
      ? PLACEMENT_DASH - (this.placementDashOffset % cycle)
      : cycle - (this.placementDashOffset % cycle);

    let prev = points[0]!;
    if (drawing) entry.coreGfx.moveTo(prev.x, prev.y);

    for (let i = 1; i < points.length; i += 1) {
      const cur = points[i]!;
      const segLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      if (segLen <= remaining) {
        if (drawing) entry.coreGfx.lineTo(cur.x, cur.y);
        remaining -= segLen;
      } else {
        if (drawing) {
          entry.coreGfx.lineTo(cur.x, cur.y);
          entry.coreGfx.stroke({
            color,
            width: PLACEMENT_STROKE_WIDTH,
            alpha: PLACEMENT_ALPHA,
            cap: "round",
            join: "round",
          });
        }
        drawing = !drawing;
        remaining = drawing ? PLACEMENT_DASH : PLACEMENT_GAP;
        if (drawing) entry.coreGfx.moveTo(cur.x, cur.y);
      }
      prev = cur;
    }
    if (drawing) {
      entry.coreGfx.stroke({
        color,
        width: PLACEMENT_STROKE_WIDTH,
        alpha: PLACEMENT_ALPHA,
        cap: "round",
        join: "round",
      });
    }

    this.drawPlacementHead(entry.headGfx, curve, color);
  }

  private drawPlacementHead(gfx: Graphics, curve: CubicCurve, color: number): void {
    const tan = cubicTangent(curve, 1);
    if (tan.ux === 0 && tan.uy === 0) return;
    const tip = curve.p1;
    const px = -tan.uy;
    const py = tan.ux;
    const baseX = tip.x - tan.ux * PLACEMENT_HEAD_LEN;
    const baseY = tip.y - tan.uy * PLACEMENT_HEAD_LEN;
    const halfW = PLACEMENT_HEAD_WIDTH / 2;
    const notchX = baseX + tan.ux * (PLACEMENT_HEAD_LEN * 0.45);
    const notchY = baseY + tan.uy * (PLACEMENT_HEAD_LEN * 0.45);
    gfx
      .moveTo(tip.x, tip.y)
      .lineTo(baseX + px * halfW, baseY + py * halfW)
      .lineTo(notchX, notchY)
      .lineTo(baseX - px * halfW, baseY - py * halfW)
      .closePath();
    gfx.fill({ color, alpha: PLACEMENT_ALPHA });
  }
}
