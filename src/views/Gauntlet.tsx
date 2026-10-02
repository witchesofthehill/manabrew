import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useTopBarOverride } from "@/components/layout/TopBarOverride";
import LimitedDeckBuilder from "@/components/limited/LimitedDeckBuilder";
import { LimitedTableSurface } from "@/components/limited/LimitedTableSurface";
import { useGameStore } from "@/stores/useGameStore";
import { useLimitedStore } from "@/stores/useLimitedStore";
import { ROUTES } from "@/lib/constants";
import {
  advanceGauntletProgress,
  arm as armGauntletReturn,
  clear as clearGauntletReturn,
  gauntletProgress,
  gauntletScore,
} from "@/lib/gauntletReturn";
import { resolveDeckCards } from "@/lib/limited.utils";
import type { DraftCard, GauntletMatchDecks } from "@/types/limited";
import type { Deck, DeckFormat } from "@/protocol/deck";

async function buildGauntletDeck(
  name: string,
  main: DraftCard[],
  sideboard: DraftCard[],
  format: DeckFormat,
): Promise<Deck> {
  const [cards, resolvedSideboard] = await Promise.all([
    resolveDeckCards(main),
    resolveDeckCards(sideboard),
  ]);
  return { name, format, cards, sideboard: resolvedSideboard };
}

