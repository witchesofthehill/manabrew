import { ChevronDown, ChevronUp, Image as ImageIcon } from "lucide-react";

interface DraftPreviewPanelProps {
  setSlot: (element: HTMLDivElement | null) => void;
  collapsed: boolean;
  onCollapse: () => void;
}

export function DraftPreviewPanel({ setSlot, collapsed, onCollapse }: DraftPreviewPanelProps) {
  if (collapsed) {
    return (
      <button
        type="button"
        className="flex h-9 shrink-0 items-center justify-between rounded-md border border-border/70 bg-card/20 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted/40"
        onClick={onCollapse}
        title="Show card preview"
      >
        Preview
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <section className="flex h-[372px] shrink-0 flex-col overflow-hidden rounded-md border border-border/70 bg-card/20">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/40 px-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Preview
        </h2>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted"
          onClick={onCollapse}
          title="Hide card preview"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>
      <div
        ref={setSlot}
        className="relative flex min-h-0 flex-1 items-start justify-center overflow-hidden p-2 [&:has([data-card-preview])_[data-preview-skeleton]]:opacity-0"
      >
        <div
          data-preview-skeleton
          className="pointer-events-none absolute inset-2 flex flex-col items-center justify-center gap-3 text-muted-foreground/70 transition-opacity"
        >
          <div className="flex aspect-[5/7] h-full max-h-[312px] items-center justify-center rounded-xl border-2 border-dashed border-border/60 bg-background/30">
            <ImageIcon className="h-10 w-10 text-muted-foreground/40" />
          </div>
          <span className="text-xs">Hover a card to preview</span>
        </div>
      </div>
    </section>
  );
}
