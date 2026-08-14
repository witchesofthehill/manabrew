import { useState, type MouseEvent, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import type { DeckCard } from "@/protocol/deck";
import type { EditorDeck } from "@/types/manabrew";
import { DeckBudgetPanel } from "./DeckBudgetPanel";
import { DeckCollectionPanel } from "./DeckCollectionPanel";
import { DeckHealthPanel } from "./DeckHealthPanel";
import { DeckGoalsPanel } from "./DeckGoalsPanel";
import { DeckIntentPanel } from "./DeckIntentPanel";
import { DeckStats } from "./DeckStats";
import { ManaProbabilityPanel } from "./ManaProbabilityPanel";
import { ReplacementSuggestionsPanel } from "./ReplacementSuggestionsPanel";

type InsightSection = "overview" | "mana" | "collection" | "budget" | "replacements";

const SECTIONS: { id: InsightSection; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "mana", label: "Mana" },
  { id: "collection", label: "Collection" },
  { id: "budget", label: "Budget" },
  { id: "replacements", label: "Replacements" },
];

export function DeckInsightsPanel({
  mode = "all",
  deck,
  unsupportedNames,
  validationErrors,
  activeBucket,
  onBucketClick,
  onShowUnsupported,
  onOpenSearch,
  cardSize,
  onCardHover,
  onCardLeave,
}: {
  mode?: "all" | "analyze" | "improve";
  deck: EditorDeck;
  unsupportedNames: Set<string>;
  validationErrors: string[];
  activeBucket: number | null;
  onBucketClick: (bucket: number | null) => void;
  onShowUnsupported: () => void;
  onOpenSearch?: () => void;
  cardSize: number;
  onCardHover?: (card: DeckCard, event: MouseEvent) => void;
  onCardLeave?: () => void;
}) {
  const [openSections, setOpenSections] = useState<Record<InsightSection, boolean>>({
    overview: true,
    mana: true,
    collection: true,
    budget: true,
    replacements: true,
  });

  function toggleSection(section: InsightSection) {
    setOpenSections((current) => ({ ...current, [section]: !current[section] }));
  }

  return (
    <section aria-label="Deck insights" className="min-w-0 space-y-3">
      {SECTIONS.filter(({ id }) =>
        mode === "all"
          ? true
          : mode === "analyze"
            ? id === "mana" || id === "collection" || id === "budget"
            : id === "overview" || id === "replacements",
      ).map(({ id, label }) => (
        <InsightSectionPanel
          key={id}
          id={id}
          label={label}
          open={openSections[id]}
          onToggle={() => toggleSection(id)}
        >
          {id === "overview" && (
            <>
              <DeckHealthPanel
                deck={deck}
                unsupportedNames={unsupportedNames}
                validationErrors={validationErrors}
                onShowUnsupported={onShowUnsupported}
                onOpenSearch={onOpenSearch}
              />
              <DeckIntentPanel deck={deck} />
              <DeckGoalsPanel />
            </>
          )}
          {id === "mana" && (
            <>
              <DeckStats activeBucket={activeBucket} onBucketClick={onBucketClick} />
              <ManaProbabilityPanel deck={deck} />
            </>
          )}
          {id === "collection" && (
            <DeckCollectionPanel cardSize={cardSize} onHover={onCardHover} onLeave={onCardLeave} />
          )}
          {id === "budget" && <DeckBudgetPanel />}
          {id === "replacements" && (
            <ReplacementSuggestionsPanel
              cardSize={cardSize}
              onHover={onCardHover}
              onLeave={onCardLeave}
            />
          )}
        </InsightSectionPanel>
      ))}
    </section>
  );
}

function InsightSectionPanel({
  id,
  label,
  open,
  onToggle,
  children,
}: {
  id: InsightSection;
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-muted/10 p-3">
      <button
        type="button"
        className="flex min-h-9 w-full items-center gap-2 text-left text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
        aria-controls={`deck-insight-section-${id}`}
        onClick={onToggle}
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            !open && "-rotate-90",
          )}
        />
        {label}
      </button>
      {open && (
        <div id={`deck-insight-section-${id}`} className="mt-2 space-y-3">
          {children}
        </div>
      )}
    </section>
  );
}
