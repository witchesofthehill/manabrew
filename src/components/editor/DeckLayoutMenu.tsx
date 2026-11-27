import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Layers, LayoutGrid, List, Plus, Trash2 } from "lucide-react";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
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
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useDeckStore } from "@/stores/useDeckStore";
import { GROUP_BY_OPTIONS, MAX_CARD_SIZE, SORT_OPTIONS } from "./deckBuilder.utils";
import { setAllDeckSectionsExpanded } from "./deckSectionExpansion";
import type { GroupByMode, SortMode, ViewMode } from "./deckBuilder.utils";
import type { DeckOwnershipStatus } from "@/lib/collection";
interface DeckLayoutMenuProps {
  previewCollapsed?: boolean;
  onPreviewCollapsedChange?: (collapsed: boolean) => void;
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
  previewCollapsed,
  onPreviewCollapsedChange,
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
  const readOnly = useDeckStore((state) => state.isReadOnly);
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
    if (readOnly || !activeLayout || (activeLayoutMatches && activeCollectionFilterMatches)) return;
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
    readOnly,
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
    if (!readOnly) {
      setEditorMetadata({
        ...metadata,
        version: 1,
        tags: metadata?.tags ?? [],
        layouts,
        activeLayoutId: id,
      });
    }
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
      <div className="flex shrink-0 rounded-md border" role="group" aria-label="Deck view">
        {(
          [
            ["list", "List", List],
            ["visual", "Grid", LayoutGrid],
            ["stack", "Stacks", Layers],
          ] as const
        ).map(([mode, label, Icon]) => (
          <Button
            key={mode}
            variant={viewMode === mode ? "selected" : "ghost"}
            size="icon-sm"
            className="h-8 w-8 shadow-none"
            aria-label={`${label} view`}
            aria-pressed={viewMode === mode}
            title={`${label} view`}
            onClick={() => onApply(groupBy, sortBy, cardSize, filter, mode, collectionFilter)}
          >
            <Icon className="size-4" />
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-ui-label text-muted-foreground">Group</span>
        <AppSelect
          value={groupBy}
          onValueChange={(group) =>
            onApply(group as GroupByMode, sortBy, cardSize, filter, viewMode, collectionFilter)
          }
          aria-label={`Group by: ${GROUP_BY_OPTIONS.find((option) => option.value === groupBy)?.label ?? groupBy}`}
          className="min-h-8 px-2"
        >
          {GROUP_BY_OPTIONS.map(({ value, label }) => (
            <AppSelectOption key={value} value={value}>
              {label}
            </AppSelectOption>
          ))}
        </AppSelect>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-ui-label text-muted-foreground">Sort</span>
        <AppSelect
          value={sortBy}
          onValueChange={(sort) =>
            onApply(groupBy, sort as SortMode, cardSize, filter, viewMode, collectionFilter)
          }
          aria-label={`Sort by: ${SORT_OPTIONS.find((option) => option.value === sortBy)?.label ?? sortBy}`}
          className="min-h-8 px-2"
        >
          {SORT_OPTIONS.map(({ value, label }) => (
            <AppSelectOption key={value} value={value}>
              {label}
            </AppSelectOption>
          ))}
        </AppSelect>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground">
            View options <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Deck layout</DropdownMenuLabel>
          {viewMode !== "list" && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Card size</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={String(cardSize)}
                    onValueChange={(size) =>
                      onApply(groupBy, sortBy, Number(size), filter, viewMode, collectionFilter)
                    }
                  >
                    {Array.from({ length: MAX_CARD_SIZE }, (_, index) => index + 1).map((size) => (
                      <DropdownMenuRadioItem key={size} value={String(size)}>
                        {size === 1
                          ? "1 (smallest)"
                          : size === MAX_CARD_SIZE
                            ? `${size} (largest)`
                            : size}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )}
          <DropdownMenuItem onSelect={() => setAllDeckSectionsExpanded(true)}>
            Expand all sections
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setAllDeckSectionsExpanded(false)}>
            Collapse all sections
          </DropdownMenuItem>
          {onPreviewCollapsedChange && (
            <DropdownMenuItem
              className="hidden lg:flex"
              onSelect={() => onPreviewCollapsedChange(!previewCollapsed)}
            >
              {previewCollapsed ? "Show card inspector" : "Hide card inspector"}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Presets</DropdownMenuLabel>
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
          {(layouts.length > 0 || !readOnly) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Saved views</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={activeLayout?.id} onValueChange={selectLayout}>
                {layouts.map((layout) => (
                  <DropdownMenuRadioItem key={layout.id} value={layout.id}>
                    {layout.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {!readOnly && (
                <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
                  <Plus /> Save current view
                </DropdownMenuItem>
              )}
              {!readOnly && layouts.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Delete a saved view</DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent>
                      {layouts.map((layout) => (
                        <DropdownMenuItem key={layout.id} onSelect={() => removeLayout(layout.id)}>
                          <Trash2 /> {layout.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              )}
            </>
          )}
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
            placeholder={`Combo layout`}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") saveLayout();
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!name.trim()} onClick={saveLayout}>
              Save view
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
