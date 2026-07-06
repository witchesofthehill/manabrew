import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { ScryfallImg } from "@/components/ScryfallImg";
import { useLongPressPreview } from "@/hooks/useLongPressPreview";
import type { DeckCard } from "@/protocol/deck";

const PREVIEW_W = 240;
const PREVIEW_H = 336;

interface CardImageThumbnailProps {
  card: DeckCard;
  /** CSS classes applied to the thumbnail <img>. */
  className?: string;
}

/**
 * Small card image that shows a large floating preview on hover.
 * Used inside modals where the user needs to read card text.
 */
export function CardImageThumbnail({ card, className }: CardImageThumbnailProps) {
  const [hovered, setHovered] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement>(null);

  const longPress = useLongPressPreview<DeckCard>({
    resolve: (e) => ({ item: card, anchor: e.currentTarget as HTMLElement }),
    show: (_item, rect) => {
      setMousePos({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      setHovered(true);
    },
    hide: () => setHovered(false),
  });

  function handlePointerEnter(e: React.PointerEvent) {
    if (e.pointerType === "touch") return;
    setMousePos({ x: e.clientX, y: e.clientY });
    setHovered(true);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (e.pointerType === "touch") {
      longPress.onPointerMove(e);
      return;
    }
    setMousePos({ x: e.clientX, y: e.clientY });
  }

  function handlePointerLeave(e: React.PointerEvent) {
    if (e.pointerType === "touch") return;
    setHovered(false);
  }

  // Position the preview near the cursor, clamped to viewport edges.
  const spaceRight = typeof window !== "undefined" ? window.innerWidth - mousePos.x : 999;
  const left = spaceRight > PREVIEW_W + 24 ? mousePos.x + 16 : mousePos.x - PREVIEW_W - 16;
  const top =
    typeof window !== "undefined"
      ? Math.min(Math.max(mousePos.y - PREVIEW_H / 2, 8), window.innerHeight - PREVIEW_H - 8)
      : 8;

  return (
    <>
      <ScryfallImg
        ref={imgRef}
        src={card.uris.normal}
        alt={card.identity.name}
        className={cn("cursor-zoom-in select-none [-webkit-touch-callout:none]", className)}
        onPointerEnter={handlePointerEnter}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerDown={longPress.onPointerDown}
        onPointerUp={longPress.onPointerUp}
        onPointerCancel={longPress.onPointerCancel}
        onClickCapture={longPress.onClickCapture}
        onContextMenu={longPress.onContextMenu}
      />
      {hovered &&
        createPortal(
          <div
            className="fixed z-[10001] pointer-events-none select-none"
            style={{ left, top, width: PREVIEW_W, height: PREVIEW_H }}
          >
            <ScryfallImg
              src={card.uris.large}
              alt={card.identity.name}
              className="w-full h-full object-contain rounded-xl shadow-2xl ring-1 ring-black/20"
            />
          </div>,
          document.body,
        )}
    </>
  );
}
