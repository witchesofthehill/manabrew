import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SetTile } from "@/components/limited/SetTile";
import { SET_TYPE_LABELS } from "@/components/limited/setFilters";
import { cn } from "@/lib/utils";
import type { ScryfallSet } from "@/types/scryfall";

interface SetPickerProps {
  sets: ScryfallSet[];
  selectedCode: string;
  prefetching: string | null;
  onSelect: (code: string) => void;
  variant?: "inline" | "column";
}

export function SetPicker({
  sets,
  selectedCode,
  prefetching,
  onSelect,
  variant = "inline",
}: SetPickerProps) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [changing, setChanging] = useState(false);

  const filtered = useMemo(() => filterSets(sets, query, typeFilter), [sets, query, typeFilter]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: sets.length };
    for (const s of sets) {
      out[s.set_type] = (out[s.set_type] ?? 0) + 1;
    }
    return out;
  }, [sets]);

  const recents = useMemo(() => sets.slice(0, 12), [sets]);

  const selected = selectedCode ? sets.find((s) => s.code === selectedCode) : undefined;

  const handleSelect = (code: string) => {
    onSelect(code === selectedCode ? "" : code);
    setChanging(false);
  };

  if (variant === "inline" && selected && !changing) {
    return (
      <section className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/40 p-2">
        <div className="min-w-0 flex-1">
          <SetTile
            set={selected}
            active
            prefetching={prefetching === selected.code}
            onClick={() => setChanging(true)}
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 text-xs"
          onClick={() => setChanging(true)}
        >
          Change set
        </Button>
      </section>
    );
  }

  return (
    <section
      className={cn(
        "@container",
        variant === "column"
          ? "md:flex md:h-full md:min-h-0 md:flex-col"
          : "rounded-lg border border-border/70 bg-card/40 p-4",
      )}
    >
      <div
        className={cn(
          variant === "column" && "sticky top-0 z-10 bg-background px-4 pb-3 pt-4 md:shrink-0",
        )}
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pick a set
          </h2>
          <div
            className={cn("relative flex items-center", variant === "column" && "min-w-0 flex-1")}
          >
            <Search className="absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${sets.length} sets…`}
              className={cn("h-8 pl-7 text-xs", variant === "column" ? "w-full" : "w-64")}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
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
      </div>

      <div
        className={cn(
          variant === "inline" && "mt-3",
          variant === "column" && "px-4 pb-4 md:min-h-0 md:flex-1 md:overflow-y-auto",
        )}
      >
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
                  onClick={() => handleSelect(s.code)}
                  size="sm"
                />
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-1.5 @lg:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4">
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
                  onClick={() => handleSelect(s.code)}
                />
              ))
          )}
        </div>
      </div>
    </section>
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
