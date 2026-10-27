import { cn } from "@/lib/utils";
import { matchesDevPanelSearch, useDevPanelSearch } from "./devPanelSearchContext";

interface DevCounterControlProps {
  label: string;
  value: number | null;
  onClear: () => void;
  onBump: (delta: number) => void;
}

export function DevCounterControl({ label, value, onClear, onBump }: DevCounterControlProps) {
  const query = useDevPanelSearch();
  if (!matchesDevPanelSearch(query, label)) return null;
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1 rounded-lg border border-border/60 bg-background/40 p-1">
      <span className="min-w-20 flex-1 break-words pl-2 text-ui-label font-medium" title={label}>
        {label}
      </span>
      <button
        type="button"
        className="h-8 w-8 touch:min-h-11 touch:min-w-11 rounded-md border border-border/70 text-ui-label hover:bg-accent/50"
        onClick={() => onBump(-1)}
      >
        −
      </button>
      <button
        type="button"
        className={cn(
          "h-8 min-w-8 touch:min-h-11 touch:min-w-11 rounded-md px-1 font-mono text-ui-label tabular-nums hover:bg-accent/50",
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
        className="h-8 w-8 touch:min-h-11 touch:min-w-11 rounded-md border border-border/70 text-ui-label hover:bg-accent/50"
        onClick={() => onBump(1)}
      >
        +
      </button>
    </div>
  );
}
