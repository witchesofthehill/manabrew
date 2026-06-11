import { SetSymbol } from "@/components/limited/SetSymbol";
import { cn } from "@/lib/utils";
import type { ScryfallSet } from "@/types/scryfall";

interface SetTileProps {
  set: ScryfallSet;
  active: boolean;
  prefetching: boolean;
  onClick: () => void;
  size?: "sm" | "md";
}

export function SetTile({ set, active, prefetching, onClick, size = "md" }: SetTileProps) {
  const releasedYear = set.released_at?.slice(0, 4) ?? "—";
  const compact = size === "sm";
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${set.name} (${set.code.toUpperCase()}) · ${set.set_type} · ${set.released_at ?? "—"} · ${set.card_count} cards`}
      className={cn(
        "group relative flex items-center gap-2 rounded-lg border px-3 text-left transition",
        compact ? "py-1.5" : "py-2",
        active
          ? "border-primary bg-primary/10 shadow-[0_0_0_1px_var(--color-primary)]/30"
          : "border-border/40 bg-card/30 hover:border-primary/50 hover:bg-card/60",
      )}
    >
      <SetSymbol
        setCode={set.code}
        className={cn(
          compact ? "h-5 w-5" : "h-7 w-7",
          active ? "text-primary" : "text-foreground/80 group-hover:text-foreground",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className={cn("truncate font-medium leading-tight", compact ? "text-xs" : "text-sm")}>
          {set.name}
        </div>
        <div className={cn("text-[10px] text-muted-foreground", compact && "text-[9px]")}>
          {set.code.toUpperCase()} · {releasedYear} · {set.card_count}
        </div>
      </div>
      {prefetching && (
        <span className="absolute right-1.5 top-1.5 inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
      )}
      {active && !prefetching && (
        <span className="absolute right-1.5 top-1.5 inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
      )}
    </button>
  );
}
