import { DeckHubFilterPanel } from "@/components/deck/DeckHubFilterPanel";
import { DeckHubFilterSheet } from "@/components/deck/DeckHubFilterSheet";
import type { DeckHubDiscoveryFilters } from "@/components/deck/deckHub.types";
import type { DeckHubFacets } from "@/api/hubTypes";

interface DeckHubFiltersProps {
  filters: DeckHubDiscoveryFilters;
  facets: DeckHubFacets | null;
  activeFilterCount: number;
  favoritesEnabled: boolean;
  onChange: (patch: Partial<DeckHubDiscoveryFilters>) => void;
  onClear: () => void;
}

export function DeckHubFilters(props: DeckHubFiltersProps) {
  return (
    <div className="shrink-0 lg:order-2 lg:w-72 lg:border-l">
      <div className="flex justify-end border-b px-4 py-3 sm:px-6 lg:hidden">
        <DeckHubFilterSheet {...props} />
      </div>
      <aside className="hidden h-full overflow-y-auto p-5 lg:block" aria-label="Community filters">
        <div className="mb-4">
          <h2 className="font-serif text-xl font-semibold">Filters</h2>
          <p className="mt-1 text-xs text-muted-foreground">Refine published deck results.</p>
        </div>
        <DeckHubFilterPanel {...props} />
      </aside>
    </div>
  );
}