export default function Gauntlet() {
  const { gauntletId } = useParams<{ gauntletId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const activeGauntlet = useLimitedStore((state) => state.activeGauntlet);
  const refresh = useLimitedStore((state) => state.refreshGauntletState);
  const advanceRound = useLimitedStore((state) => state.advanceGauntletRound);
  const fetchMatchDecks = useLimitedStore((state) => state.fetchGauntletMatchDecks);
  const updateHumanDeck = useLimitedStore((state) => state.updateGauntletHumanDeck);
  const lastError = useLimitedStore((state) => state.lastError);
  const startGame = useGameStore((state) => state.startGame);
  const [loadedDecks, setLoadedDecks] = useState<{
    gauntletId: string;
    decks: GauntletMatchDecks;
  } | null>(null);
  const matchDecks =
    loadedDecks && loadedDecks.gauntletId === gauntletId ? loadedDecks.decks : null;
  const [builtDeck, setBuiltDeck] = useState<{
    gauntletId: string;
    main: DraftCard[];
    sideboard: DraftCard[];
  } | null>(null);
  const [launching, setLaunching] = useState(false);
  const launched = useRef<string | null>(null);
  const launchPending = useRef(false);
  const gauntlet = activeGauntlet?.gauntletId === gauntletId ? activeGauntlet : null;
  const currentRound = gauntlet?.currentRound;

  useTopBarOverride({
    onBack: () => navigate(ROUTES.PLAY_OFFLINE_LIMITED),
    onHome: () => navigate(ROUTES.PLAY),
  });
  useEffect(() => {
    if (gauntletId && !gauntlet) void refresh(gauntletId);
  }, [gauntletId, gauntlet, refresh]);
  useEffect(() => {
    if (!gauntletId || currentRound === undefined) return;
    let active = true;
    void fetchMatchDecks(gauntletId).then(
      (decks) => {
        if (active) setLoadedDecks({ gauntletId, decks });
      },
      (error: unknown) => {
        if (active) toast.error(`Failed to load pool: ${String(error)}`);
      },
    );
    return () => {
      active = false;
    };
  }, [gauntletId, currentRound, fetchMatchDecks]);

  const play = useCallback(async () => {
    if (
      !gauntlet ||
      !builtDeck ||
      builtDeck.gauntletId !== gauntlet.gauntletId ||
      builtDeck.main.length < 40 ||
      launchPending.current
    )
      return;
    launchPending.current = true;
    setLaunching(true);
    try {
      await updateHumanDeck(gauntlet.gauntletId, builtDeck.main, builtDeck.sideboard);
      const decks = await fetchMatchDecks(gauntlet.gauntletId);
      const format = gauntlet.kind === "sealed" ? "sealed" : "draft";
      const [human, opponent] = await Promise.all([
        buildGauntletDeck(decks.humanDeckName, decks.humanMain, decks.humanSideboard, format),
        buildGauntletDeck(
          gauntlet.currentOpponent?.deckName ?? "Draft opponent",
          decks.opponentMain,
          decks.opponentSideboard,
          format,
        ),
      ]);
      armGauntletReturn(gauntlet);
      const started = startGame(human, format, undefined, [opponent], "Forge");
      navigate(ROUTES.PLAY, { state: { exitTo: `/gauntlet/${gauntlet.gauntletId}` } });
      if (!(await started)) {
        clearGauntletReturn();
        navigate(`/gauntlet/${gauntlet.gauntletId}`, { replace: true });
      }
    } catch (error) {
      clearGauntletReturn();
      toast.error(`Failed to launch game: ${String(error)}`);
    } finally {
      launchPending.current = false;
      setLaunching(false);
    }
  }, [gauntlet, builtDeck, updateHumanDeck, fetchMatchDecks, startGame, navigate]);

  useEffect(() => {
    if (
      !(location.state as { launch?: boolean } | null)?.launch ||
      !builtDeck ||
      builtDeck.gauntletId !== gauntletId ||
      launched.current === gauntletId
    )
      return;
    launched.current = gauntletId ?? null;
    navigate(location.pathname, { replace: true, state: null });
    void play();
  }, [location.state, location.pathname, builtDeck, gauntletId, navigate, play]);

  const advance = async () => {
    if (!gauntletId || launching) return;
    setLaunching(true);
    try {
      const state = await advanceRound(gauntletId);
      advanceGauntletProgress(state);
    } catch (error) {
      toast.error(`Failed to advance round: ${String(error)}`);
    } finally {
      setLaunching(false);
    }
  };

  if (!gauntlet) {
    return (
      <LimitedTableSurface className="items-center justify-center text-muted-foreground">
        {lastError ?? "Loading Limited session…"}
      </LimitedTableSurface>
    );
  }
  const progress = gauntletProgress(gauntlet);
  const score = gauntletScore(gauntlet);
  return (
    <LimitedTableSurface className="gap-2 px-4 py-3 sm:px-6 lg:px-8">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2">
        <div>
          <p className="text-sm font-semibold">
            Round {gauntlet.currentRound} of {gauntlet.rounds} · {score.wins}–{score.losses} · Best
            of {progress.bestOf}
          </p>
          <p className="text-xs text-muted-foreground">
            {gauntlet.completed
              ? "Session complete. Your pool and builds remain available."
              : score.matchOver
                ? "Match won. Adjust your build before the next opponent."
                : `Against ${gauntlet.currentOpponent?.deckName ?? "AI"}. Edit your deck between games.`}
          </p>
        </div>
        {!gauntlet.completed &&
          (score.matchOver ? (
            <Button variant="primary" onClick={() => void advance()} disabled={launching}>
              Next round
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => void play()}
              disabled={
                launching ||
                !builtDeck ||
                builtDeck.gauntletId !== gauntletId ||
                builtDeck.main.length < 40
              }
            >
              {launching
                ? "Launching…"
                : score.wins + score.losses > 0
                  ? "Play next game"
                  : "Play game"}
            </Button>
          ))}
      </header>
      <div className="min-h-0 flex-1">
        {matchDecks ? (
          <LimitedDeckBuilder
            key={progress.sessionKey}
            sessionKey={progress.sessionKey}
            pool={[...matchDecks.humanMain, ...matchDecks.humanSideboard]}
            initialMain={matchDecks.humanMain}
            initialSideboard={matchDecks.humanSideboard}
            defaultDeckName={matchDecks.humanDeckName}
            format={gauntlet.kind === "sealed" ? "sealed" : "draft"}
            onChange={(deck) => setBuiltDeck({ gauntletId: gauntlet.gauntletId, ...deck })}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Loading card pool…</p>
        )}
      </div>
      {lastError && (
        <p className="shrink-0 text-sm text-destructive" role="alert">
          {lastError}
        </p>
      )}
    </LimitedTableSurface>
  );
}
