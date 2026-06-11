import { useMemo, useState } from "react";
import { ChevronRight, Sparkles, Trophy, Plus, Layers, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useDeckStore } from "@/stores/useDeckStore";
import { useDeckAnalysisStore } from "@/stores/useDeckAnalysisStore";
import { normalizeCardName } from "@/lib/gameChangers";
import { getCardByName } from "@/api/scryfall";
import { scryfallToDeckCard, frontFaceName } from "@/lib/scryfall.utils";
import { ComboDetailModal } from "./ComboDetailModal";
import type { SpellbookCombo } from "@/api/commanderSpellbook";

const SUGGESTION_LIMIT = 12;

const WIN_PATTERN =
  /win the game|wins the game|lose the game|loses the game|each opponent loses|infinite damage/i;

function isWinCombo(combo: SpellbookCombo): boolean {
  return combo.produces.some((p) => WIN_PATTERN.test(p.feature.name));
}

function producesLabel(combo: SpellbookCombo): string {
  return combo.produces.map((p) => p.feature.name).join(", ") || "combo";
}

function ComboRow({
  combo,
  onOpen,
  icon,
  title,
  subtitle,
  onAdd,
  addLabel,
}: {
  combo: SpellbookCombo;
  onOpen: (combo: SpellbookCombo) => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onAdd?: () => void;
  addLabel?: string;
}) {
  return (
    <div className="group flex w-full min-w-0 items-center gap-2 rounded-md border border-border/40 bg-muted/20 px-2 py-1.5 transition-colors hover:border-counter-charge/40 hover:bg-counter-charge/10">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
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
      </button>
      <span
        className="flex shrink-0 items-center gap-0.5 rounded bg-counter-charge/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-counter-charge"
        title={`${combo.uses.length}-card combo`}
      >
        <Layers className="h-3 w-3" />
        {combo.uses.length}
      </span>
      {onAdd ? (
        <button
          type="button"
          title={addLabel}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-counter-charge transition-colors hover:bg-counter-charge/25"
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      ) : (
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-counter-charge" />
      )}
    </div>
  );
}

export function CombosPanel() {
  const [openCombo, setOpenCombo] = useState<SpellbookCombo | null>(null);
  const currentDeck = useDeckStore((s) => s.currentDeck);
  const addToMain = useDeckStore((s) => s.addToMain);
  const included = useDeckAnalysisStore((s) => s.included);
  const almostIncluded = useDeckAnalysisStore((s) => s.almostIncluded);
  const loading = useDeckAnalysisStore((s) => s.loading);

  const winCombos = useMemo(() => included.filter(isWinCombo), [included]);
  const otherCombos = useMemo(() => included.filter((c) => !isWinCombo(c)), [included]);

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

  async function handleAdd(name: string) {
    try {
      const sc = await getCardByName(frontFaceName(name));
      addToMain({ ...scryfallToDeckCard(sc), id: crypto.randomUUID() });
      toast.success(`Added ${name}`);
    } catch {
      toast.error(`Couldn't add ${name}`);
    }
  }

  if (!loading && included.length === 0 && suggestions.length === 0) return null;

  return (
    <>
      <section className="rounded-xl border bg-card/40 p-6">
        <div className="flex items-center gap-2.5">
          <Sparkles className="h-4 w-4 text-counter-charge shrink-0" />
          <h3 className="text-base font-semibold">Combos</h3>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground/70">
            {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            {included.length > 0 && <span>{included.length} in deck</span>}
          </div>
        </div>

        <div className="mt-5 space-y-5">
          {winCombos.length > 0 && (
            <div className="space-y-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-warning/80">
                Win lines
              </span>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {winCombos.map((combo) => (
                  <ComboRow
                    key={combo.id}
                    combo={combo}
                    onOpen={setOpenCombo}
                    icon={<Trophy className="h-3.5 w-3.5" />}
                    title={producesLabel(combo)}
                    subtitle={combo.uses.map((u) => u.card.name).join(" + ")}
                  />
                ))}
              </div>
            </div>
          )}

          {winCombos.length > 0 && (otherCombos.length > 0 || suggestions.length > 0) && (
            <div className="border-t border-border/40" />
          )}

          {(otherCombos.length > 0 || suggestions.length > 0) && (
            <div
              className={cn(
                "grid grid-cols-1 items-start gap-6",
                otherCombos.length > 0 && suggestions.length > 0 && "md:grid-cols-2",
              )}
            >
              {otherCombos.length > 0 && (
                <div className="min-w-0 space-y-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-counter-charge/80">
                    In your deck
                  </span>
                  <div className="space-y-2">
                    {otherCombos.map((combo) => (
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
                </div>
              )}

              {suggestions.length > 0 && (
                <div className="min-w-0 space-y-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    One card away
                  </span>
                  <div className="space-y-2">
                    {suggestions.map(({ combo, missing }) => (
                      <ComboRow
                        key={combo.id}
                        combo={combo}
                        onOpen={setOpenCombo}
                        icon={<Sparkles className="h-3.5 w-3.5" />}
                        title={producesLabel(combo)}
                        subtitle={`Needs ${missing[0]}`}
                        onAdd={() => handleAdd(missing[0])}
                        addLabel={`Add ${missing[0]} to deck`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!loading && included.length === 0 && suggestions.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No combos detected yet.</p>
          )}

          <p className="text-[10px] text-muted-foreground/50">
            Combo data from Commander Spellbook.
          </p>
        </div>
      </section>
      {openCombo && <ComboDetailModal combo={openCombo} onClose={() => setOpenCombo(null)} />}
    </>
  );
}
