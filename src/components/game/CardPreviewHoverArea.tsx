import { useId, useLayoutEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { CARD_PREVIEW_EVENT_HANDLERS } from "@/lib/cardPreviewEvents";
import {
  containsPreviewHoverBridge,
  getPreviewHoverBridgePath,
} from "@/pixi/cardPreview/previewHoverArea";

interface CardPreviewHoverAreaProps {
  source: DOMRect | null;
  cardLeft: number;
  cardTop: number;
  cardWidth: number;
  cardHeight: number;
  panelWidth: number;
  panelHeight: number;
  panelSide: "left" | "right";
  sticky: boolean;
  contentInteractive: boolean;
  debugColor?: string;
  portalTarget?: HTMLElement | null;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export function CardPreviewHoverArea({
  source,
  cardLeft,
  cardTop,
  cardWidth,
  cardHeight,
  panelWidth,
  panelHeight,
  panelSide,
  sticky,
  contentInteractive,
  debugColor,
  portalTarget,
  onMouseEnter,
  onMouseLeave,
}: CardPreviewHoverAreaProps) {
  const clipId = useId();
  const contentClipId = useId();
  const pointerOnPreview = useRef(false);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const callbacks = useRef({ onMouseEnter, onMouseLeave });
  const card = useMemo(
    () => new DOMRect(cardLeft, cardTop, cardWidth, cardHeight),
    [cardLeft, cardTop, cardWidth, cardHeight],
  );
  const panel = useMemo(
    () =>
      new DOMRect(
        panelSide === "right" ? card.right + 10 : card.left - 10 - panelWidth,
        card.top,
        panelWidth,
        panelHeight,
      ),
    [card, panelWidth, panelHeight, panelSide],
  );
  const sourceBridge = source && !sticky ? getPreviewHoverBridgePath(source, card) : "";
  const panelBridge = panelWidth > 0 ? getPreviewHoverBridgePath(card, panel) : "";

  useLayoutEffect(() => {
    callbacks.current = { onMouseEnter, onMouseLeave };
  });
  useLayoutEffect(() => {
    const contains = (rect: DOMRect, x: number, y: number) =>
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    const update = (x: number, y: number) => {
      const onSource = source !== null && contains(source, x, y);
      const inside =
        (!onSource &&
          (contains(card, x, y) ||
            (panelWidth > 0 &&
              (contains(panel, x, y) || containsPreviewHoverBridge(x, y, card, panel))) ||
            (source !== null && !sticky && containsPreviewHoverBridge(x, y, source, card)))) ||
        (pointerOnPreview.current && onSource);
      if (inside) {
        pointerOnPreview.current = true;
        callbacks.current.onMouseEnter?.();
      } else if (pointerOnPreview.current) {
        pointerOnPreview.current = false;
        callbacks.current.onMouseLeave?.();
      }
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      lastPointer.current = { x: event.clientX, y: event.clientY };
      update(event.clientX, event.clientY);
    };
    const leave = (event: PointerEvent) => {
      if (event.relatedTarget !== null) return;
      lastPointer.current = null;
      if (!pointerOnPreview.current) return;
      pointerOnPreview.current = false;
      callbacks.current.onMouseLeave?.();
    };
    if (lastPointer.current) update(lastPointer.current.x, lastPointer.current.y);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerout", leave);
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerout", leave);
    };
  }, [source, card, panel, panelWidth, sticky]);
  useLayoutEffect(
    () => () => {
      if (pointerOnPreview.current) callbacks.current.onMouseLeave?.();
    },
    [],
  );

  return createPortal(
    <svg
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[10000] h-full w-full overflow-visible pointer-coarse:hidden"
      clipPath={contentInteractive ? `url(#${contentClipId})` : undefined}
      {...CARD_PREVIEW_EVENT_HANDLERS}
      data-card-preview
    >
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <path
            clipRule="evenodd"
            d={`M0 0H${window.innerWidth}V${window.innerHeight}H0Z${
              source
                ? `M${source.left} ${source.top}H${source.right}V${source.bottom}H${source.left}Z`
                : ""
            }`}
          />
        </clipPath>
        <clipPath id={contentClipId} clipPathUnits="userSpaceOnUse">
          <path
            clipRule="evenodd"
            d={
              `M0 0H${window.innerWidth}V${window.innerHeight}H0Z` +
              `M${card.left} ${card.top}H${card.right}V${card.bottom}H${card.left}Z` +
              (panelWidth > 0
                ? `M${panel.left} ${panel.top}H${panel.right}V${panel.bottom}H${panel.left}Z`
                : "")
            }
          />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`} fill={debugColor ?? "transparent"}>
        <rect
          x={card.left}
          y={card.top}
          width={card.width}
          height={card.height}
          pointerEvents="fill"
        />
        {sourceBridge && <path d={sourceBridge} pointerEvents="fill" />}
        {panelWidth > 0 && (
          <>
            <rect
              x={panel.left}
              y={panel.top}
              width={panel.width}
              height={panel.height}
              pointerEvents="fill"
            />
            <path d={panelBridge} pointerEvents="fill" />
          </>
        )}
      </g>
    </svg>,
    portalTarget ?? document.body,
  );
}
