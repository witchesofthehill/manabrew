import { useCallback, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, GripVertical, Image as ImageIcon } from "lucide-react";

import { HoverCardPreview } from "@/components/game/HoverCardPreview";
import { FLASH_CARD_SIZE } from "@/components/game/game.styles";
import type { useCardPreview } from "@/hooks/useCardPreview";
import type { PreviewCard } from "@/lib/cardPreview";
import { cn } from "@/lib/utils";

const RAIL_CHROME_PX = 25;
const DEFAULT_MIN_WIDTH = FLASH_CARD_SIZE.w + RAIL_CHROME_PX;
const DEFAULT_MAX_WIDTH = 600;
const DEFAULT_WIDTH = Math.max(DEFAULT_MIN_WIDTH + 80, 360);

export interface CardPreviewRailProps {
  preview: ReturnType<typeof useCardPreview>;
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  onSlotChange?: (slot: HTMLDivElement | null) => void;
  renderDetails?: (card: PreviewCard) => ReactNode;
  title?: string;
  emptyMessage?: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  className?: string;
}

export function CardPreviewRail({
  preview,
  collapsed,
  defaultCollapsed = false,
  onCollapsedChange,
  onSlotChange,
  renderDetails,
  title = "Preview",
  emptyMessage = "Hover a card to preview",
  defaultWidth = DEFAULT_WIDTH,
  minWidth = DEFAULT_MIN_WIDTH,
  maxWidth = DEFAULT_MAX_WIDTH,
  className,
}: CardPreviewRailProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);
  const [width, setWidth] = useState(() => clampWidth(defaultWidth, minWidth, maxWidth));
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const isCollapsed = collapsed ?? internalCollapsed;

  const setSlotRef = useCallback(
    (element: HTMLDivElement | null) => {
      setSlot(element);
      onSlotChange?.(element);
    },
    [onSlotChange],
  );

  function setCollapsed(next: boolean) {
    if (collapsed === undefined) setInternalCollapsed(next);
    onCollapsedChange?.(next);
  }

  function finishResize(element: HTMLElement, pointerId: number) {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    dragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  if (isCollapsed) {
    return (
      <button
        type="button"
        className={cn(
          "flex h-full w-8 shrink-0 flex-col items-center border-l bg-muted/30 pt-2 text-muted-foreground transition-colors hover:bg-muted/50",
          className,
        )}
        onClick={() => setCollapsed(false)}
        title={`Show ${title.toLowerCase()}`}
        aria-label={`Show ${title.toLowerCase()}`}
      >
        <ChevronLeft className="h-4 w-4" />
        <span className="mt-2 rotate-180 text-[10px] tracking-wider [writing-mode:vertical-rl]">
          {title.toUpperCase()}
        </span>
      </button>
    );
  }

  const cardWidth = Math.min(FLASH_CARD_SIZE.w, width - 24);
  const cardHeight = Math.min(FLASH_CARD_SIZE.h, (width - 24) * 1.4);

  return (
    <aside
      className={cn("relative flex h-full shrink-0 border-l bg-muted/20", className)}
      style={{ width }}
      aria-label={title}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${title.toLowerCase()}`}
        className="group/handle absolute left-0 top-0 z-20 h-full w-1.5 cursor-col-resize transition-colors hover:bg-primary/30 active:bg-primary/40"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startWidth: width,
          };
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          setWidth(clampWidth(drag.startWidth + drag.startX - event.clientX, minWidth, maxWidth));
        }}
        onPointerUp={(event) => finishResize(event.currentTarget, event.pointerId)}
        onPointerCancel={(event) => finishResize(event.currentTarget, event.pointerId)}
      >
        <div className="absolute left-full top-1/2 -translate-x-1/2 -translate-y-1/2 rounded border bg-card p-0.5 text-muted-foreground opacity-0 shadow group-hover/handle:opacity-100">
          <GripVertical className="h-3 w-3" />
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden p-3">
        <div className="mb-2 flex shrink-0 items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </span>
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground hover:bg-muted"
            onClick={() => setCollapsed(true)}
            title={`Hide ${title.toLowerCase()}`}
            aria-label={`Hide ${title.toLowerCase()}`}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div
          ref={setSlotRef}
          className="relative flex shrink-0 items-start justify-center overflow-hidden [&:has([data-card-preview])_[data-preview-skeleton]]:opacity-0"
          style={{ height: cardHeight + 8 }}
        >
          <div
            data-preview-skeleton
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-start gap-2 pt-2 opacity-100 transition-opacity"
          >
            <div
              className="flex items-center justify-center rounded-xl border-2 border-dashed border-border/60 bg-background/30"
              style={{ width: cardWidth, height: cardHeight }}
            >
              <ImageIcon className="h-10 w-10 text-muted-foreground/40" />
            </div>
            <span className="text-xs text-muted-foreground/70">{emptyMessage}</span>
          </div>
        </div>
        {preview.hoveredCard && renderDetails?.(preview.hoveredCard)}
      </div>

      <HoverCardPreview preview={preview} slot={slot} pinned imageSize="normal" />
    </aside>
  );
}

function clampWidth(width: number, minWidth: number, maxWidth: number): number {
  return Math.min(maxWidth, Math.max(minWidth, width));
}
