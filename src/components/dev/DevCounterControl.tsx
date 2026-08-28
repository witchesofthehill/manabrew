import { cn } from "@/lib/utils";

interface DevCounterControlProps {
  label: string;
  value: number | null;
  onClear: () => void;
  onBump: (delta: number) => void;
}

export function DevCounterControl({ label, value, onClear, onBump }: DevCounterControlProps) {
  return (
    <div className="flex min-h-10 items-center gap-1 rounded-lg border border-border/60 bg-background/40 p-1">
      <span className="min-w-0 flex-1 truncate pl-2 text-xs font-medium" title={label}>
        {label}
      </span>
      <button
        type="button"
        className="h-7 w-7 rounded-md border border-border/70 text-xs hover:bg-accent/50 pointer-coarse:h-10 pointer-coarse:w-10"
        onClick={() => onBump(-1)}
      >
        −
      </button>
      <button
        type="button"
        className={cn(
          "h-7 min-w-8 rounded-md px-1 font-mono text-xs tabular-nums hover:bg-accent/50 pointer-coarse:h-10",
          value != null ? "text-primary" : "text-muted-foreground",
        )}
        onClick={onClear}
        disabled={value == null}
        title={value == null ? undefined : `Clear ${label}`}
      >
        {value ?? "—"}
      </button>
      <button
        type="button"
        className="h-7 w-7 rounded-md border border-border/70 text-xs hover:bg-accent/50 pointer-coarse:h-10 pointer-coarse:w-10"
        onClick={() => onBump(1)}
      >
        +
      </button>
    </div>
  );
}
