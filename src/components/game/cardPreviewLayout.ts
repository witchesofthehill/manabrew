import { FLASH_CARD_SIZE } from "./game.styles";
import { getSafeAreaInsets } from "@/lib/safeArea";

const { w: CARD_W, h: CARD_H } = FLASH_CARD_SIZE;
const ACTIONS_PANEL_W = 220;
const ANCHOR_GAP = 12;
const EDGE_PAD = 8;

export type PreviewSide = "left" | "right" | "above" | "below" | "center";

export interface PreviewLayoutInput {
  placement: "auto" | "top-center" | "pinned";
  anchorRect: DOMRect | null;
  mouseX: number;
  mouseY: number;
  horizontal: boolean;
  hasPanel: boolean;
  panelHeight: number;
  slot: HTMLElement | null;
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
  side: PreviewSide;
}

export function computePreviewLayout(input: PreviewLayoutInput): PreviewLayout {
  const { placement, anchorRect, mouseX, mouseY, horizontal, hasPanel, panelHeight, slot } = input;

  const safe = getSafeAreaInsets();
  const viewLeft = safe.left;
  const viewRight = window.innerWidth - safe.right;
  const viewTop = safe.top;
  const viewBottom = window.innerHeight - safe.bottom;
  const naturalCardWidth = horizontal ? CARD_H : CARD_W;
  const naturalCardHeight = horizontal ? CARD_W : CARD_H;
  const usableWidth = slot ? slot.clientWidth : viewRight - viewLeft;
  const maxPanelWidth = usableWidth - naturalCardWidth * 0.1 - 10 - 16;
  const sidePanelWidth = hasPanel
    ? Math.max(48, Math.min(ACTIONS_PANEL_W, usableWidth * 0.4, maxPanelWidth))
    : 0;
  const panelSpace = hasPanel ? sidePanelWidth + 10 : 0;
  const horizontalScale = Math.max(0.1, (usableWidth - panelSpace - 16) / naturalCardWidth);
  const availableHeight = Math.max(1, slot ? slot.clientHeight - 8 : viewBottom - viewTop - 16);
  const verticalScale = availableHeight / naturalCardHeight;
  const previewScale = Math.min(1, horizontalScale, verticalScale);
  const cardWidth = naturalCardWidth * previewScale;
  const cardHeight = naturalCardHeight * previewScale;
  const panelScale = hasPanel && panelHeight > 0 ? Math.min(1, availableHeight / panelHeight) : 1;
  const previewHeight = Math.max(cardHeight, panelHeight * panelScale);
  const totalWidth = cardWidth + panelSpace;

  const panelFitsRightOf = (left: number) =>
    !hasPanel || left + cardWidth + panelSpace <= viewRight - EDGE_PAD;

  let cardLeft: number;
  let top: number;
  let side: PreviewSide;
  let panelSide: "left" | "right";

  if (placement === "pinned") {
    cardLeft = viewRight - cardWidth - 16;
    top = viewTop + 80;
    side = "center";
    panelSide = "left";
  } else if (placement === "top-center" && anchorRect) {
    cardLeft = anchorRect.left + anchorRect.width / 2 - cardWidth / 2;
    top = Math.max(viewTop + EDGE_PAD, anchorRect.top - cardHeight - ANCHOR_GAP);
    side = "above";
    panelSide = panelFitsRightOf(cardLeft) ? "right" : "left";
  } else {
    const anchorLeft = anchorRect ? anchorRect.left : mouseX;
    const anchorRight = anchorRect ? anchorRect.right : mouseX;
    const anchorTop = anchorRect ? anchorRect.top : mouseY;
    const anchorBottom = anchorRect ? anchorRect.bottom : mouseY;
    const anchorMidY = anchorRect ? anchorRect.top + anchorRect.height / 2 : mouseY;

    const fitsRight = anchorRight + ANCHOR_GAP + totalWidth <= viewRight - EDGE_PAD;
    const fitsLeft = anchorLeft - ANCHOR_GAP - totalWidth >= viewLeft + EDGE_PAD;

    if (fitsRight) {
      cardLeft = anchorRight + ANCHOR_GAP;
      side = "right";
      panelSide = "right";
      top = Math.min(
        Math.max(anchorMidY - cardHeight / 2, viewTop + EDGE_PAD),
        viewBottom - cardHeight - EDGE_PAD,
      );
    } else if (fitsLeft) {
      cardLeft = anchorLeft - ANCHOR_GAP - cardWidth;
      side = "left";
      panelSide = "left";
      top = Math.min(
        Math.max(anchorMidY - cardHeight / 2, viewTop + EDGE_PAD),
        viewBottom - cardHeight - EDGE_PAD,
      );
    } else {
      cardLeft = (anchorLeft + anchorRight) / 2 - cardWidth / 2;
      const spaceAbove = anchorTop - 16;
      const spaceBelow = viewBottom - anchorBottom - 16;
      const below = spaceBelow >= spaceAbove;
      top = below
        ? Math.min(anchorBottom + ANCHOR_GAP, viewBottom - cardHeight - EDGE_PAD)
        : Math.max(viewTop + EDGE_PAD, anchorTop - cardHeight - ANCHOR_GAP);
      side = below ? "below" : "above";
      panelSide = panelFitsRightOf(cardLeft) ? "right" : "left";
    }
  }

  cardLeft = Math.max(
    viewLeft + EDGE_PAD + (panelSide === "left" ? panelSpace : 0),
    Math.min(cardLeft, viewRight - cardWidth - EDGE_PAD - (panelSide === "right" ? panelSpace : 0)),
  );
  top = Math.max(viewTop + EDGE_PAD, Math.min(top, viewBottom - previewHeight - EDGE_PAD));

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
    side,
  };
}
