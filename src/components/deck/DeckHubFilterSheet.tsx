import { SlidersHorizontal } from "lucide-react";
import { DeckHubFilterPanel } from "@/components/deck/DeckHubFilterPanel";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { DeckHubDiscoveryFilters } from "@/components/deck/deckHub.types";
import type { DeckHubFacets } from "@/api/hubTypes";

interface DeckHubFilterSheetProps {
  filters: DeckHubDiscoveryFilters;
  facets: DeckHubFacets | null;
  activeFilterCount: number;
  favoritesEnabled: boolean;
  onChange: (patch: Partial<DeckHubDiscoveryFilters>) => void;
  onClear: () => void;
}

export function DeckHubFilterSheet(props: DeckHubFilterSheetProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" className="relative h-10 gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          Filters
          {props.activeFilterCount > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
              {props.activeFilterCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col sm:max-w-md">
        <SheetHeader className="pr-8">
          <SheetTitle>Community filters</SheetTitle>
          <SheetDescription>Refine the published decks shown in the grid.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto py-4">
          <DeckHubFilterPanel {...props} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
