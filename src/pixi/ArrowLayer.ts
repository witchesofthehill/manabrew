import { Container, FillGradient, Graphics, Sprite, type Texture } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { getTheme } from "@/hooks/useTheme";
import { hexToNum } from "./colorUtils";
import { gameIconTexture } from "./gameIconCache";
import type { ArrowType } from "./types";

const INFO_RETRY_MS = 1000;
const INFO_ICON = "info";
let infoTexture: Texture | null = null;
let infoLoading = false;
let infoRetryAfter = 0;
function ensureInfoTexture(): void {
  if (infoTexture || infoLoading || performance.now() < infoRetryAfter) return;
  infoLoading = true;
  void gameIconTexture(INFO_ICON)
    .then((texture) => {
      infoTexture = texture;
      infoRetryAfter = 0;
    })
    .catch(() => {
      infoRetryAfter = performance.now() + INFO_RETRY_MS;
    })
    .finally(() => {
      infoLoading = false;
    });
}

// Re-export so existing callers still import ArrowType from this module.
export type { ArrowType } from "./types";

export interface ArrowDef {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  type: ArrowType;
  /** Explicit hue (e.g. the casting arrow's intent color); falls back to the
   *  type's theme color when omitted. */
  color?: number;
  hint?: boolean;
  /** Placement arrows: the target grid slot's size, drawn as a dashed outline
   *  around the drop point so the player sees exactly where the permanent lands. */
  slot?: { width: number; height: number };
}

const ARROW_Z_INDEX = 8000;

const BOW_PAINTERLY = 0.3;
const BOW_RUNE = 0.3;
const BOW_PLACEMENT = 0.22;
const TAIL_SHORTEN = 6;
const TIP_SHORTEN = 12;

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

const PLACEMENT_STROKE_WIDTH = 3;
const PLACEMENT_ALPHA = 0.7;
const PLACEMENT_DASH = 9;
const PLACEMENT_GAP = 6;
const PLACEMENT_BEZIER_STEPS = 64;
const PLACEMENT_DASH_SPEED_PX_PER_SEC = 48;
const PLACEMENT_HEAD_LEN = 14;
const PLACEMENT_HEAD_WIDTH = 11;

const SLOT_RADIUS = 6;
const SLOT_DASH = 1;
const SLOT_GAP = 6;
const SLOT_STROKE_WIDTH = 2;
const SLOT_ALPHA = 0.9;

const CAST_STROKE_WIDTH = 3;
const CAST_ALPHA = 0.85;
const CAST_DASH = 10;
const CAST_GAP = 7;
const CAST_HEAD_LEN = 14;
const CAST_HEAD_WIDTH = 12;

interface DashedArrowStyle {
  color: number;
  strokeWidth: number;
  alpha: number;
  dash: number;
  gap: number;
  headLen: number;
  headWidth: number;
  dashOffset: number;
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

function roundedRectPath(cx: number, cy: number, w: number, h: number, r: number): Point[] {
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  const x1 = cx + w / 2;
  const y1 = cy + h / 2;
  const rr = Math.min(r, w / 2, h / 2);
  const pts: Point[] = [];
  const arc = (ax: number, ay: number, a0: number, a1: number): void => {
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (a1 - a0) * (i / steps);
      pts.push({ x: ax + Math.cos(a) * rr, y: ay + Math.sin(a) * rr });
    }
  };
  arc(x0 + rr, y0 + rr, Math.PI, Math.PI * 1.5);
  arc(x1 - rr, y0 + rr, Math.PI * 1.5, Math.PI * 2);
  arc(x1 - rr, y1 - rr, 0, Math.PI * 0.5);
  arc(x0 + rr, y1 - rr, Math.PI * 0.5, Math.PI);
  pts.push(pts[0]!);
  return pts;
}

function hueWithAlpha(hue: number, alpha: number): number[] {
  return [((hue >> 16) & 255) / 255, ((hue >> 8) & 255) / 255, (hue & 255) / 255, alpha];
}

