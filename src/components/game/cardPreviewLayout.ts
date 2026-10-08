import { GAME_CARD_SIZES } from "./game.constants";
import { getSafeAreaInsets } from "@/lib/safeArea";

const { width: CARD_W, height: CARD_H } = GAME_CARD_SIZES.preview;
const ACTIONS_PANEL_W = 220;
export const CARD_PREVIEW_ANCHOR_GAP = 12;
export const CARD_PREVIEW_EDGE_PAD = 8;

export interface PreviewLayoutInput {
  placement: "auto" | "top-center" | "pinned";
  anchorRect: DOMRect | null;
  mouseX: number;
  mouseY: number;
  horizontal: boolean;
  hasPanel: boolean;
  panelHeight: number;
  slot: HTMLElement | null;
  viewportRight?: number;
  viewportBottom?: number;
}

export interface PreviewLayout {
  cardLeft: number;
  top: number;
  cardWidth: number;
  cardHeight: number;
  sidePanelWidth: number;
  panelSide: "left" | "right";
  panelScale: number;
  slotMarginLeft: number;
}
export interface PreviewCardDimensionsInput {
  usableWidth: number;
  usableHeight: number;
  horizontal: boolean;
  reservedWidth?: number;
}

export function computePreviewCardDimensions(input: PreviewCardDimensionsInput): {
  width: number;
  height: number;
} {
  const naturalWidth = input.horizontal ? CARD_H : CARD_W;
  const naturalHeight = input.horizontal ? CARD_W : CARD_H;
  const horizontalScale = Math.max(
    0.1,
    (input.usableWidth - (input.reservedWidth ?? 0) - 16) / naturalWidth,
  );
  const verticalScale = Math.max(1, input.usableHeight - 16) / naturalHeight;
  const scale = Math.min(1, horizontalScale, verticalScale);
  return {
    width: naturalWidth * scale,
    height: naturalHeight * scale,
  };
}

