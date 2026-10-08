import type { Rectangle } from "pixi.js";

type HoverBounds = Pick<Rectangle, "left" | "right" | "top" | "bottom">;
interface CurvedEdge {
  start: number;
  end: number;
  startValue: number;
  endValue: number;
  margin: number;
}
interface HoverBridge {
  horizontal: boolean;
  start: number;
  end: number;
  low: CurvedEdge;
  high: CurvedEdge;
}

const CURVE_MARGIN = 8;

function curvedEdge(along: number, edge: CurvedEdge): number {
  if (along <= edge.start) return edge.startValue;
  if (along >= edge.end) return edge.endValue;
  const progress = (along - edge.start) / (edge.end - edge.start);
  return (
    edge.startValue +
    (edge.endValue - edge.startValue) * progress +
    edge.margin * 4 * progress * (1 - progress)
  );
}

function previewHoverBridge(source: HoverBounds, target: HoverBounds): HoverBridge | null {
  const horizontal = target.left >= source.right || target.right <= source.left;
  if (!horizontal && target.top < source.bottom && target.bottom > source.top) return null;
  const first = (horizontal ? source.left < target.left : source.top < target.top)
    ? source
    : target;
  const second = first === source ? target : source;
  const startMin = horizontal ? first.left : first.top;
  const startMax = horizontal ? first.right : first.bottom;
  const startLow = horizontal ? first.top : first.left;
  const startHigh = horizontal ? first.bottom : first.right;
  const endMin = horizontal ? second.left : second.top;
  const endMax = horizontal ? second.right : second.bottom;
  const endLow = horizontal ? second.top : second.left;
  const endHigh = horizontal ? second.bottom : second.right;
  return {
    horizontal,
    start: startMin,
    end: endMax,
    low: {
      start: endLow < startLow ? startMin : startMax,
      end: endLow < startLow ? endMin : endMax,
      startValue: startLow,
      endValue: endLow,
      margin: -CURVE_MARGIN,
    },
    high: {
      start: endHigh > startHigh ? startMin : startMax,
      end: endHigh > startHigh ? endMin : endMax,
      startValue: startHigh,
      endValue: endHigh,
      margin: CURVE_MARGIN,
    },
  };
}

export function containsPreviewHoverBridge(
  x: number,
  y: number,
  source: HoverBounds,
  target: HoverBounds,
): boolean {
  if (
    (x >= source.left && x < source.right && y >= source.top && y < source.bottom) ||
    (x >= target.left && x < target.right && y >= target.top && y < target.bottom)
  ) {
    return false;
  }
  const bridge = previewHoverBridge(source, target);
  if (!bridge) return false;
  const along = bridge.horizontal ? x : y;
  const across = bridge.horizontal ? y : x;
  return (
    along >= bridge.start &&
    along <= bridge.end &&
    across >= curvedEdge(along, bridge.low) &&
    across <= curvedEdge(along, bridge.high)
  );
}

export function getPreviewHoverBridgePath(source: HoverBounds, target: HoverBounds): string {
  const bridge = previewHoverBridge(source, target);
  if (!bridge) return "";
  const { low, high } = bridge;
  const point = (along: number, across: number) =>
    bridge.horizontal ? `${along} ${across}` : `${across} ${along}`;
  const lowControl = (low.startValue + low.endValue) / 2 + low.margin * 2;
  const highControl = (high.startValue + high.endValue) / 2 + high.margin * 2;
  return [
    `M${point(bridge.start, low.startValue)}`,
    `L${point(low.start, low.startValue)}`,
    `Q${point((low.start + low.end) / 2, lowControl)} ${point(low.end, low.endValue)}`,
    `L${point(bridge.end, low.endValue)}`,
    `L${point(bridge.end, high.endValue)}`,
    `L${point(high.end, high.endValue)}`,
    `Q${point((high.start + high.end) / 2, highControl)} ${point(high.start, high.startValue)}`,
    `L${point(bridge.start, high.startValue)}Z`,
  ].join("");
}
