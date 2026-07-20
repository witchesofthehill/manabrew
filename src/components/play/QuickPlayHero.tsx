import { Cloud, Cpu, Loader2, Plus, Shuffle, SlidersHorizontal, Swords, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { DeckGridCard } from "@/components/deck/DeckGridCard";
import { Button } from "@/components/ui/button";
import { isHostedEngineAvailable } from "@/config/webRuntimeConfig";
import { STARTER_DECK_ID } from "@/hooks/useQuickPlay";
import { ROUTES } from "@/lib/constants";
import { getPlatform } from "@/platform";
import { useDeckStore } from "@/stores/useDeckStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import type { Deck } from "@/protocol/deck";

const SECTION_CLASS =
  "min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-background/80 p-5 shadow-xl backdrop-blur-md sm:p-6";

interface QuickPlayHeroProps {
  quickPlay: (savedDeckId: string) => void;
  quickPlayStarter: () => void;
  pendingDeckId: string | null;
}

export function QuickPlayHero({ quickPlay, quickPlayStarter, pendingDeckId }: QuickPlayHeroProps) {
  const navigate = useNavigate();
  const lastPlayedDeckId = usePreferencesStore((state) => state.lastPlayedDeckId);
  const lastPlayedAtByDeck = usePreferencesStore((state) => state.lastPlayedAtByDeck);
  const lastAiOpponent = usePreferencesStore((state) => state.lastAiOpponent);
  const lastOfflineEngine = usePreferencesStore((state) => state.lastOfflineEngine);
  const savedDecks = useDeckStore((state) => state.savedDecks);
  const presets = usePresetDecks();

  const playable = savedDecks.filter(
    (savedDeck) =>
      !savedDeck.deck.draft &&
      savedDeck.deck.format !== "draft" &&
      savedDeck.deck.format !== "sealed",
  );
  const hero = [...playable].sort(
    (a, b) => (lastPlayedAtByDeck[b.id] ?? b.savedAt) - (lastPlayedAtByDeck[a.id] ?? a.savedAt),
  )[0];
  const heroById = playable.find((entry) => entry.id === lastPlayedDeckId) ?? hero;

  const engineLabel =
    getPlatform().type === "tauri"
      ? "Forge"
      : (lastOfflineEngine ?? (isHostedEngineAvailable() ? "Forge" : "Manabrew"));
  const engineBadge = (
    <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/60 px-1.5 py-0.5 text-[11px] font-medium text-foreground/80">
      {engineLabel === "Forge" ? (
        <Cloud aria-hidden="true" className="h-3 w-3" />
      ) : (
        <Cpu aria-hidden="true" className="h-3 w-3" />
      )}
      {engineLabel}
    </span>
  );

  if (!heroById) {
    return (
      <section className={SECTION_CLASS}>
        <div className="mb-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            <Zap className="h-3.5 w-3.5" />
            New to the Brewery?
          </p>
          <h2 className="mt-1 font-serif text-2xl font-light tracking-tight sm:text-3xl">
            Your first game is one click away
          </h2>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">
              Battle the AI with a ready-made starter deck, or import a deck you already play.
            </p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              Runs on {engineBadge}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              size="lg"
              className="gap-1.5"
              disabled={pendingDeckId !== null}
              onClick={quickPlayStarter}
            >
              {pendingDeckId === STARTER_DECK_ID ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Swords className="h-5 w-5" />
              )}
              {pendingDeckId === STARTER_DECK_ID ? "Starting…" : "Play a starter deck vs AI"}
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="gap-1.5"
              onClick={() => navigate(ROUTES.DECK_EDITOR, { state: { openNewDeckDialog: true } })}
            >
              <Plus className="h-5 w-5" />
              Build / Import
            </Button>
          </div>
        </div>
      </section>
    );
  }
  const deck = heroById.deck;
  const formatId = deck.format ?? "standard";

  let opponentDeck: Deck | null = null;
  let opponentDeckId: string | null = null;
  if (lastAiOpponent?.kind === "preset") {
    const preset = presets.find(
      (entry) =>
        (entry.id ?? entry.name) === lastAiOpponent.id && (entry.format ?? "standard") === formatId,
    );
    opponentDeck = preset ?? null;
    opponentDeckId = preset ? (preset.id ?? preset.name) : null;
  } else if (lastAiOpponent?.kind === "saved") {
    const saved = savedDecks.find((entry) => entry.id === lastAiOpponent.id);
    if (saved && (saved.deck.format ?? "standard") === formatId) {
      opponentDeck = saved.deck;
      opponentDeckId = saved.id;
    }
  }

  const pending = pendingDeckId === heroById.id;

  function openMatchup() {
    navigate(ROUTES.PLAY_OFFLINE_CONSTRUCTED, { state: { preSelectedDeckId: heroById!.id } });
  }

  return (
    <section className={SECTION_CLASS}>
      <div className="mb-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          <Zap className="h-3.5 w-3.5" />
          Quick Play
        </p>
        <h2 className="mt-1 font-serif text-2xl font-light tracking-tight sm:text-3xl">
          Jump back in
        </h2>
      </div>

      <div className="flex items-center justify-center gap-4 sm:gap-10">
        <div className="w-32 shrink-0 sm:w-44">
          <DeckGridCard
            deck={heroById}
            onOpen={() => navigate(`${ROUTES.PLAY_DECK}/${encodeURIComponent(heroById.id)}`)}
            readOnly
          />
        </div>

        <div className="flex min-w-0 flex-col items-center gap-2.5 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/40 bg-primary/15 text-primary">
            <Swords aria-hidden="true" className="h-5 w-5" />
          </span>
          <Button
            size="lg"
            className="gap-1.5"
            disabled={pendingDeckId !== null}
            onClick={() => quickPlay(heroById.id)}
          >
            {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5" />}
            {pending ? "Starting…" : "Quick Play"}
          </Button>
          <p className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            {engineBadge}
            <button
              type="button"
              className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              onClick={openMatchup}
            >
              <SlidersHorizontal className="h-3 w-3" />
              Change matchup
            </button>
          </p>
        </div>

        <div className="w-32 shrink-0 sm:w-44">
          {opponentDeck && opponentDeckId ? (
            <DeckGridCard
              deck={{ id: opponentDeckId, deck: opponentDeck, savedAt: 0 }}
              onOpen={openMatchup}
              readOnly
            />
          ) : (
            <button
              type="button"
              onClick={openMatchup}
              className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/70 bg-muted/30 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              <Shuffle aria-hidden="true" className="h-5 w-5" />
              <span className="text-xs font-medium">Random AI deck</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
