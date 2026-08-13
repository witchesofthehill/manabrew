import { useMemo, useState } from "react";
import { Download, LayoutGrid, LibraryBig, List, Search, Trash2, Upload } from "lucide-react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { CollectionCard } from "@/components/collection/CollectionCard";
import { CollectionDeleteDialog } from "@/components/collection/CollectionDeleteDialog";
import { CollectionQuickAdd } from "@/components/collection/CollectionQuickAdd";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CollectionImportDialog } from "@/components/collection/CollectionImportDialog";
import { HoverCardPreview } from "@/components/game/HoverCardPreview";
import { PreviewRail } from "@/components/editor/PreviewRail";
import { useCardCollection } from "@/hooks/useCardCollection";
import { useCardPreview } from "@/hooks/useCardPreview";
import { ROUTES } from "@/lib/constants";
import {
  collectionCardKey,
  collectionQuantityForName,
  parseCollectionCardKey,
} from "@/lib/collection";
import { cn } from "@/lib/utils";
import { deckCardToPreviewDto, scryfallToDeckCard } from "@/lib/scryfall.utils";
import { useAuthStore } from "@/stores/useAuthStore";
import { useCollectionStore } from "@/stores/useCollectionStore";

export default function MyCollection() {
  useCardCollection();
  const authStatus = useAuthStore((state) => state.status);
  const quantities = useCollectionStore((state) => state.quantities);
  const setQuantity = useCollectionStore((state) => state.setQuantity);
  const replaceQuantities = useCollectionStore((state) => state.replaceQuantities);
  const loading = useCollectionStore((state) => state.loading);
  const syncError = useCollectionStore((state) => state.error);
  const [query, setQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [view, setView] = useState<"text" | "grid">("grid");
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [previewSlot, setPreviewSlot] = useState<HTMLDivElement | null>(null);
  const [visibleRowCount, setVisibleRowCount] = useState(100);
  const preview = useCardPreview();
  const collectionRows = useMemo(
    () =>
      Object.entries(quantities)
        .map(([cardKey, quantity]) => ({ cardKey, quantity, ...parseCollectionCardKey(cardKey) }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.cardKey.localeCompare(b.cardKey)),
    [quantities],
  );
  const rows = useMemo(
    () =>
      collectionRows.filter(({ name, setCode }) =>
        `${name} ${setCode ?? ""}`.includes(query.trim().toLowerCase()),
      ),
    [collectionRows, query],
  );
  const visibleRows = rows.slice(0, visibleRowCount);

  if (authStatus === "unknown") return null;
  if (authStatus !== "signedIn") return <Navigate to={ROUTES.SETTINGS} replace />;

  function exportCollection() {
    const csv = [
      "Quantity,Card Name,Set Code,Collector Number,Foil",
      ...collectionRows.map(
        ({ name, setCode, collectorNumber, foil, quantity }) =>
          `${quantity},"${name.replaceAll('"', '""')}",${setCode ?? ""},${collectorNumber ?? ""},${foil === undefined ? "" : foil}`,
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "manabrew-collection.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function updateQuantity(cardKey: string, quantity: number) {
    void setQuantity(cardKey, quantity).catch(() => {
      toast.error("Account sync failed. This change is preserved locally.");
    });
  }

  async function deleteCollection() {
    try {
      await replaceQuantities({});
      setQuery("");
      toast.success("Collection deleted");
    } catch (error) {
      toast.error("Account sync failed. The deletion is preserved locally and will retry.");
      throw error;
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full">
      <div className="min-w-0 flex-1 overflow-y-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="w-full">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <LibraryBig className="h-5 w-5 text-primary" />
                <h1 className="text-2xl font-semibold">My Collection</h1>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {loading
                  ? "Syncing with your account…"
                  : `${Object.keys(quantities).length} collection entries`}
              </p>
              {syncError && (
                <p className="mt-1 text-sm text-destructive">
                  Account sync failed. Changes are preserved locally and will retry on the next
                  edit.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="mr-1.5 h-4 w-4" /> Import
              </Button>
              <Button
                variant="outline"
                disabled={Object.keys(quantities).length === 0}
                onClick={exportCollection}
              >
                <Download className="mr-1.5 h-4 w-4" /> Export CSV
              </Button>
              <Button
                variant="destructive"
                disabled={loading || collectionRows.length === 0}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="mr-1.5 h-4 w-4" /> Delete collection
              </Button>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 max-w-md flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={query}
                placeholder="Search your collection"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setVisibleRowCount(100);
                }}
              />
            </div>
            <CollectionQuickAdd
              getCount={(name) => collectionQuantityForName(quantities, name)}
              onAdd={(name, quantity, setCode, collectorNumber, foil) => {
                const cardKey = collectionCardKey(name, setCode, collectorNumber, foil);
                updateQuantity(cardKey, (quantities[cardKey] ?? 0) + quantity);
              }}
              onHover={(card, event) =>
                preview.handleMouseEnter(deckCardToPreviewDto(scryfallToDeckCard(card)), event, {
                  placement: "pinned",
                })
              }
              onLeave={preview.handleMouseLeave}
            />
            <div className="flex shrink-0 overflow-hidden rounded-md border">
              <button
                type="button"
                title="Grid view"
                aria-label="Grid view"
                aria-pressed={view === "grid"}
                onClick={() => {
                  setView("grid");
                  setVisibleRowCount(100);
                }}
                className={cn(
                  "px-2.5 py-2 transition-colors",
                  view === "grid"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="Text view"
                aria-label="Text view"
                aria-pressed={view === "text"}
                onClick={() => {
                  setView("text");
                  setVisibleRowCount(100);
                }}
                className={cn(
                  "border-l px-2.5 py-2 transition-colors",
                  view === "text"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div
            className={cn(
              "mt-4",
              view === "text"
                ? "overflow-hidden rounded-xl border"
                : "grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 xl:grid-cols-4",
            )}
          >
            {visibleRows.map(({ cardKey, name, setCode, collectorNumber, foil, quantity }) => (
              <CollectionCard
                key={cardKey}
                name={name}
                setCode={setCode}
                collectorNumber={collectorNumber}
                foil={foil}
                quantity={quantity}
                view={view}
                onQuantityChange={(nextQuantity) => updateQuantity(cardKey, nextQuantity)}
                onHover={(card, event) =>
                  preview.handleMouseEnter(deckCardToPreviewDto(card), event, {
                    placement: "pinned",
                  })
                }
                onLeave={preview.handleMouseLeave}
              />
            ))}
            {!loading && rows.length === 0 && (
              <div
                className={cn(
                  "px-4 py-16 text-center text-sm text-muted-foreground",
                  view === "grid" && "col-span-full rounded-xl border",
                )}
              >
                {query
                  ? "No cards match your search."
                  : "Import a CSV or text list to start your collection."}
              </div>
            )}
          </div>
          {visibleRows.length < rows.length && (
            <div className="mt-6 flex justify-center">
              <Button variant="outline" onClick={() => setVisibleRowCount((count) => count + 100)}>
                Show 100 more · {rows.length - visibleRows.length} remaining
              </Button>
            </div>
          )}
        </div>
      </div>
      <div className="hidden lg:contents">
        <PreviewRail
          setSlot={setPreviewSlot}
          collapsed={previewCollapsed}
          onCollapse={() => setPreviewCollapsed((collapsed) => !collapsed)}
          previewCard={preview.hoveredCard}
        />
      </div>
      <HoverCardPreview preview={preview} slot={previewSlot} pinned imageSize="normal" />
      <CollectionImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        currentQuantities={quantities}
        onImport={replaceQuantities}
      />
      <CollectionDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        entryCount={collectionRows.length}
        onDelete={deleteCollection}
      />
    </div>
  );
}
