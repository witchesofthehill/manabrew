import { useState } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { scryfallToDeckCard } from "@/lib/scryfall.utils";
import { useGameDevStore } from "@/stores/useGameDevStore";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { DevCardSearch } from "./DevCardSearch";

import {
  DEV_CONTROL_ACTIVE,
  DEV_CONTROL_BUTTON,
  DEV_CONTROL_INACTIVE,
  DEV_SECTION,
  DEV_SECTION_HEADING,
} from "./devPanel.styles";
import { matchesDevPanelSearch, useDevPanelSearch } from "./devPanelSearchContext";

const DEV_BATTLEFIELD_KEYWORDS: string[] = [
  "Flying",
  "First strike",
  "Double strike",
  "Trample",
  "Vigilance",
  "Haste",
  "Reach",
  "Lifelink",
  "Deathtouch",
  "Menace",
  "Defender",
  "Hexproof",
  "Indestructible",
  "Shroud",
  "Flash",
  "Prowess",
  "Ward:{2}",
  "Protection",
  "Phasing",
  "Shadow",
  "Horsemanship",
  "Skulk",
  "Fear",
  "Intimidate",
  "Cycling:{1}",
  "Equip:{2}",
  "Adapt:{3}",
  "Kicker:{R}",
  "Madness:{B}",
  "Buyback:{2}",
  "Flashback:{2}{R}",
  "Echo:{1}",
  "Bestow:{4}{W}",
  "Cascade",
  "Convoke",
  "Delve",
  "Dredge",
  "Embalm",
  "Eternalize",
  "Investigate",
  "Storm",
  "Affinity",
  "Annihilator",
  "Persist",
  "Undying",
  "Modular",
  "Bushido",
  "Exalted",
];

export function BattlefieldKeywordDevControls() {
  const selected = useGameDevStore((s) => s.debugBattlefieldKeywords);
  const toggle = useGameDevStore((s) => s.toggleDebugBattlefieldKeyword);
  const clear = useGameDevStore((s) => s.clearDebugBattlefieldKeywords);
  const debugCardEnabled = useGameDevStore((s) => s.debugCardEnabled);
  const debugCardName = useGameDevStore((s) => s.debugCardName);
  const debugCardDefinition = useGameDevStore((s) => s.debugCardDefinition);
  const setDebugCardEnabled = useGameDevStore((s) => s.setDebugCardEnabled);
  const setDebugCard = useGameDevStore((s) => s.setDebugCard);
  const query = useDevPanelSearch();
  const [loadingCard, setLoadingCard] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  const sectionMatch = matchesDevPanelSearch(query, "Keyword chips", "forced keywords");
  const visibleKeywords = sectionMatch
    ? DEV_BATTLEFIELD_KEYWORDS
    : DEV_BATTLEFIELD_KEYWORDS.filter((keyword) => matchesDevPanelSearch(query, keyword));
  const visibleSelected = selected.filter((keyword) => matchesDevPanelSearch(query, keyword));
  const showCardControls = matchesDevPanelSearch(
    query,
    "Card under test",
    "Scryfall card name",
    "On board",
    "Hidden",
    debugCardName,
  );
  const showKeywordControls =
    sectionMatch || visibleKeywords.length > 0 || visibleSelected.length > 0;

  if (!showCardControls && !showKeywordControls) return null;
  const toggleDebugCard = async () => {
    if (debugCardEnabled) {
      setDebugCardEnabled(false);
      return;
    }
    if (debugCardDefinition) {
      setDebugCardEnabled(true);
      return;
    }

    const requestedName = debugCardName;
    setLoadingCard(true);
    setCardError(null);
    try {
      const card = await useScryfallStore.getState().getCard({ name: requestedName });
      const current = useGameDevStore.getState();
      if (current.debugCardName !== requestedName || current.debugCardDefinition) return;
      setDebugCard(scryfallToDeckCard(card.info));
      setDebugCardEnabled(true);
    } catch {
      setCardError(`Could not load ${requestedName} from Scryfall.`);
    } finally {
      setLoadingCard(false);
    }
  };

  return (
    <section className={DEV_SECTION}>
      {showCardControls ? (
        <>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className={DEV_SECTION_HEADING}>Card under test</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Resolve a real print, then layer debug-only visuals over it.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={debugCardEnabled}
              className="flex shrink-0 items-center gap-2 rounded-md text-[10px] font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              disabled={loadingCard}
              onClick={() => void toggleDebugCard()}
            >
              {loadingCard ? "Loading" : debugCardEnabled ? "On board" : "Hidden"}
              {loadingCard ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              <span
                className={cn(
                  "relative h-6 w-11 rounded-full border transition-colors",
                  debugCardEnabled ? "border-primary bg-primary" : "border-border/70 bg-muted",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 block h-4.5 w-4.5 rounded-full bg-background shadow-sm transition-transform",
                    debugCardEnabled ? "translate-x-[1.25rem]" : "translate-x-0.5",
                  )}
                />
              </span>
            </button>
          </div>
          {cardError ? <p className="mt-2 text-xs text-destructive">{cardError}</p> : null}

          <div className="mt-3">
            <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Scryfall card name
            </span>
            <DevCardSearch
              key={debugCardName}
              value={debugCardName}
              onSelect={(card) => setDebugCard(scryfallToDeckCard(card))}
            />
          </div>
        </>
      ) : null}

      {showKeywordControls ? (
        <>
          <div className="mt-4 flex items-center justify-between gap-3">
            <div>
              <p className={DEV_SECTION_HEADING}>Keyword chips</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {selected.length === 0 ? "No forced keywords" : `${selected.length} forced`}
              </p>
            </div>
            {selected.length > 0 ? (
              <button
                type="button"
                className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-destructive"
                onClick={clear}
              >
                Clear all
              </button>
            ) : null}
          </div>

          {visibleSelected.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {visibleSelected.map((keyword) => (
                <button
                  key={keyword}
                  type="button"
                  className={cn(DEV_CONTROL_BUTTON, DEV_CONTROL_ACTIVE, "px-2 py-1 text-[10px]")}
                  onClick={() => toggle(keyword)}
                >
                  {keyword}
                  <span aria-hidden="true">×</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {visibleKeywords.map((keyword) => {
              const active = selected.includes(keyword);
              return (
                <button
                  key={keyword}
                  type="button"
                  className={cn(
                    DEV_CONTROL_BUTTON,
                    "truncate px-2 py-1.5 text-[10px]",
                    active ? DEV_CONTROL_ACTIVE : DEV_CONTROL_INACTIVE,
                  )}
                  onClick={() => toggle(keyword)}
                  title={keyword}
                >
                  {keyword}
                </button>
              );
            })}
          </div>
          {visibleKeywords.length === 0 ? (
            <p className="mt-3 text-center text-xs text-muted-foreground">No keyword matches.</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
