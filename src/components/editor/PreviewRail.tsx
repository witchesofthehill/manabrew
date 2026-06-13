import { ChevronLeft, ChevronRight, Image as ImageIcon, GripVertical } from "lucide-react";
import { FLASH_CARD_SIZE } from "@/components/game/game.styles";
import { PreviewCardInfo, type PreviewCard } from "./PreviewCardInfo";

const RAIL_CHROME_PX = 25;
const MIN_WIDTH = FLASH_CARD_SIZE.w + RAIL_CHROME_PX;
const WIDTH = Math.max(MIN_WIDTH + 80, 360);

interface PreviewRailProps {
  setSlot: (el: HTMLDivElement | null) => void;
  collapsed: boolean;
  onCollapse: () => void;
  previewCard?: PreviewCard | null;
}

export function PreviewRail({ setSlot, collapsed, onCollapse, previewCard }: PreviewRailProps) {
  if (collapsed) {
    return (
      <button
        type="button"
        className="shrink-0 w-8 h-full border-l bg-muted/30 flex flex-col items-center pt-2 hover:bg-muted/50 transition-colors text-muted-foreground"
        onClick={onCollapse}
        title="Show card preview"
        aria-label="Show card preview"
      >
        <ChevronLeft className="h-4 w-4" />
        <span className="mt-2 text-[10px] tracking-wider [writing-mode:vertical-rl] rotate-180">
          PREVIEW
        </span>
      </button>
    );
  }

  return (
    <div
      className="shrink-0 h-full border-l bg-muted/20 flex relative"
      style={{ width: WIDTH }}
      aria-label="Card preview"
    >
      <button
        type="button"
        className="absolute left-0 top-0 h-full w-1.5 cursor-pointer z-20 hover:bg-primary/30 active:bg-primary/40 transition-colors group/handle"
        onClick={onCollapse}
        title="Hide preview"
        aria-label="Hide preview"
      >
        <div className="absolute top-1/2 -translate-y-1/2 left-full -translate-x-1/2 opacity-0 group-hover/handle:opacity-100 rounded border bg-card text-muted-foreground p-0.5 shadow">
          <GripVertical className="h-3 w-3" />
        </div>
      </button>

      <div className="flex-1 flex flex-col p-3 overflow-hidden">
        <div className="flex items-center justify-between mb-2 shrink-0">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
            Preview
          </span>
          <button
            type="button"
            className="rounded p-0.5 hover:bg-muted text-muted-foreground"
            onClick={onCollapse}
            title="Hide preview"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div
          ref={setSlot}
          className="relative shrink-0 flex items-start justify-center overflow-hidden [&:has([data-card-preview])_[data-preview-skeleton]]:opacity-0"
          style={{ height: Math.min(FLASH_CARD_SIZE.h, (WIDTH - 24) * 1.4) + 8 }}
        >
          <div
            data-preview-skeleton
            className="absolute inset-0 flex flex-col items-center justify-start pt-2 gap-2 opacity-100 transition-opacity pointer-events-none"
          >
            <div
              className="rounded-xl border-2 border-dashed border-border/60 flex items-center justify-center bg-background/30"
              style={{
                width: Math.min(FLASH_CARD_SIZE.w, WIDTH - 24),
                height: Math.min(FLASH_CARD_SIZE.h, (WIDTH - 24) * 1.4),
              }}
            >
              <ImageIcon className="h-10 w-10 text-muted-foreground/40" />
            </div>
            <span className="text-xs text-muted-foreground/70">Hover a card to preview</span>
          </div>
        </div>
        {previewCard && <PreviewCardInfo card={previewCard} />}
      </div>
    </div>
  );
}
