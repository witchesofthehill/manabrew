import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Sparkles, Plus, Loader2 } from "lucide-react";
import { useDeckStore } from "@/stores/useDeckStore";
import { useDeckAnalysisStore } from "@/stores/useDeckAnalysisStore";
import { normalizeCardName } from "@/lib/gameChangers";
import { ComboDetailModal } from "./ComboDetailModal";
import { cn } from "@/lib/utils";
import type { SpellbookCombo } from "@/api/commanderSpellbook";

const SUGGESTION_LIMIT = 12;

function producesLabel(combo: SpellbookCombo): string {
  return combo.produces.map((p) => p.feature.name).join(", ") || "combo";
}

function ComboRow({
  combo,
  onOpen,
  icon,
  title,
  subtitle,
}: {
  combo: SpellbookCombo;
  onOpen: (combo: SpellbookCombo) => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        "group flex w-full items-center gap-2 rounded-md border border-border/40 bg-muted/20 px-2 py-1.5 text-left",
        "transition-colors hover:border-counter-charge/40 hover:bg-counter-charge/10",
      )}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(combo);
      }}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-counter-charge/15 text-counter-charge transition-colors group-hover:bg-counter-charge/25">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">{title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{subtitle}</span>
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-counter-charge" />
    </button>
  );
}

export function CombosPanel() {
  const [collapsed, setCollapsed] = useState(true);
  const [openCombo, setOpenCombo] = useState<SpellbookCombo | null>(null);
  const currentDeck = useDeckStore((s) => s.currentDeck);
  const included = useDeckAnalysisStore((s) => s.included);
  const almostIncluded = useDeckAnalysisStore((s) => s.almostIncluded);
  const loading = useDeckAnalysisStore((s) => s.loading);

  const deckNames = useMemo(() => {
    const set = new Set<string>();
    for (const c of currentDeck.cards) set.add(normalizeCardName(c.name));
    for (const c of currentDeck.commanders ?? []) set.add(normalizeCardName(c.name));
    return set;
  }, [currentDeck.cards, currentDeck.commanders]);

  const suggestions = useMemo(() => {
    return almostIncluded
      .map((combo) => ({
        combo,
        missing: combo.uses
          .filter((u) => !deckNames.has(normalizeCardName(u.card.name)))
          .map((u) => u.card.name),
      }))
      .filter((s) => s.missing.length === 1)
      .sort((a, b) => (b.combo.popularity ?? 0) - (a.combo.popularity ?? 0))
      .slice(0, SUGGESTION_LIMIT);
  }, [almostIncluded, deckNames]);

  if (!loading && included.length === 0 && suggestions.length === 0) return null;

  return (
    <>
      <div className="border-t shrink-0">
        <div
          role="button"
          tabIndex={0}
          className="flex items-center gap-1.5 w-full px-3 py-2 hover:bg-muted/30 transition-colors text-left cursor-pointer"
          onClick={() => setCollapsed((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setCollapsed((v) => !v);
            }
          }}
        >
          {collapsed ? (
            <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
          )}
          <Sparkles className="h-3.5 w-3.5 text-counter-charge shrink-0" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Combos
          </span>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground/70">
            {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            {included.length > 0 && <span>{included.length} in deck</span>}
          </div>
        </div>

        {!collapsed && (
          <div className="px-3 pb-3 space-y-3">
            {included.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-counter-charge/80">
                  In your deck
                </span>
                {included.map((combo) => (
                  <ComboRow
                    key={combo.id}
                    combo={combo}
                    onOpen={setOpenCombo}
                    icon={<Sparkles className="h-3.5 w-3.5" />}
                    title={producesLabel(combo)}
                    subtitle={combo.uses.map((u) => u.card.name).join(" + ")}
                  />
                ))}
              </div>
            )}

            {suggestions.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  One card away
                </span>
                {suggestions.map(({ combo, missing }) => (
                  <ComboRow
                    key={combo.id}
                    combo={combo}
                    onOpen={setOpenCombo}
                    icon={<Plus className="h-3.5 w-3.5" />}
                    title={`Add ${missing[0]}`}
                    subtitle={producesLabel(combo)}
                  />
                ))}
              </div>
            )}

            {!loading && included.length === 0 && suggestions.length === 0 && (
              <p className="text-xs text-muted-foreground italic">No combos detected yet.</p>
            )}

            <p className="text-[10px] text-muted-foreground/50">
              Combo data from Commander Spellbook.
            </p>
          </div>
        )}
      </div>
      {openCombo && <ComboDetailModal combo={openCombo} onClose={() => setOpenCombo(null)} />}
    </>
  );
}