export function computePreviewLayout(input: PreviewLayoutInput): PreviewLayout {
  const { placement, anchorRect, mouseX, mouseY, horizontal, hasPanel, panelHeight, slot } = input;

  const safe = getSafeAreaInsets();
  const viewLeft = safe.left;
  const viewRight = Math.min(
    window.innerWidth - safe.right,
    input.viewportRight ?? Number.POSITIVE_INFINITY,
  );
  const viewTop = safe.top;
  const viewBottom = Math.min(
    window.innerHeight - safe.bottom,
    input.viewportBottom ?? Number.POSITIVE_INFINITY,
  );
  const naturalCardWidth = horizontal ? CARD_H : CARD_W;
  const usableHeight = slot ? slot.clientHeight : viewBottom - viewTop;
  const usableWidth = slot ? slot.clientWidth : viewRight - viewLeft;
  const maxPanelWidth = usableWidth - naturalCardWidth * 0.1 - 10 - 16;
  const sidePanelWidth = hasPanel
    ? Math.max(48, Math.min(ACTIONS_PANEL_W, usableWidth * 0.4, maxPanelWidth))
    : 0;
  const panelSpace = hasPanel ? sidePanelWidth + 10 : 0;
  const { width: cardWidth, height: cardHeight } = computePreviewCardDimensions({
    usableWidth,
    usableHeight,
    horizontal,
    reservedWidth: panelSpace,
  });
  const availableHeight = Math.max(1, usableHeight - 16);
  let panelScale = hasPanel && panelHeight > 0 ? Math.min(1, availableHeight / panelHeight) : 1;
  const totalWidth = cardWidth + panelSpace;

  const panelFitsRightOf = (left: number) =>
    !hasPanel || left + cardWidth + panelSpace <= viewRight - CARD_PREVIEW_EDGE_PAD;

  let cardLeft: number;
  let top: number;
  let panelSide: "left" | "right";

  if (placement === "pinned") {
    cardLeft = viewRight - cardWidth - 16;
    top = viewTop + 80;
    panelSide = "left";
  } else if (placement === "top-center" && anchorRect) {
    cardLeft = anchorRect.left + anchorRect.width / 2 - cardWidth / 2;
    top = Math.max(
      viewTop + CARD_PREVIEW_EDGE_PAD,
      anchorRect.top - cardHeight - CARD_PREVIEW_ANCHOR_GAP,
    );
    panelSide = panelFitsRightOf(cardLeft) ? "right" : "left";
  } else {
    const anchorLeft = anchorRect ? anchorRect.left : mouseX;
    const anchorRight = anchorRect ? anchorRect.right : mouseX;
    const anchorTop = anchorRect ? anchorRect.top : mouseY;
    const anchorBottom = anchorRect ? anchorRect.bottom : mouseY;
    const anchorMidY = anchorRect ? anchorRect.top + anchorRect.height / 2 : mouseY;

    const fitsRight =
      anchorRight + CARD_PREVIEW_ANCHOR_GAP + totalWidth <= viewRight - CARD_PREVIEW_EDGE_PAD;
    const fitsLeft =
      anchorLeft - CARD_PREVIEW_ANCHOR_GAP - totalWidth >= viewLeft + CARD_PREVIEW_EDGE_PAD;

    if (fitsRight) {
      cardLeft = anchorRight + CARD_PREVIEW_ANCHOR_GAP;
      panelSide = "right";
      top = Math.min(
        Math.max(anchorMidY - cardHeight / 2, viewTop + CARD_PREVIEW_EDGE_PAD),
        viewBottom - cardHeight - CARD_PREVIEW_EDGE_PAD,
      );
    } else if (fitsLeft) {
      cardLeft = anchorLeft - CARD_PREVIEW_ANCHOR_GAP - cardWidth;
      panelSide = "left";
      top = Math.min(
        Math.max(anchorMidY - cardHeight / 2, viewTop + CARD_PREVIEW_EDGE_PAD),
        viewBottom - cardHeight - CARD_PREVIEW_EDGE_PAD,
      );
    } else {
      cardLeft = (anchorLeft + anchorRight) / 2 - cardWidth / 2;
      const spaceAbove = anchorTop - 16;
      const spaceBelow = viewBottom - anchorBottom - 16;
      const below = spaceBelow >= spaceAbove;
      top = below
        ? Math.min(
            anchorBottom + CARD_PREVIEW_ANCHOR_GAP,
            viewBottom - cardHeight - CARD_PREVIEW_EDGE_PAD,
          )
        : Math.max(
            viewTop + CARD_PREVIEW_EDGE_PAD,
            anchorTop - cardHeight - CARD_PREVIEW_ANCHOR_GAP,
          );
      panelSide = panelFitsRightOf(cardLeft) ? "right" : "left";
    }
  }

  cardLeft = Math.max(
    viewLeft + CARD_PREVIEW_EDGE_PAD + (panelSide === "left" ? panelSpace : 0),
    Math.min(
      cardLeft,
      viewRight - cardWidth - CARD_PREVIEW_EDGE_PAD - (panelSide === "right" ? panelSpace : 0),
    ),
  );
  top = Math.max(
    viewTop + CARD_PREVIEW_EDGE_PAD,
    Math.min(top, viewBottom - cardHeight - CARD_PREVIEW_EDGE_PAD),
  );
  if (!slot && hasPanel && panelHeight > 0) {
    panelScale = Math.min(
      1,
      Math.max(0.1, (viewBottom - top - CARD_PREVIEW_EDGE_PAD) / panelHeight),
    );
  }

  const slotMarginLeft = slot
    ? Math.max(
        panelSide === "left" ? panelSpace : 0,
        (slot.clientWidth - totalWidth) / 2 + (panelSide === "left" ? panelSpace : 0),
      )
    : 0;

  return {
    cardLeft,
    top,
    cardWidth,
    cardHeight,
    sidePanelWidth,
    panelSide,
    panelScale,
    slotMarginLeft,
  };
}
