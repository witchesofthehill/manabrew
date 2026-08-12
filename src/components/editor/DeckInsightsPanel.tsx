import { useState, type MouseEvent } from "react";

import { cn } from "@/lib/utils";
import type { DeckCard } from "@/protocol/deck";
import type { EditorDeck } from "@/types/manabrew";
import { DeckBudgetPanel } from "./DeckBudgetPanel";
import { DeckCollectionPanel } from "./DeckCollectionPanel";
import { DeckHealthPanel } from "./DeckHealthPanel";
import { DeckIntentPanel } from "./DeckIntentPanel";
import { DeckStats } from "./DeckStats";
import { ManaProbabilityPanel } from "./ManaProbabilityPanel";
import { ReplacementSuggestionsPanel } from "./ReplacementSuggestionsPanel";

type InsightTab = "overview" | "mana" | "collection" | "budget" | "replacements";

const TABS: { id: InsightTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "mana", label: "Mana" },
  { id: "collection", label: "Collection" },
  { id: "budget", label: "Budget" },
  { id: "replacements", label: "Replacements" },
];

export function DeckInsightsPanel({
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
  const [activeTab, setActiveTab] = useState<InsightTab>("overview");

  return (
    <section aria-label="Deck insights" className="min-w-0">
      <div
        role="tablist"
        aria-label="Deck insight categories"
        className="mb-3 flex max-w-full gap-1 overflow-x-auto rounded-lg border bg-muted/20 p-1"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            id={`deck-insight-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`deck-insight-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={cn(
              "min-h-9 shrink-0 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              activeTab === tab.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
            )}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const index = TABS.findIndex((candidate) => candidate.id === activeTab);
              const delta = event.key === "ArrowRight" ? 1 : -1;
              const next = TABS[(index + delta + TABS.length) % TABS.length]!;
              setActiveTab(next.id);
              requestAnimationFrame(() =>
                document.getElementById(`deck-insight-tab-${next.id}`)?.focus(),
              );
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        id={`deck-insight-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`deck-insight-tab-${activeTab}`}
        className="space-y-3"
      >
        {activeTab === "overview" && (
          <>
            <DeckHealthPanel
              deck={deck}
              unsupportedNames={unsupportedNames}
              validationErrors={validationErrors}
              onShowUnsupported={onShowUnsupported}
              onOpenSearch={onOpenSearch}
            />
            <DeckIntentPanel deck={deck} />
          </>
        )}
        {activeTab === "mana" && (
          <>
            <DeckStats activeBucket={activeBucket} onBucketClick={onBucketClick} />
            <ManaProbabilityPanel deck={deck} />
          </>
        )}
        {activeTab === "collection" && (
          <DeckCollectionPanel cardSize={cardSize} onHover={onCardHover} onLeave={onCardLeave} />
        )}
        {activeTab === "budget" && <DeckBudgetPanel />}
        {activeTab === "replacements" && (
          <ReplacementSuggestionsPanel
            cardSize={cardSize}
            onHover={onCardHover}
            onLeave={onCardLeave}
          />
        )}
      </div>
    </section>
  );
}
