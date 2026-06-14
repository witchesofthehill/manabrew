const ARC_RADIUS = 900;
const MAX_ARC_DEG = 30;

export const HOVER_SCALE = 1.8;

export const HAND_FAN_PARAMS = {
  hoverLift: 70,
  neighborPush: 78,
  maxSpread: 90,
  minSpread: 38,
  spreadWidth: 900,
} as const;

export interface BaseCardLayout {
  x: number;
  drop: number;
  rot: number;
}

export interface HandCardLayout {
  x: number;
  y: number;
  rotation: number;
  scaleW: number;
  scaleH: number;
}

export function computeBaseLayout(
  count: number,
  cardW: number,
  maxSpread: number,
  minSpread: number,
  spreadWidth: number,
): BaseCardLayout[] {
  if (count === 0) return [];
  if (count === 1) return [{ x: 0, drop: 0, rot: 0 }];

  const spread = Math.max(
    minSpread,
    Math.min(maxSpread, Math.floor((spreadWidth - cardW) / (count - 1))),
  );
  const totalWidth = (count - 1) * spread;
  const arcDeg = Math.min(MAX_ARC_DEG, count * 2.5);

  return Array.from({ length: count }, (_, i) => {
    const t = (i / (count - 1)) * 2 - 1;
    const x = -totalWidth / 2 + i * spread;
    const rot = t * (arcDeg / 2);
    const drop = (1 - Math.cos((t * Math.PI) / 2)) * (ARC_RADIUS * 0.015);
    return { x, drop, rot };
  });
}

export function computeHandLayout(
  count: number,
  cardW: number,
  cardH: number,
  maxSpread: number,
  minSpread: number,
  spreadWidth: number,
  hoveredIndex: number | null,
  hoverLift: number,
  neighborPush: number,
): HandCardLayout[] {
  const basePositions = computeBaseLayout(count, cardW, maxSpread, minSpread, spreadWidth);
  if (basePositions.length === 0) return [];

  const hovW = Math.round(cardW * HOVER_SCALE);
  const hovH = Math.round(cardH * HOVER_SCALE);

  return basePositions.map((pos, i) => {
    const isHov = hoveredIndex === i;

    let pushX = 0;
    if (hoveredIndex !== null && hoveredIndex >= 0 && i !== hoveredIndex) {
      const dist = Math.abs(i - hoveredIndex);
      const sign = i < hoveredIndex ? -1 : 1;
      pushX = sign * Math.max(0, neighborPush - dist * 6);
    }

    const curW = isHov ? hovW : cardW;
    const curH = isHov ? hovH : cardH;
    const tx = pos.x + pushX;
    const ty = isHov ? -hoverLift : pos.drop;
    const rot = isHov ? 0 : pos.rot;

    return {
      x: tx,
      y: ty,
      rotation: rot,
      scaleW: curW,
      scaleH: curH,
    };
  });
}
