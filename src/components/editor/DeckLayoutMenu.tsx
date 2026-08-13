import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, LayoutTemplate, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useDeckStore } from "@/stores/useDeckStore";
import type { GroupByMode, SortMode, ViewMode } from "./deckBuilder.utils";
import type { DeckOwnershipStatus } from "@/lib/collection";

interface DeckLayoutMenuProps {
  groupBy: GroupByMode;
  sortBy: SortMode;
  cardSize: number;
  filter: string;
  viewMode: ViewMode;
  collectionFilter: "all" | DeckOwnershipStatus;
  onApply: (
    groupBy: GroupByMode,
    sortBy: SortMode,
    cardSize: number,
    filter: string,
    viewMode: ViewMode,
    collectionFilter: "all" | DeckOwnershipStatus,
  ) => void;
}

export function DeckLayoutMenu({
  groupBy,
  sortBy,
  cardSize,
  filter,
  viewMode,
  collectionFilter,
  onApply,
}: DeckLayoutMenuProps) {
  const metadata = useDeckStore((state) => state.currentDeck.editor);
  const setEditorMetadata = useDeckStore((state) => state.setEditorMetadata);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const layouts = useMemo(() => metadata?.layouts ?? [], [metadata?.layouts]);
  const activeLayout = layouts.find((layout) => layout.id === metadata?.activeLayoutId);
  const activeLayoutMatches =
    activeLayout?.groupBy === groupBy &&
    activeLayout.sortBy === sortBy &&
    (activeLayout.cardSize ?? cardSize) === cardSize &&
    (activeLayout.filter ?? "") === filter &&
    (activeLayout.viewMode ?? viewMode) === viewMode;
  const activeCollectionFilterMatches =
    (activeLayout?.collectionFilter ?? "all") === collectionFilter;

  useEffect(() => {
    if (!activeLayout || (activeLayoutMatches && activeCollectionFilterMatches)) return;
    setEditorMetadata({
      ...metadata,
      version: 1,
      tags: metadata?.tags ?? [],
      layouts,
      activeLayoutId: undefined,
    });
  }, [
    activeLayout,
    activeLayoutMatches,
    activeCollectionFilterMatches,
    layouts,
    metadata,
    setEditorMetadata,
  ]);

  function saveLayout() {
    const layoutName = name.trim();
    if (!layoutName) return;
    const id = crypto.randomUUID();
    setEditorMetadata({
      ...metadata,
      version: 1,
      tags: metadata?.tags ?? [],
      layouts: [
        ...layouts,
        {
          id,
          name: layoutName,
          groupBy,
          sortBy,
          cardSize,
          filter,
          viewMode,
          collectionFilter,
          groups: [],
        },
      ],
      activeLayoutId: id,
    });
    setName("");
    setCreateOpen(false);
  }

  function selectLayout(id: string) {
    const layout = layouts.find((candidate) => candidate.id === id);
    if (!layout) return;
    setEditorMetadata({
      ...metadata,
      version: 1,
      tags: metadata?.tags ?? [],
      layouts,
      activeLayoutId: id,
    });
    onApply(
      layout.groupBy,
      layout.sortBy,
      layout.cardSize ?? cardSize,
      layout.filter ?? "",
      layout.viewMode ?? viewMode,
      layout.collectionFilter ?? "all",
    );
  }

  function removeLayout(id: string) {
    setEditorMetadata({
      ...metadata,
      version: 1,
      tags: metadata?.tags ?? [],
      layouts: layouts.filter((layout) => layout.id !== id),
      activeLayoutId: metadata?.activeLayoutId === id ? undefined : metadata?.activeLayoutId,
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
            <LayoutTemplate className="h-3.5 w-3.5" />
            {activeLayout?.name ?? "View"}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem
            onSelect={() => onApply("type", "not-owned", cardSize, "", viewMode, "missing")}
          >
            Collection gaps
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => onApply("custom", "name", cardSize, "", viewMode, "all")}
          >
            Tags workspace
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => onApply("cmc", "mana-value", cardSize, "", "stack", "all")}
          >
            Mana review
          </DropdownMenuItem>
          {layouts.map((layout) => (
            <DropdownMenuItem
              key={layout.id}
              className="gap-2"
              onSelect={() => selectLayout(layout.id)}
            >
              <Check
                className={cn("h-3.5 w-3.5", metadata?.activeLayoutId !== layout.id && "opacity-0")}
              />
              <span className="flex-1 truncate">{layout.name}</span>
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:text-destructive"
                title={`Delete ${layout.name}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  removeLayout(layout.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-3.5 w-3.5" /> Save current view
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save deck view</DialogTitle>
            <DialogDescription>
              Keep the current grouping, sorting, and card size.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={name}
            placeholder="Combo layout"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") saveLayout();
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!name.trim()} onClick={saveLayout}>
              Save view
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