function particleAlpha(t: number): number {
  if (t < 0.25) return t / 0.25;
  if (t > 0.75) return (1 - t) / 0.25;
  return 1;
}

type ArrowAnimation =
  | { kind: "painterly"; curve: CubicCurve; color: number }
  | { kind: "rune"; curve: CubicCurve; color: number }
  | { kind: "dashed"; points: Point[]; style: DashedArrowStyle };

interface ArrowEntry {
  root: Container;
  underGfx: Graphics;
  coreGfx: Graphics;
  headGfx: Graphics;
  particlesGfx: Graphics;
  marker: Sprite;
  geometryKey: string;
  arrow: ArrowDef | null;
  animation: ArrowAnimation | null;
  gradKey: string;
  underGrad: FillGradient | null;
  coreGrad: FillGradient | null;
}

const HINT_ICON_SIZE = 26;
const HINT_PULSE_AMP = 0.18;
const HINT_PULSE_PERIOD_MS = 240;

export class ArrowLayer {
  private root: Container;
  private theme: Theme = getTheme();
  private arrows: ArrowDef[] = [];
  private pool: ArrowEntry[] = [];
  private elapsedMs = 0;
  private dashMarchOffset = 0;
  private themeRevision = 0;
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
    this.themeRevision += 1;
    if (this.arrows.length > 0) this.renderEntries();
  }

  update(arrows: ArrowDef[], deltaMs = 0): void {
    if (arrows.length === 0 && this.clear) return;
    this.elapsedMs += deltaMs;
    this.dashMarchOffset =
      (this.dashMarchOffset + (deltaMs / 1000) * PLACEMENT_DASH_SPEED_PX_PER_SEC) %
      ((PLACEMENT_DASH + PLACEMENT_GAP) * (CAST_DASH + CAST_GAP));
    this.arrows = arrows;
    this.ensurePool(arrows.length);
    this.renderEntries();
    this.clear = arrows.length === 0;
  }

  destroy(): void {
    for (const entry of this.pool) {
      entry.underGrad?.destroy();
      entry.coreGrad?.destroy();
      entry.root.destroy({ children: true });
    }
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
      const marker = new Sprite();
      marker.anchor.set(0.5);
      marker.visible = false;
      root.addChild(underGfx);
      root.addChild(coreGfx);
      root.addChild(headGfx);
      root.addChild(particlesGfx);
      root.addChild(marker);
      this.root.addChild(root);
      this.pool.push({
        root,
        underGfx,
        coreGfx,
        headGfx,
        particlesGfx,
        marker,
        geometryKey: "",
        arrow: null,
        animation: null,
        gradKey: "",
        underGrad: null,
        coreGrad: null,
      });
    }
  }

  private renderEntries(): void {
    for (let index = 0; index < this.pool.length; index += 1) {
      const entry = this.pool[index]!;
      const arrow = this.arrows[index];
      if (!arrow) {
        entry.root.visible = false;
        entry.arrow = null;
        entry.animation = null;
        entry.geometryKey = "";
        continue;
      }

      entry.root.visible = true;
      const geometryKey = this.geometryKey(arrow);
      if (entry.geometryKey !== geometryKey) {
        this.setupArrow(entry, arrow);
        entry.geometryKey = geometryKey;
      }
      entry.arrow = arrow;
      this.drawAnimation(entry);
    }
  }

  private geometryKey(arrow: ArrowDef): string {
    return [
      this.themeRevision,
      arrow.type,
      arrow.fromX,
      arrow.fromY,
      arrow.toX,
      arrow.toY,
      arrow.color ?? "",
      arrow.hint ? 1 : 0,
      arrow.slot?.width ?? "",
      arrow.slot?.height ?? "",
    ].join(":");
  }

  private setupArrow(entry: ArrowEntry, arrow: ArrowDef): void {
    entry.underGfx.clear();
    entry.coreGfx.clear();
    entry.headGfx.clear();
    entry.particlesGfx.clear();
    entry.marker.visible = false;
    entry.animation = null;

    switch (arrow.type) {
      case "attack":
      case "block":
        this.setupPainterly(entry, arrow);
        break;
      case "casting":
        this.setupPlacement(entry, arrow, {
          color: arrow.color ?? hexToNum(this.theme.gameTheme.arrow.friendlyTarget),
          strokeWidth: CAST_STROKE_WIDTH,
          alpha: CAST_ALPHA,
          dash: CAST_DASH,
          gap: CAST_GAP,
          headLen: CAST_HEAD_LEN,
          headWidth: CAST_HEAD_WIDTH,
          dashOffset: this.dashMarchOffset,
        });
        break;
      case "attach":
        this.setupRune(entry, arrow);
        break;
      case "placement":
        this.setupPlacement(entry, arrow, {
          color: hexToNum(this.theme.gameTheme.activeAction.active),
          strokeWidth: PLACEMENT_STROKE_WIDTH,
          alpha: PLACEMENT_ALPHA,
          dash: PLACEMENT_DASH,
          gap: PLACEMENT_GAP,
          headLen: PLACEMENT_HEAD_LEN,
          headWidth: PLACEMENT_HEAD_WIDTH,
          dashOffset: this.dashMarchOffset,
        });
        break;
    }
    if (arrow.slot) this.drawPlacementSlot(entry, arrow);
    if (arrow.hint) ensureInfoTexture();
  }

  private drawAnimation(entry: ArrowEntry): void {
    const animation = entry.animation;
    if (animation?.kind === "painterly") {
      entry.particlesGfx.clear();
      this.drawPainterlyParticles(entry.particlesGfx, animation.curve, animation.color);
    } else if (animation?.kind === "rune") {
      entry.particlesGfx.clear();
      this.drawRuneParticles(entry.particlesGfx, animation.curve, animation.color);
    } else if (animation?.kind === "dashed") {
      entry.coreGfx.clear();
      animation.style.dashOffset = this.dashMarchOffset;
      this.strokeDashedPath(entry.coreGfx, animation.points, animation.style);
    }

    entry.marker.visible = false;
    if (entry.arrow?.hint) {
      this.drawHintCallout(entry, entry.arrow.toX, entry.arrow.toY);
    }
  }

  private drawHintCallout(entry: ArrowEntry, x: number, y: number): void {
    ensureInfoTexture();
    if (!infoTexture) return;
    const pulse = 1 + HINT_PULSE_AMP * Math.sin(this.elapsedMs / HINT_PULSE_PERIOD_MS);
    entry.marker.texture = infoTexture;
    entry.marker.tint = hexToNum(this.theme.gameTheme.activeAction.active);
    entry.marker.scale.set((HINT_ICON_SIZE / infoTexture.width) * pulse);
    entry.marker.position.set(x, y);
    entry.marker.visible = true;
  }

  private setupPainterly(entry: ArrowEntry, arrow: ArrowDef): void {
    const { ax1, ay1, ax2, ay2 } = shortenEndpoints(arrow.fromX, arrow.fromY, arrow.toX, arrow.toY);
    const curve = cubicCurve(ax1, ay1, ax2, ay2, BOW_PAINTERLY);
    const hue =
      arrow.color ??
      hexToNum(
        arrow.type === "attack"
          ? this.theme.gameTheme.pointer.hostile
          : this.theme.gameTheme.pointer.friendly,
      );

    const gradKey = `${ax1.toFixed(1)},${ay1.toFixed(1)},${ax2.toFixed(1)},${ay2.toFixed(1)},${hue}`;
    if (entry.gradKey !== gradKey || !entry.underGrad || !entry.coreGrad) {
      entry.underGrad?.destroy();
      entry.coreGrad?.destroy();
      entry.underGrad = new FillGradient(ax1, ay1, ax2, ay2);
      entry.coreGrad = new FillGradient(ax1, ay1, ax2, ay2);
      for (const [stop, alpha] of PAINTERLY_GRADIENT_STOPS) {
        const color = hueWithAlpha(hue, alpha);
        entry.underGrad.addColorStop(stop, color);
        entry.coreGrad.addColorStop(stop, color);
      }
      entry.gradKey = gradKey;
    }

    entry.underGfx
      .moveTo(curve.p0.x, curve.p0.y)
      .bezierCurveTo(curve.c1.x, curve.c1.y, curve.c2.x, curve.c2.y, curve.p1.x, curve.p1.y)
      .stroke({
        fill: entry.underGrad,
        width: PAINTERLY_UNDER_WIDTH,
        alpha: PAINTERLY_UNDER_ALPHA,
        cap: "round",
        join: "round",
      });
    entry.coreGfx
      .moveTo(curve.p0.x, curve.p0.y)
      .bezierCurveTo(curve.c1.x, curve.c1.y, curve.c2.x, curve.c2.y, curve.p1.x, curve.p1.y)
      .stroke({
        fill: entry.coreGrad,
        width: PAINTERLY_CORE_WIDTH,
        cap: "round",
        join: "round",
      });
    this.drawChevronHead(entry.headGfx, curve, hue);
    entry.animation = { kind: "painterly", curve, color: hue };
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
      gfx.fill({ color: hexToNum(this.theme.gameTheme.textOnTinted), alpha: env });
    }
  }

  private setupRune(entry: ArrowEntry, arrow: ArrowDef): void {
    const { ax1, ay1, ax2, ay2 } = shortenEndpoints(arrow.fromX, arrow.fromY, arrow.toX, arrow.toY);
    const curve = cubicCurve(ax1, ay1, ax2, ay2, BOW_RUNE);
    const hue = hexToNum(this.theme.appTheme.primary);
    const points = sampleCubic(curve, RUNE_BEZIER_STEPS);
    let drawing = true;
    let remaining = RUNE_DASH_ON;
    let prev = points[0]!;
    entry.coreGfx.moveTo(prev.x, prev.y);

    for (let index = 1; index < points.length; index += 1) {
      const current = points[index]!;
      const segmentLength = Math.hypot(current.x - prev.x, current.y - prev.y);
      if (segmentLength <= remaining) {
        if (drawing) entry.coreGfx.lineTo(current.x, current.y);
        remaining -= segmentLength;
      } else {
        if (drawing) {
          entry.coreGfx.lineTo(current.x, current.y);
          entry.coreGfx.stroke({
            color: hue,
            width: RUNE_LINE_WIDTH,
            alpha: RUNE_LINE_ALPHA,
            cap: "butt",
          });
        }
        drawing = !drawing;
        remaining = drawing ? RUNE_DASH_ON : RUNE_DASH_OFF;
        if (drawing) entry.coreGfx.moveTo(current.x, current.y);
      }
      prev = current;
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
    entry.animation = { kind: "rune", curve, color: hue };
  }

  private drawReticleHead(gfx: Graphics, curve: CubicCurve, color: number): void {
    const tip = curve.p1;
    const tan = cubicTangent(curve, 1);
    const px = -tan.uy;
    const py = tan.ux;

    gfx.circle(tip.x, tip.y, RUNE_RETICLE_OUTER_R);
    gfx.stroke({ color, width: 1, alpha: RUNE_LINE_ALPHA });

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

  private setupPlacement(entry: ArrowEntry, arrow: ArrowDef, style: DashedArrowStyle): void {
    const { ax1, ay1, ax2, ay2 } = shortenEndpoints(arrow.fromX, arrow.fromY, arrow.toX, arrow.toY);
    const curve = cubicCurve(ax1, ay1, ax2, ay2, BOW_PLACEMENT);
    const points = sampleCubic(curve, PLACEMENT_BEZIER_STEPS);
    this.drawPlacementHead(entry.headGfx, curve, style.color, style);
    entry.animation = { kind: "dashed", points, style };
  }

  private strokeDashedPath(gfx: Graphics, points: Point[], style: DashedArrowStyle): void {
    const cycle = style.dash + style.gap;
    let drawing = style.dashOffset % cycle < style.dash;
    let remaining = drawing
      ? style.dash - (style.dashOffset % cycle)
      : cycle - (style.dashOffset % cycle);
    const stroke = (): Graphics =>
      gfx.stroke({
        color: style.color,
        width: style.strokeWidth,
        alpha: style.alpha,
        cap: "round",
        join: "round",
      });

    let previous = points[0]!;
    if (drawing) gfx.moveTo(previous.x, previous.y);
    for (let index = 1; index < points.length; index += 1) {
      const current = points[index]!;
      const segmentLength = Math.hypot(current.x - previous.x, current.y - previous.y);
      if (segmentLength <= remaining) {
        if (drawing) gfx.lineTo(current.x, current.y);
        remaining -= segmentLength;
      } else {
        if (drawing) {
          gfx.lineTo(current.x, current.y);
          stroke();
        }
        drawing = !drawing;
        remaining = drawing ? style.dash : style.gap;
        if (drawing) gfx.moveTo(current.x, current.y);
      }
      previous = current;
    }
    if (drawing) stroke();
  }

  private drawPlacementSlot(entry: ArrowEntry, arrow: ArrowDef): void {
    if (!arrow.slot) return;
    const pts = roundedRectPath(
      arrow.toX,
      arrow.toY,
      arrow.slot.width,
      arrow.slot.height,
      SLOT_RADIUS,
    );
    const gfx = entry.underGfx;
    const color = hexToNum(this.theme.gameTheme.activeAction.active);
    const cycle = SLOT_DASH + SLOT_GAP;
    let dist = 0;
    let prev = pts[0]!;
    for (let i = 1; i < pts.length; i += 1) {
      const cur = pts[i]!;
      const segLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      if (segLen === 0) {
        prev = cur;
        continue;
      }
      const ux = (cur.x - prev.x) / segLen;
      const uy = (cur.y - prev.y) / segLen;
      let pos = 0;
      while (pos < segLen) {
        const inDash = dist < SLOT_DASH;
        const step = Math.min((inDash ? SLOT_DASH : cycle) - dist, segLen - pos);
        if (inDash) {
          gfx.moveTo(prev.x + ux * pos, prev.y + uy * pos);
          gfx.lineTo(prev.x + ux * (pos + step), prev.y + uy * (pos + step));
          gfx.stroke({
            color,
            width: SLOT_STROKE_WIDTH,
            alpha: SLOT_ALPHA,
            cap: "round",
            join: "round",
          });
        }
        pos += step;
        dist = (dist + step) % cycle;
      }
      prev = cur;
    }
  }

  private drawPlacementHead(
    gfx: Graphics,
    curve: CubicCurve,
    color: number,
    style: DashedArrowStyle,
  ): void {
    const tan = cubicTangent(curve, 1);
    if (tan.ux === 0 && tan.uy === 0) return;
    const tip = curve.p1;
    const px = -tan.uy;
    const py = tan.ux;
    const baseX = tip.x - tan.ux * style.headLen;
    const baseY = tip.y - tan.uy * style.headLen;
    const halfW = style.headWidth / 2;
    const notchX = baseX + tan.ux * (style.headLen * 0.45);
    const notchY = baseY + tan.uy * (style.headLen * 0.45);
    gfx
      .moveTo(tip.x, tip.y)
      .lineTo(baseX + px * halfW, baseY + py * halfW)
      .lineTo(notchX, notchY)
      .lineTo(baseX - px * halfW, baseY - py * halfW)
      .closePath();
    gfx.fill({ color, alpha: style.alpha });
  }
}
