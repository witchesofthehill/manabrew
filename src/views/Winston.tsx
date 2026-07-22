import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import { CARD_BACK_IMAGE_URL } from "@/components/game/game.constants";
import { DraftCardTile } from "@/components/limited/DraftCardTile";
import LimitedDeckBuilder from "@/components/limited/LimitedDeckBuilder";
import { LimitedHoverPreviewPane } from "@/components/limited/LimitedHoverPreviewPane";
import { LimitedModeToggle, type LimitedDraftMode } from "@/components/limited/LimitedModeToggle";
import { useCardPreview } from "@/hooks/useCardPreview";
import { cn } from "@/lib/utils";
import { useLimitedStore } from "@/stores/useLimitedStore";
import { ScryfallImg } from "@/components/ScryfallImg";

type WinstonMode = LimitedDraftMode;

export default function Winston() {
  const { winstonId } = useParams<{ winstonId: string }>();
  const navigate = useNavigate();
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

  if (!activeWinston) {
    return (
      <div className="flex h-full items-center justify-center">
        {lastError ? (
          <p className="text-destructive">{lastError}</p>
        ) : (
          <p className="text-muted-foreground">Loading Winston draft…</p>
        )}
      </div>
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
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Winston Draft</h1>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Deck: {activeWinston.deckSize} cards left</span>
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
        </div>
        <div className="flex items-center gap-2">
          {canBuild && (
            <LimitedModeToggle
              mode={mode}
              onChange={setUserMode}
              disableDrafting={activeWinston.isComplete}
            />
          )}
          <Button variant="outline" onClick={() => navigate("/limited")}>
            Back
          </Button>
        </div>
      </header>

      {mode === "building" ? (
        <div className="min-h-0 flex-1">
          <LimitedDeckBuilder
            pool={activeWinston.pickedPile}
            defaultDeckName="Winston Draft Deck"
            format="draft"
          />
        </div>
      ) : (
        <DraftingView
          activeWinston={activeWinston}
          activeIdx={activeIdx}
          canBuild={canBuild}
          onTake={handleTake}
          onPass={handlePass}
          onJumpToBuild={() => setUserMode("building")}
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
            <Button variant="outline" onClick={() => setConfirmDrawOpen(false)}>
              Cancel
            </Button>
            <Button
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
    </div>
  );
}

interface DraftingViewProps {
  activeWinston: NonNullable<ReturnType<typeof useLimitedStore.getState>["activeWinston"]>;
  activeIdx: number;
  canBuild: boolean;
  onTake: () => void;
  onPass: () => void;
  onJumpToBuild: () => void;
}

function DraftingView({
  activeWinston,
  activeIdx,
  canBuild,
  onTake,
  onPass,
  onJumpToBuild,
}: DraftingViewProps) {
  const preview = useCardPreview();
  const activePileEmpty =
    activeWinston.piles.length === 0 || activeWinston.piles[activeIdx].length === 0;

  return (
    <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[1fr_minmax(0,340px)]">
      <div className="flex min-h-0 flex-col rounded-md border border-border/70 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Piles
          </h2>
          {activeWinston.awaitingHuman && (
            <div className="flex gap-2">
              <Button onClick={onTake} disabled={activePileEmpty} size="sm">
                Take Pile {activeIdx + 1}
              </Button>
              <Button variant="outline" onClick={onPass} size="sm">
                Pass
              </Button>
            </div>
          )}
        </div>
        <div className="grid flex-1 grid-cols-3 gap-3 overflow-y-auto">
          {activeWinston.piles.map((pile, i) => {
            const isActive = i === activeIdx && activeWinston.awaitingHuman;
            return (
              <div
                key={i}
                className={cn(
                  "flex flex-col gap-2 rounded border p-2",
                  isActive ? "border-primary bg-primary/5" : "border-border/40 bg-card/40",
                )}
              >
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                  Pile {i + 1} ({pile.length})
                </h3>
                {isActive ? (
                  pile.length === 0 ? (
                    <p className="text-xs text-muted-foreground">(empty)</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-1.5">
                      {pile.map((c, j) => (
                        <DraftCardTile
                          key={`pile-${i}-${j}`}
                          card={c}
                          index={j}
                          preview={preview}
                        />
                      ))}
                    </div>
                  )
                ) : (
                  <FaceDownStack count={pile.length} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <aside className="flex min-h-0 flex-col gap-4">
        <LimitedHoverPreviewPane preview={preview} className="hidden lg:block" />
        <section className="flex min-h-0 flex-1 flex-col rounded-md border border-border/70">
          <div className="flex items-center justify-between border-b border-border/40 px-4 py-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Your Pile ({activeWinston.pickedPile.length})
            </h2>
            {canBuild && (
              <Button size="sm" variant="outline" onClick={onJumpToBuild} className="h-7 text-xs">
                Build
              </Button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {activeWinston.pickedPile.length === 0 ? (
              <p className="text-xs text-muted-foreground">No picks yet.</p>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {activeWinston.pickedPile.map((c, i) => (
                  <DraftCardTile
                    key={`picked-${i}`}
                    card={c}
                    index={i}
                    preview={preview}
                    overlay={
                      <span
                        className="pointer-events-none absolute right-1 top-1 rounded-full border border-white/20 bg-black/70 px-1.5 py-0.5 text-[9px] font-bold text-white/90"
                        title={`Pick #${i + 1}`}
                      >
                        #{i + 1}
                      </span>
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="shrink-0 rounded-md border border-border/70 p-4 text-sm">
          <p className="text-muted-foreground">AI picks: {activeWinston.aiPickCount}</p>
        </section>
      </aside>
    </div>
  );
}

function FaceDownStack({ count }: { count: number }) {
  if (count === 0) {
    return <p className="text-xs text-muted-foreground">(empty)</p>;
  }
  return (
    <div className="relative aspect-[5/7] w-full">
      <ScryfallImg
        src={CARD_BACK_IMAGE_URL}
        alt={`Face-down pile of ${count} card${count === 1 ? "" : "s"}`}
        loading="lazy"
        className="absolute inset-0 h-full w-full rounded-md border border-border/40 object-cover shadow-sm"
      />
      <span className="pointer-events-none absolute bottom-1 right-1 rounded-full border border-white/20 bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white/90">
        ×{count}
      </span>
    </div>
  );
}
