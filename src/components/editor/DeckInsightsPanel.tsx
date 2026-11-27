import { useState, type MouseEvent, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeckCard } from "@/protocol/deck";
import type { EditorDeck } from "@/types/manabrew";
import { CombosPanel } from "./CombosPanel";
import { DeckBracketPanel } from "./DeckBracketPanel";
import { DeckBudgetPanel } from "./DeckBudgetPanel";
import { DeckCollectionPanel } from "./DeckCollectionPanel";
import { DeckHealthPanel } from "./DeckHealthPanel";
import { DeckGoalsPanel } from "./DeckGoalsPanel";
import { DeckIntentPanel } from "./DeckIntentPanel";
import { DeckStats } from "./DeckStats";
import { ManaProbabilityPanel } from "./ManaProbabilityPanel";
import { ReplacementSuggestionsPanel } from "./ReplacementSuggestionsPanel";
type InsightSection = "overview" | "mana" | "collection" | "budget" | "replacements";
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
  onOptimizeOwnedPrintings,
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
  onOptimizeOwnedPrintings?: () => void;
}) {
  return (
    <section
      aria-label={`Deck insights`}
      className="min-w-0 overflow-hidden rounded-2xl bg-muted/10 px-4 sm:px-5"
    >
      <InsightSectionPanel id="overview" label="Overview">
        <DeckHealthPanel
          deck={deck}
          unsupportedNames={unsupportedNames}
          validationErrors={validationErrors}
          onShowUnsupported={onShowUnsupported}
          onOpenSearch={onOpenSearch}
        />
        <DeckIntentPanel deck={deck} />
        <DeckGoalsPanel />
      </InsightSectionPanel>
      <InsightSectionPanel id="mana" label="Mana">
        <DeckStats cards={deck.cards} activeBucket={activeBucket} onBucketClick={onBucketClick} />
        <ManaProbabilityPanel deck={deck} />
      </InsightSectionPanel>
      <div className="space-y-4 border-b border-border/30 py-4 empty:hidden">
        <DeckBracketPanel />
        <CombosPanel />
      </div>
      <InsightSectionPanel id="budget" label="Budget">
        <DeckBudgetPanel />
      </InsightSectionPanel>
      <InsightSectionPanel id="replacements" label="Replacements">
        <ReplacementSuggestionsPanel
          cardSize={cardSize}
          onHover={onCardHover}
          onLeave={onCardLeave}
        />
      </InsightSectionPanel>
      <InsightSectionPanel id="collection" label="Collection">
        <DeckCollectionPanel
          cardSize={cardSize}
          onHover={onCardHover}
          onLeave={onCardLeave}
          onOptimizeOwnedPrintings={onOptimizeOwnedPrintings}
        />
      </InsightSectionPanel>
    </section>
  );
}
function InsightSectionPanel({
  id,
  label,
  children,
}: {
  id: InsightSection;
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section
      data-editor-insight={id}
      className="scroll-mt-14 border-b border-border/30 py-4 last:border-b-0"
    >
      <button
        type="button"
        className="flex min-h-9 touch:min-h-11 touch:min-w-11 w-full items-center gap-2 text-left text-ui-label font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
        aria-controls={`deck-insight-section-${id}`}
        onClick={() => setOpen((value) => !value)}
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
        <div id={`deck-insight-section-${id}`} className="mt-2 space-y-4">
          {children}
        </div>
      )}
    </section>
  );
}
