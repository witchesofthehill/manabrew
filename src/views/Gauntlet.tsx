import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useTopBarOverride } from "@/components/layout/TopBarOverride";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import LimitedDeckBuilder from "@/components/limited/LimitedDeckBuilder";
import { useGameStore } from "@/stores/useGameStore";
import { useLimitedStore } from "@/stores/useLimitedStore";
import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { arm as armGauntletReturn, clear as clearGauntletReturn } from "@/lib/gauntletReturn";
import type { DraftCard, GauntletMatchDecks } from "@/types/limited";
import { resolveDeckCards } from "@/lib/limited.utils";
import type { Deck, DeckFormat } from "@/protocol/deck";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
async function buildGauntletDeck(
  name: string,
  main: DraftCard[],
  sideboard: DraftCard[],
  format: DeckFormat,
): Promise<Deck> {
  const [resolvedMain, resolvedSide] = await Promise.all([
    resolveDeckCards(main),
    resolveDeckCards(sideboard),
  ]);
  return {
    name,
    format,
    cards: resolvedMain,
    sideboard: resolvedSide,
  };
}
export default function Gauntlet() {
  const { gauntletId } = useParams<{
    gauntletId: string;
  }>();
  const navigate = useNavigate();
  const activeGauntlet = useLimitedStore((s) => s.activeGauntlet);
  const refresh = useLimitedStore((s) => s.refreshGauntletState);
  const recordOutcome = useLimitedStore((s) => s.recordGauntletOutcome);
  const advanceRound = useLimitedStore((s) => s.advanceGauntletRound);
  const fetchMatchDecks = useLimitedStore((s) => s.fetchGauntletMatchDecks);
  const updateHumanDeck = useLimitedStore((s) => s.updateGauntletHumanDeck);
  const lastError = useLimitedStore((s) => s.lastError);
  const startGame = useGameStore((s) => s.startGame);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [launchingMatch, setLaunchingMatch] = useState(false);
  const [sideboardOpen, setSideboardOpen] = useState(false);
  const [matchDecks, setMatchDecks] = useState<GauntletMatchDecks | null>(null);
  useTopBarOverride({
    onBack: () => navigate(ROUTES.PLAY_OFFLINE_LIMITED),
    onHome: () => navigate(ROUTES.PLAY),
  });
  useEffect(() => {
    if (!gauntletId) return;
    if (!activeGauntlet || activeGauntlet.gauntletId !== gauntletId) {
      refresh(gauntletId);
    }
  }, [gauntletId, activeGauntlet, refresh]);
  if (!activeGauntlet) {
    return (
      <div className="flex h-full items-center justify-center">
        {lastError ? (
          <p className="text-destructive">{lastError}</p>
        ) : (
          <p className="text-muted-foreground">
            <Trans>Loading gauntlet…</Trans>
          </p>
        )}
      </div>
    );
  }
  const handleManualOutcome = async (won: boolean) => {
    if (!gauntletId) return;
    try {
      const out = await recordOutcome(gauntletId, won, true, won);
      setPendingMessage(outcomeMessage(out.outcome, out.nextRoundIndex));
    } catch {
      /* surfaced via lastError */
    }
  };
  const handleAdvance = async () => {
    if (!gauntletId) return;
    try {
      await advanceRound(gauntletId);
      setPendingMessage(null);
    } catch {
      /* surfaced via lastError */
    }
  };
  const handlePlayMatch = async () => {
    if (!gauntletId || launchingMatch) return;
    setLaunchingMatch(true);
    try {
      const decks = await fetchMatchDecks(gauntletId);
      setMatchDecks(decks);
      const formatId = activeGauntlet.kind === "sealed" ? "sealed" : "draft";
      const [human, opponent] = await Promise.all([
        buildGauntletDeck("Gauntlet Deck", decks.humanMain, decks.humanSideboard, formatId),
        buildGauntletDeck(
          activeGauntlet.currentOpponent?.deckName ?? "Gauntlet Opponent",
          decks.opponentMain,
          decks.opponentSideboard,
          formatId,
        ),
      ]);
      armGauntletReturn(gauntletId, activeGauntlet.currentRound);
      const started = await startGame(human, formatId, undefined, [opponent]);
      if (!started) {
        clearGauntletReturn();
        return;
      }
      navigate(ROUTES.PLAY);
    } catch (err) {
      toast.error(i18n._(msg`Failed to launch match: ${String(err)}`));
    } finally {
      setLaunchingMatch(false);
    }
  };
  const handleOpenSideboard = async () => {
    if (!gauntletId) return;
    try {
      const decks = await fetchMatchDecks(gauntletId);
      setMatchDecks(decks);
      setSideboardOpen(true);
    } catch (err) {
      toast.error(i18n._(msg`Failed to load decks: ${String(err)}`));
    }
  };
  const handleSaveSideboard = async (deck: { main: DraftCard[]; sideboard: DraftCard[] }) => {
    if (!gauntletId) return;
    try {
      await updateHumanDeck(gauntletId, deck.main, deck.sideboard);
      toast.success(i18n._(msg`Sideboard updated.`));
      setSideboardOpen(false);
    } catch (err) {
      toast.error(i18n._(msg`Failed to save sideboard: ${String(err)}`));
    }
  };
  return (
    <div className="flex h-full flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <p className="font-semibold text-foreground">
            <Trans>{activeGauntlet.kind === "sealed" ? "Sealed" : "Draft"} gauntlet</Trans>
          </p>
          <p className="text-muted-foreground">
            <Trans>
              Round {activeGauntlet.currentRound} / {activeGauntlet.rounds} · Wins{" "}
              {activeGauntlet.wins} · Losses {activeGauntlet.losses}{" "}
              {activeGauntlet.completed ? "· Complete" : ""}
            </Trans>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!activeGauntlet.completed && (
            <Button variant="outline" onClick={handleOpenSideboard}>
              <Trans>Sideboard</Trans>
            </Button>
          )}
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[1fr_320px]">
        <section className="overflow-y-auto rounded-md border border-border/70 p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Trans>Current Opponent</Trans>
          </h2>
          {activeGauntlet.currentOpponent ? (
            <div className="space-y-2 text-sm">
              <p className="font-semibold">
                <Trans>
                  Round {activeGauntlet.currentOpponent.round} —{" "}
                  {activeGauntlet.currentOpponent.deckName}
                </Trans>
              </p>
              <p className="text-muted-foreground">
                <Trans>
                  {activeGauntlet.currentOpponent.mainCount} main /{" "}
                  {activeGauntlet.currentOpponent.sideboardCount} sideboard
                </Trans>
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={handlePlayMatch} disabled={launchingMatch}>
                  {launchingMatch ? i18n._(msg`Launching\u2026`) : i18n._(msg`Play Match`)}
                </Button>
                <Button variant="outline" onClick={() => handleManualOutcome(true)}>
                  <Trans>Mark Win</Trans>
                </Button>
                <Button variant="outline" onClick={() => handleManualOutcome(false)}>
                  <Trans>Mark Loss</Trans>
                </Button>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                <Trans>
                  "Play Match" launches the in-app game board with the current decks. Report the
                  outcome here once the match completes.
                </Trans>
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              <Trans>No opponent — gauntlet finished.</Trans>
            </p>
          )}

          {pendingMessage && (
            <div className="mt-4 rounded border border-primary/60 bg-primary/5 p-3 text-sm">
              <p>{pendingMessage}</p>
              {!activeGauntlet.completed && (
                <div className="mt-2 flex gap-2">
                  <Button onClick={handleOpenSideboard} variant="outline">
                    <Trans>Sideboard before next round</Trans>
                  </Button>
                  <Button onClick={handleAdvance}>
                    <Trans>Next Round</Trans>
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-4 overflow-y-auto">
          <section className="rounded-md border border-border/70 p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <Trans>Bracket</Trans>
              </h2>
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300">
                  <Trans>{activeGauntlet.wins}W</Trans>
                </span>
                <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-destructive">
                  <Trans>{activeGauntlet.losses}L</Trans>
                </span>
              </div>
            </div>
            <ul className="space-y-1 text-sm">
              {activeGauntlet.opponents.map((o) => {
                const isCurrent =
                  o.round === activeGauntlet.currentRound && !activeGauntlet.completed;
                const isPast = o.round < activeGauntlet.currentRound;
                const isFuture = o.round > activeGauntlet.currentRound;
                const isLossRound =
                  activeGauntlet.completed &&
                  activeGauntlet.losses > 0 &&
                  o.round === activeGauntlet.currentRound;
                return (
                  <li
                    key={o.round}
                    className={cn(
                      "flex items-center gap-2 rounded px-2 py-1",
                      isCurrent && "bg-primary/10 font-medium",
                      isPast && "text-muted-foreground",
                      isFuture && "opacity-60",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                        isPast && "bg-emerald-500/20 text-emerald-300",
                        isCurrent && "bg-primary/20 text-primary",
                        isLossRound && "bg-destructive/20 text-destructive",
                        isFuture && "bg-muted/40 text-muted-foreground",
                      )}
                      aria-label={
                        isPast
                          ? "Won"
                          : isLossRound
                            ? "Lost"
                            : isCurrent
                              ? "In progress"
                              : "Pending"
                      }
                    >
                      {isPast ? "W" : isLossRound ? "L" : o.round}
                    </span>
                    <span className="flex-1 truncate">{o.deckName}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {o.mainCount}/{o.sideboardCount}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          {lastError && (
            <p className="rounded border border-destructive/70 bg-destructive/10 p-3 text-sm text-destructive">
              {lastError}
            </p>
          )}
        </aside>
      </div>

      <Dialog open={sideboardOpen} onOpenChange={setSideboardOpen}>
        <DialogContent className="max-w-[min(95vw,1400px)] sm:rounded-lg">
          <DialogHeader>
            <DialogTitle>
              <Trans>Sideboard for round {activeGauntlet.currentRound}</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>
                Swap cards between your main deck and sideboard. Saved changes apply to subsequent
                gauntlet matches.
              </Trans>
            </DialogDescription>
          </DialogHeader>
          {matchDecks ? (
            <div className="h-[70dvh] min-h-[400px]">
              <LimitedDeckBuilder
                pool={[...matchDecks.humanMain, ...matchDecks.humanSideboard]}
                initialMain={matchDecks.humanMain}
                initialSideboard={matchDecks.humanSideboard}
                defaultDeckName={matchDecks.humanDeckName}
                format={activeGauntlet.kind === "sealed" ? "sealed" : "draft"}
                requireCompleteToSave
                confirmLabel="Save sideboard"
                onConfirm={handleSaveSideboard}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              <Trans>Loading decks…</Trans>
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSideboardOpen(false)}>
              <Trans>Cancel</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function outcomeMessage(kind: string, nextRound: number | null): string {
  switch (kind) {
    case "matchInProgress":
      return i18n._(msg`Match still in progress \u2014 record the next game.`);
    case "advanceNextRound":
      return i18n._(msg`Match won! Advance to round ${nextRound!}.`);
    case "wonTournament":
      return i18n._(msg`Tournament won \u2014 congrats.`);
    case "lostRound":
      return i18n._(msg`Match lost \u2014 gauntlet over.`);
    default:
      return kind;
  }
}
