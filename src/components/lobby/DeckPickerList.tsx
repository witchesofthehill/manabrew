import type { ReactNode } from "react";
import { Search } from "lucide-react";

interface DeckPickerListProps {
  search: string;
  onSearchChange: (search: string) => void;
  children: ReactNode;
}

export function DeckPickerList({ search, onSearchChange, children }: DeckPickerListProps) {
  return (
    <>
      <div className="shrink-0 bg-background px-4 pb-2 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            aria-label="Filter decks"
            placeholder="Filter decks..."
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            className="min-h-9 w-full rounded-md border bg-background pl-9 pr-3 text-ui-input focus:outline-none focus:ring-1 focus:ring-primary touch:min-h-11 touch:min-w-11"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </>
  );
}
