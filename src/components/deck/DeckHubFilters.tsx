import { useState } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { DeckHubFilterPanel } from "@/components/deck/DeckHubFilterPanel";
import { DeckHubFilterSheet } from "@/components/deck/DeckHubFilterSheet";
import type { DeckHubDiscoveryFilters } from "@/components/deck/deckHub.types";
import type { DeckHubFacets } from "@/api/hubTypes";
import { cn } from "@/lib/utils";

interface DeckHubFiltersProps {
  filters: DeckHubDiscoveryFilters;
  facets: DeckHubFacets | null;
  activeFilterCount: number;
  favoritesEnabled: boolean;
  onChange: (patch: Partial<DeckHubDiscoveryFilters>) => void;
  onClear: () => void;
}

export function DeckHubFilters(props: DeckHubFiltersProps) {
  const [expanded, setExpanded] = useState(
    () => sessionStorage.getItem("manabrew:community-filters-expanded") !== "false",
  );

  function toggleExpanded() {
    setExpanded((current) => {
      sessionStorage.setItem("manabrew:community-filters-expanded", String(!current));
      return !current;
    });
  }

  return (
    <div
      className={cn(
        "shrink-0 transition-[width] lg:order-2 lg:border-l",
        expanded ? "lg:w-72" : "lg:w-14",
      )}
    >
      <div className="flex justify-end border-b px-4 py-3 sm:px-6 lg:hidden">
        <DeckHubFilterSheet {...props} />
      </div>
      <aside className="hidden h-full overflow-y-auto p-5 lg:block" aria-label="Community filters">
        <div
          className={cn(
            "flex items-start",
            expanded ? "mb-4 justify-between gap-2" : "justify-center",
          )}
        >
          {expanded && (
            <div>
              <h2 className="font-serif text-xl font-semibold">Filters</h2>
              <p className="mt-1 text-xs text-muted-foreground">Refine published deck results.</p>
            </div>
          )}
          <button
            type="button"
            className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={expanded ? "Collapse filters" : "Expand filters"}
            onClick={toggleExpanded}
          >
            {expanded ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </button>
        </div>
        {expanded && <DeckHubFilterPanel {...props} />}
      </aside>
    </div>
  );
}
