export interface Point {
  x: number;
  y: number;
}

export interface CubicCurve {
  p0: Point;
  c1: Point;
  c2: Point;
  p1: Point;
}

export function unit(dx: number, dy: number): { ux: number; uy: number; len: number } {
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return { ux: 0, uy: 0, len: 0 };
  return { ux: dx / len, uy: dy / len, len };
}

export function cubicCurve(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bow: number,
): CubicCurve {
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

export function cubicTangent(curve: CubicCurve, t: number): { ux: number; uy: number } {
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

export function shortenSegmentEndpoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  tailShorten: number,
  tipShorten: number,
): { ax1: number; ay1: number; ax2: number; ay2: number } {
  const { ux, uy, len } = unit(x2 - x1, y2 - y1);
  if (len === 0) return { ax1: x1, ay1: y1, ax2: x2, ay2: y2 };
  return {
    ax1: x1 + ux * tailShorten,
    ay1: y1 + uy * tailShorten,
    ax2: x2 - ux * tipShorten,
    ay2: y2 - uy * tipShorten,
  };
}
