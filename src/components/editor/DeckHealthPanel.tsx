import { AlertTriangle, CheckCircle2, Search, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getFormat } from "@/lib/formats";
import { isLand } from "@/lib/mana";
import { cn } from "@/lib/utils";
import type { EditorDeck } from "@/types/manabrew";
import { CARD_ROLE_LABELS, useCardRolesStore } from "@/stores/useCardRolesStore";

interface DeckHealthPanelProps {
  deck: EditorDeck;
  unsupportedNames: Set<string>;
  validationErrors: string[];
  onShowUnsupported: () => void;
  onOpenSearch?: () => void;
}

const ROLE_TARGETS = [
  { role: "ramp", commander: 10, constructed: 4 },
  { role: "card-draw", commander: 10, constructed: 6 },
  { role: "interaction", commander: 10, constructed: 8 },
];

export function DeckHealthPanel({
  deck,
  unsupportedNames,
  validationErrors,
  onShowUnsupported,
  onOpenSearch,
}: DeckHealthPanelProps) {
  const roles = useCardRolesStore((state) => state.roles);
  const pending = useCardRolesStore((state) => state.pending);
  const format = getFormat(deck.format ?? "standard");
  const commanderDeck = format?.deckRules.requiresCommander ?? false;
  const landCount = deck.cards.filter((card) => isLand(card.types)).length;
  const landTarget = commanderDeck ? 36 : Math.max(24, Math.round(deck.cards.length * 0.4));
  const analyzedCount = new Set(deck.cards.map((card) => card.identity.name.toLowerCase())).size;
  const roleCounts = new Map<string, number>();

  for (const card of deck.cards) {
    for (const role of roles[card.identity.name.toLowerCase()] ?? []) {
      roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
    }
  }

  const checks = [
    {
      label: "Lands",
      value: landCount,
      target: landTarget,
      healthy: landCount >= landTarget - 2,
    },
    ...ROLE_TARGETS.map(({ role, commander, constructed }) => {
      const target = commanderDeck ? commander : constructed;
      const value = roleCounts.get(role) ?? 0;
      return { label: CARD_ROLE_LABELS[role], value, target, healthy: value >= target };
    }),
  ];
  const issueCount = checks.filter((check) => !check.healthy).length + validationErrors.length;

  return (
    <section className="rounded-xl border bg-card/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Deck health</h3>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                issueCount === 0
                  ? "bg-legality-legal/15 text-legality-legal"
                  : "bg-warning/15 text-warning",
              )}
            >
              {issueCount === 0 ? "Balanced" : `${issueCount} to review`}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Engine-derived roles compared with a practical {commanderDeck ? "Commander" : "60-card"}{" "}
            baseline.
          </p>
        </div>
        {pending.size > 0 && (
          <span className="text-[10px] text-muted-foreground" aria-live="polite">
            Analyzing {Math.min(pending.size, analyzedCount)} cards…
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {checks.map((check) => (
          <div
            key={check.label}
            className={cn(
              "rounded-lg border px-3 py-2",
              check.healthy
                ? "border-border/60 bg-background/30"
                : "border-warning/40 bg-warning/5",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">{check.label}</span>
              {check.healthy ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-legality-legal" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 text-warning" />
              )}
            </div>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
              {check.value}
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                / {check.target} target
              </span>
            </p>
          </div>
        ))}
      </div>

      {(validationErrors.length > 0 ||
        unsupportedNames.size > 0 ||
        checks.some((check) => !check.healthy)) && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
          {unsupportedNames.size > 0 && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onShowUnsupported}>
              <AlertTriangle className="mr-1.5 h-3.5 w-3.5 text-warning" />
              Show {unsupportedNames.size} unsupported
            </Button>
          )}
          {checks.some((check) => !check.healthy) && onOpenSearch && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onOpenSearch}>
              <Search className="mr-1.5 h-3.5 w-3.5" /> Add missing pieces
            </Button>
          )}
          {validationErrors[0] && (
            <span className="text-xs text-destructive">{validationErrors[0]}</span>
          )}
        </div>
      )}
    </section>
  );
}
