export const STACK_OFFSET_X = 36;
export const STACK_OFFSET_Y = 4;
export const STACK_HOVER_PUSH_X = 60;
export const STACK_HOVER_PUSH_DIST = 42;
export const STACK_RIGHT_MARGIN = 10;
export const STACK_CENTER_OFFSET_Y = -60;
export const STACK_PEEK_W = 16;

export interface StackLayoutCard {
  width: number;
  height: number;
}

export interface StackLayoutInput {
  viewWidth: number;
  viewHeight: number;
  cards: StackLayoutCard[];
  fallbackWidth: number;
  fallbackHeight: number;
  flash: StackLayoutCard | null;
  fanOut: boolean;
  hoveredIndex: number;
  hoverScale: number;
  buttonWidth: number;
  buttonGap: number;
}

export interface StackLayoutResult {
  cards: Array<{ x: number; y: number; zIndex: number }>;
  panelLeft: number;
  panelTop: number;
  pileWidth: number;
  pileHeight: number;
  drawLeft: number;
  xShift: number;
  centerY: number;
  buttonX: number;
  flash: { x: number; y: number } | null;
}

export function getRectBorderAnchor(
  center: { x: number; y: number },
  width: number,
  height: number,
  toward: { x: number; y: number },
): { x: number; y: number } {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return center;
  const xScale = Math.abs(dx) > 0.001 ? width / 2 / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const yScale = Math.abs(dy) > 0.001 ? height / 2 / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const scale = Math.min(xScale, yScale);
  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale,
  };
}

export function reconcileStackHover(
  hoveredId: string | null,
  incomingIds: ReadonlySet<string>,
  replacements: ReadonlyMap<string, string>,
): string | null {
  if (hoveredId === null) return null;
  const replacement = replacements.get(hoveredId);
  if (replacement !== undefined) return replacement;
  return incomingIds.has(hoveredId) ? hoveredId : null;
}

export function computeStackLayout(input: StackLayoutInput): StackLayoutResult {
  const n = input.cards.length;
  const flashWidth = input.flash?.width ?? 0;
  const flashHeight = input.flash?.height ?? 0;
  const cardWidth = Math.max(input.fallbackWidth, flashWidth, ...input.cards.map((c) => c.width));
  const cardHeight = Math.max(
    input.fallbackHeight,
    flashHeight,
    ...input.cards.map((c) => c.height),
  );
  const spanX = Math.max(0, n - 1) * STACK_OFFSET_X;
  const pileHeight = cardHeight + Math.max(0, n - 1) * STACK_OFFSET_Y;
  const pileWidth = spanX + 2 * STACK_HOVER_PUSH_X + cardWidth;
  const panelLeft = input.viewWidth - STACK_RIGHT_MARGIN - pileWidth;
  const panelTop = input.viewHeight / 2 - pileHeight / 2 + STACK_CENTER_OFFSET_Y;
  const centerY = panelTop + pileHeight / 2;
  const peekLeft = input.viewWidth - STACK_PEEK_W - STACK_HOVER_PUSH_X;
  const drawLeft = input.fanOut ? panelLeft : peekLeft;
  const xShift = spanX + STACK_HOVER_PUSH_X;
  const cards = input.cards.map((card, index) => {
    const baseLeft = -index * STACK_OFFSET_X;
    const pushed =
      input.hoveredIndex < 0 || index === input.hoveredIndex
        ? baseLeft
        : baseLeft + (index < input.hoveredIndex ? 1 : -1) * STACK_HOVER_PUSH_DIST;
    return {
      x: drawLeft + pushed + xShift + card.width / 2,
      y: panelTop + (n - 1 - index) * STACK_OFFSET_Y + card.height / 2,
      zIndex:
        input.hoveredIndex < 0
          ? index + 1
          : 200 -
            Math.abs(index - input.hoveredIndex) * 10 +
            (index === input.hoveredIndex ? 5 : 0),
    };
  });
  const topIndex = n - 1;
  const topBaseLeft = -topIndex * STACK_OFFSET_X;
  const topPushed =
    input.hoveredIndex < 0 || topIndex === input.hoveredIndex
      ? topBaseLeft
      : topBaseLeft + (topIndex < input.hoveredIndex ? 1 : -1) * STACK_HOVER_PUSH_DIST;
  const topWidth = topIndex >= 0 ? input.cards[topIndex]!.width : cardWidth;
  const topScale = input.hoveredIndex === topIndex ? input.hoverScale : 1;
  const topLeftEdge = drawLeft + topPushed + xShift + topWidth / 2 - (topWidth / 2) * topScale;
  const buttonX = topLeftEdge - input.buttonGap - input.buttonWidth / 2;
  const flashBaseLeft = n > 0 ? -(n - 1) * STACK_OFFSET_X : 0;
  const flash = input.flash
    ? {
        x: drawLeft + flashBaseLeft + xShift + input.flash.width / 2,
        y: panelTop + input.flash.height / 2,
      }
    : null;

  return {
    cards,
    panelLeft,
    panelTop,
    pileWidth,
    pileHeight,
    drawLeft,
    xShift,
    centerY,
    buttonX,
    flash,
  };
}
