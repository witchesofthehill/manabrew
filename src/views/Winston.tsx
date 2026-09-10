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
import { CARD_BACK_IMAGE_URL } from "@/components/game/game.constants";
import { DraftCardTile } from "@/components/limited/DraftCardTile";
import { DraftPoolPanel } from "@/components/limited/DraftPoolPanel";
import LimitedDeckBuilder from "@/components/limited/LimitedDeckBuilder";
import { LimitedHoverPreviewPane } from "@/components/limited/LimitedHoverPreviewPane";
import { LimitedModeToggle, type LimitedDraftMode } from "@/components/limited/LimitedModeToggle";
import {
  LimitedWorkspaceTabs,
  type LimitedWorkspaceTab,
} from "@/components/limited/LimitedWorkspaceTabs";
import { useCardPreview } from "@/hooks/useCardPreview";
import { cn } from "@/lib/utils";
import { useLimitedStore } from "@/stores/useLimitedStore";
import { ScryfallImg } from "@/components/ScryfallImg";
import { Trans } from "@lingui/react/macro";
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
  if (!activeWinston) {
    return (
      <div className="flex h-full items-center justify-center">
        {lastError ? (
          <p className="text-destructive">{lastError}</p>
        ) : (
          <p className="text-muted-foreground">
            <Trans>Loading Winston draft…</Trans>
          </p>
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
    <div className="flex h-full flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <header className="z-10 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>
            <Trans>Deck: {activeWinston.deckSize} cards left</Trans>
          </span>
          <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[11px]">
            <Trans>AI: {activeWinston.aiPickCount} picks</Trans>
          </span>
          {activeWinston.isComplete ? (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
              <Trans>Complete</Trans>
            </span>
          ) : activeWinston.awaitingHuman ? (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
              <Trans>Your turn — viewing pile {activeIdx + 1}</Trans>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded bg-muted/60 px-1.5 py-0.5 text-[11px] font-medium">
              <Trans>
                <Loader2 className="h-3 w-3 animate-spin" />
                AI thinking…
              </Trans>
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
            <DialogTitle>
              <Trans>Pass the last pile?</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>
                Passing the last pile means you'll draw the top card of the deck instead. The pile
                you skip stays on the table for the next player. Are you sure?
              </Trans>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDrawOpen(false)}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              onClick={async () => {
                setConfirmDrawOpen(false);
                await submitPass();
              }}
            >
              <Trans>Pass &amp; draw</Trans>
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
  const [mobileTab, setMobileTab] = useState<LimitedWorkspaceTab>("pack");
  const activePileEmpty =
    activeWinston.piles.length === 0 || activeWinston.piles[activeIdx].length === 0;
  const activePile = activeWinston.piles[activeIdx] ?? [];
  const activePilePanel = (
    <section className="flex min-h-0 flex-1 flex-col rounded-md border border-primary/50 bg-primary/5 motion-safe:animate-draft-pack-arrive">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-primary">
            <Trans>Active pile {activeIdx + 1}</Trans>
          </h2>
          <p className="text-[11px] text-muted-foreground">
            <Trans>
              {activePile.length} card{activePile.length === 1 ? "" : "s"}
            </Trans>
          </p>
        </div>
        {activeWinston.awaitingHuman && (
          <div className="flex gap-2">
            <Button onClick={onTake} disabled={activePileEmpty} size="sm">
              <Trans>Take pile</Trans>
            </Button>
            <Button variant="outline" onClick={onPass} size="sm">
              <Trans>Pass</Trans>
            </Button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {activePile.length === 0 ? (
          <div className="flex h-full min-h-48 items-center justify-center text-sm text-muted-foreground">
            <Trans>This pile is empty.</Trans>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {activePile.map((card, index) => (
              <DraftCardTile
                key={`${card.name}:${card.setCode}:${card.cardNumber}:${index}`}
                card={card}
                index={index}
                preview={preview}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
  const inactivePiles = (
    <section className="flex min-h-0 flex-col rounded-md border border-border/70 bg-card/20 p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Trans>Other piles</Trans>
      </h2>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
        {activeWinston.piles.map((pile, index) =>
          index === activeIdx ? null : (
            <div key={index} className="rounded border border-border/40 bg-card/40 p-2">
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                <Trans>
                  Pile {index + 1} · {pile.length}
                </Trans>
              </div>
              <FaceDownStack count={pile.length} compact />
            </div>
          ),
        )}
      </div>
    </section>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <LimitedWorkspaceTabs value={mobileTab} onChange={setMobileTab} packLabel="Piles" />

      <div className="hidden min-h-0 flex-1 grid-cols-[minmax(0,1fr)_180px_340px] gap-3 overflow-hidden lg:grid">
        {activePilePanel}
        {inactivePiles}
        <aside className="flex min-h-0 flex-col gap-3">
          <LimitedHoverPreviewPane preview={preview} />
          <DraftPoolPanel
            cards={activeWinston.pickedPile}
            preview={preview}
            onBuild={canBuild ? onJumpToBuild : undefined}
          />
        </aside>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden lg:hidden">
        <div className={cn("flex h-full flex-col gap-3", mobileTab !== "pack" && "hidden")}>
          {activePilePanel}
          {inactivePiles}
        </div>
        <div className={cn("flex h-full", mobileTab !== "picks" && "hidden")}>
          <DraftPoolPanel
            cards={activeWinston.pickedPile}
            preview={preview}
            onBuild={canBuild ? onJumpToBuild : undefined}
          />
        </div>
        <div className={cn("h-full", mobileTab !== "preview" && "hidden")}>
          <LimitedHoverPreviewPane preview={preview} className="h-full" />
        </div>
      </div>
    </div>
  );
}
function FaceDownStack({ count, compact = false }: { count: number; compact?: boolean }) {
  if (count === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        <Trans>(empty)</Trans>
      </p>
    );
  }
  return (
    <div className={cn("relative aspect-[5/7] w-full", compact && "mx-auto max-w-24")}>
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
