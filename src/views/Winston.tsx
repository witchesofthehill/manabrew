import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import LimitedDeckBuilder from "@/components/limited/LimitedDeckBuilder";
import { LimitedModeToggle, type LimitedDraftMode } from "@/components/limited/LimitedModeToggle";
import { WinstonWorkspace } from "@/components/limited/WinstonWorkspace";
import { LimitedTableSurface } from "@/components/limited/LimitedTableSurface";
import { useLimitedStore } from "@/stores/useLimitedStore";
type WinstonMode = LimitedDraftMode;
export default function Winston() {
  const { winstonId } = useParams<{
    winstonId: string;
  }>();
  const activeWinston = useLimitedStore((s) => s.activeWinston);
  const refresh = useLimitedStore((s) => s.refreshWinstonState);
  const take = useLimitedStore((s) => s.winstonTake);
  const pass = useLimitedStore((s) => s.winstonPass);
  const lastError = useLimitedStore((s) => s.lastError);
  const [userMode, setUserMode] = useState<WinstonMode>("drafting");
  const [confirmDrawOpen, setConfirmDrawOpen] = useState(false);
  useEffect(() => {
    if (!winstonId) return;
    if (!activeWinston || activeWinston.sessionId !== winstonId) {
      refresh(winstonId);
    }
  }, [winstonId, activeWinston, refresh]);
  const mode: WinstonMode = activeWinston?.isComplete ? "building" : userMode;
  if (!activeWinston || activeWinston.sessionId !== winstonId) {
    return (
      <LimitedTableSurface className="items-center justify-center">
        {lastError ? (
          <p className="text-destructive">{lastError}</p>
        ) : (
          <p className="text-muted-foreground">Loading Winston draft…</p>
        )}
      </LimitedTableSurface>
    );
  }
  const handleTake = async () => {
    if (!winstonId || !activeWinston.awaitingHuman) return;
    try {
      await take(winstonId);
    } catch {
      /* surfaced via lastError */
    }
  };
  const submitPass = async () => {
    if (!winstonId || !activeWinston.awaitingHuman) return;
    try {
      await pass(winstonId);
    } catch {
      /* surfaced via lastError */
    }
  };
  const pileCount = activeWinston.piles.length;
  const activeIdx =
    pileCount > 0 ? Math.min(Math.max(activeWinston.currentPile, 0), pileCount - 1) : 0;
  const canBuild = activeWinston.pickedPile.length >= 1;
  const passWillForceDraw = pileCount > 0 && activeIdx === pileCount - 1;
  const handlePass = async () => {
    if (passWillForceDraw) {
      setConfirmDrawOpen(true);
      return;
    }
    await submitPass();
  };
  return (
    <LimitedTableSurface className="gap-2 px-4 py-3 sm:px-6 lg:px-8">
      <header className="z-10 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Deck: {activeWinston.deckSize} cards left</span>
          <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[11px]">
            AI: {activeWinston.aiPickCount} picks
          </span>
          {activeWinston.isComplete ? (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
              Complete
            </span>
          ) : activeWinston.awaitingHuman ? (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
              Your turn — viewing pile {activeIdx + 1}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded bg-muted/60 px-1.5 py-0.5 text-[11px] font-medium">
              <Loader2 className="h-3 w-3 animate-spin" />
              AI thinking…
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          {canBuild && (
            <LimitedModeToggle
              mode={mode}
              onChange={setUserMode}
              disableDrafting={activeWinston.isComplete}
            />
          )}
        </div>
      </header>

      {mode === "building" ? (
        <div className="min-h-0 flex-1">
          <LimitedDeckBuilder
            key={activeWinston.sessionId}
            sessionKey={activeWinston.sessionId}
            pool={activeWinston.pickedPile}
            defaultDeckName="Winston Draft Deck"
            format="draft"
          />
        </div>
      ) : (
        <WinstonWorkspace
          activeWinston={activeWinston}
          activeIdx={activeIdx}
          onTake={handleTake}
          onPass={handlePass}
        />
      )}

      {lastError && (
        <p className="rounded border border-destructive/70 bg-destructive/10 p-3 text-sm text-destructive">
          {lastError}
        </p>
      )}

      <Dialog open={confirmDrawOpen} onOpenChange={setConfirmDrawOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pass the last pile?</DialogTitle>
            <DialogDescription>
              Passing the last pile means you'll draw the top card of the deck instead. The pile you
              skip stays on the table for the next player. Are you sure?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDrawOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                setConfirmDrawOpen(false);
                await submitPass();
              }}
            >
              Pass &amp; draw
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </LimitedTableSurface>
  );
}
