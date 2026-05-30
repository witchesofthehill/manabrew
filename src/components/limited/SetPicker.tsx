import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { SetSymbol } from "@/components/limited/SetSymbol";
import { SET_TYPE_LABELS } from "@/components/limited/setFilters";
import { cn } from "@/lib/utils";
import type { ScryfallSet } from "@/types/scryfall";

interface SetPickerProps {
  sets: ScryfallSet[];
  selectedCode: string;
  prefetching: string | null;
  onSelect: (code: string) => void;
}

export function SetPicker({ sets, selectedCode, prefetching, onSelect }: SetPickerProps) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const filtered = useMemo(() => filterSets(sets, query, typeFilter), [sets, query, typeFilter]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: sets.length };
    for (const s of sets) {
      out[s.set_type] = (out[s.set_type] ?? 0) + 1;
    }
    return out;
  }, [sets]);

  const recents = useMemo(() => sets.slice(0, 12), [sets]);

  return (
    <section className="rounded-lg border border-border/70 bg-card/40 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Pick a set
        </h2>
        <div className="relative flex items-center">
          <Search className="absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${sets.length} sets…`}
            className="h-8 w-64 pl-7 text-xs"
          />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {SET_TYPE_LABELS.map(({ key, label }) => {
          const count = counts[key] ?? 0;
          if (key !== "all" && count === 0) return null;
          const active = typeFilter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTypeFilter(key)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] transition",
                active
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground/90",
              )}
            >
              {label} <span className="text-muted-foreground/70">{count}</span>
            </button>
          );
        })}
      </div>

      {!query && typeFilter === "all" && (
        <div className="mb-3">
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Latest
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {recents.map((s) => (
              <SetTile
                key={`recent-${s.code}`}
                set={s}
                active={s.code === selectedCode}
                prefetching={prefetching === s.code}
                onClick={() => onSelect(s.code === selectedCode ? "" : s.code)}
                size="sm"
              />
            ))}
          </div>
        </div>
      )}

      <div className="grid max-h-[260px] grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.length === 0 ? (
          <div className="col-span-full py-6 text-center text-sm text-muted-foreground">
            No sets match {query ? `"${query}"` : "the current filter"}.
          </div>
        ) : (
          filtered
            .slice(0, 120)
            .map((s) => (
              <SetTile
                key={s.code}
                set={s}
                active={s.code === selectedCode}
                prefetching={prefetching === s.code}
                onClick={() => onSelect(s.code === selectedCode ? "" : s.code)}
              />
            ))
        )}
      </div>
    </section>
  );
}

interface SetTileProps {
  set: ScryfallSet;
  active: boolean;
  prefetching: boolean;
  onClick: () => void;
  size?: "sm" | "md";
}

function SetTile({ set, active, prefetching, onClick, size = "md" }: SetTileProps) {
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

function filterSets(sets: ScryfallSet[], q: string, typeKey: string): ScryfallSet[] {
  const needle = q.trim().toLowerCase();
  return sets.filter((s) => {
    if (typeKey !== "all" && s.set_type !== typeKey) return false;
    if (!needle) return true;
    return s.code.toLowerCase().includes(needle) || s.name.toLowerCase().includes(needle);
  });
}
