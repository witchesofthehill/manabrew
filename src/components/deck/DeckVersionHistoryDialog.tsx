import { useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchDeckVersion } from "@/api/hub";
import type { DeckVersionSummary } from "@/api/hubTypes";
import { useAccountDecksStore } from "@/stores/useAccountDecksStore";
import type { EditorDeck } from "@/types/manabrew";

const EMPTY_VERSIONS: DeckVersionSummary[] = [];

interface DeckVersionHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deckId: string;
  currentVersionNo: number;
  onRestore: (deck: EditorDeck, versionNo: number) => void;
}

export function DeckVersionHistoryDialog({
  open,
  onOpenChange,
  deckId,
  currentVersionNo,
  onRestore,
}: DeckVersionHistoryDialogProps) {
  const versions = useAccountDecksStore((state) => state.versions[deckId] ?? EMPTY_VERSIONS);
  const loadVersions = useAccountDecksStore((state) => state.loadVersions);
  const [loadingVersion, setLoadingVersion] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoadError(null);
    void loadVersions(deckId).catch((error) => {
      setLoadError(error instanceof Error ? error.message : "Failed to load version history");
    });
  }, [deckId, loadVersions, open]);

  async function restore(versionNo: number) {
    setLoadingVersion(versionNo);
    try {
      const version = await fetchDeckVersion(deckId, versionNo);
      onRestore(version.deck as EditorDeck, versionNo);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load this deck version");
    } finally {
      setLoadingVersion(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription>
            Older versions are immutable. Restoring one loads its cards into the editor; saving
            creates a new version.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60dvh] space-y-2 overflow-y-auto">
          {loadError ? (
            <div className="py-8 text-center">
              <p className="text-sm text-destructive">{loadError}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  setLoadError(null);
                  void loadVersions(deckId).catch((error) => {
                    setLoadError(
                      error instanceof Error ? error.message : "Failed to load version history",
                    );
                  });
                }}
              >
                Retry
              </Button>
            </div>
          ) : versions.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading versions…
            </div>
          ) : (
            versions.map((version) => (
              <div
                key={version.id}
                className="flex items-center gap-3 rounded-lg border bg-card p-3"
              >
                <History className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    Version {version.versionNo}
                    {version.versionNo === currentVersionNo ? " · Current" : ""}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {version.notes || new Date(version.createdAt).toLocaleString()}
                    {version.published ? " · Published" : ""}
                  </p>
                </div>
                {version.versionNo !== currentVersionNo && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loadingVersion !== null}
                    onClick={() => void restore(version.versionNo)}
                  >
                    {loadingVersion === version.versionNo ? "Loading…" : "Restore"}
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
