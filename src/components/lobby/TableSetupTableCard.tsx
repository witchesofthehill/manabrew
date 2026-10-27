import { BOARD_BACKGROUNDS, type BoardBackgroundId } from "@/pixi/board/boardBackgrounds";
import { cn } from "@/lib/utils";

interface TableSetupTableCardProps {
  background: BoardBackgroundId;
  onBackgroundChange: (id: BoardBackgroundId) => void;
  columns?: number;
  className?: string;
  disabled?: boolean;
}

export function TableSetupTableCard({
  background,
  onBackgroundChange,
  columns,
  className = "border-b border-border/60 px-5 py-3",
  disabled = false,
}: TableSetupTableCardProps) {
  const cols = columns ?? Math.ceil(BOARD_BACKGROUNDS.length / 2);
  return (
    <div className={cn(className, disabled && "pointer-events-none opacity-50")}>
      <div
        className="grid gap-2 rounded-lg border border-border bg-canvas-background p-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {BOARD_BACKGROUNDS.map((option) => {
          const selected = option.id === background;
          return (
            <button
              key={option.id}
              type="button"
              title={option.label}
              aria-pressed={selected}
              onClick={() => onBackgroundChange(option.id)}
              className={cn(
                "aspect-[16/9] w-full overflow-hidden rounded-md border text-ui-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-card-ring touch:min-h-11 touch:min-w-11 whitespace-normal",
                selected
                  ? "border-card-selection ring-1 ring-card-selection"
                  : "border-text-muted/40 hover:border-card-ring",
              )}
            >
              {option.url ? (
                <img src={option.url} alt={option.label} className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-canvas-background text-text-muted">
                  None
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
