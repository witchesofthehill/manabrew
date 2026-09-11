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
    <div
      className={cn("grid gap-2", className, disabled && "pointer-events-none opacity-50")}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {BOARD_BACKGROUNDS.map((option) => {
        const selected = option.id === background;
        return (
          <button
            key={option.id}
            type="button"
            title={option.label}
            onClick={() => onBackgroundChange(option.id)}
            className={cn(
              "aspect-[16/9] w-full overflow-hidden rounded-md border text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              selected
                ? "border-primary ring-1 ring-primary"
                : "border-border/70 hover:border-primary/50",
            )}
          >
            {option.url ? (
              <img src={option.url} alt={option.label} className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-canvas-background text-muted-foreground">
                None
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
