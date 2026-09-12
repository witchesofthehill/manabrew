import type { Rectangle } from "pixi.js";

const CURVE_MARGIN = 8;

function curvedEdge(
  along: number,
  start: number,
  end: number,
  startValue: number,
  endValue: number,
  margin: number,
): number {
  if (along <= start) return startValue;
  if (along >= end) return endValue;
  const progress = (along - start) / (end - start);
  return startValue + (endValue - startValue) * progress + margin * 4 * progress * (1 - progress);
}

function containsBridge(
  along: number,
  across: number,
  startMin: number,
  startMax: number,
  startLow: number,
  startHigh: number,
  endMin: number,
  endMax: number,
  endLow: number,
  endHigh: number,
): boolean {
  if (along < startMin || along > endMax) return false;
  const low = curvedEdge(
    along,
    endLow < startLow ? startMin : startMax,
    endLow < startLow ? endMin : endMax,
    startLow,
    endLow,
    -CURVE_MARGIN,
  );
  const high = curvedEdge(
    along,
    endHigh > startHigh ? startMin : startMax,
    endHigh > startHigh ? endMin : endMax,
    startHigh,
    endHigh,
    CURVE_MARGIN,
  );
  return across >= low && across <= high;
}

export function containsPreviewHoverBridge(
  x: number,
  y: number,
  source: Rectangle,
  target: Rectangle,
): boolean {
  if (source.contains(x, y) || target.contains(x, y)) return false;
  if (target.left >= source.right || target.right <= source.left) {
    const first = source.left < target.left ? source : target;
    const second = first === source ? target : source;
    return containsBridge(
      x,
      y,
      first.left,
      first.right,
      first.top,
      first.bottom,
      second.left,
      second.right,
      second.top,
      second.bottom,
    );
  }
  if (target.top >= source.bottom || target.bottom <= source.top) {
    const first = source.top < target.top ? source : target;
    const second = first === source ? target : source;
    return containsBridge(
      y,
      x,
      first.top,
      first.bottom,
      first.left,
      first.right,
      second.top,
      second.bottom,
      second.left,
      second.right,
    );
  }
  return false;
}
