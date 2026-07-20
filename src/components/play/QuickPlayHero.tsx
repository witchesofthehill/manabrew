import { Bot, Cloud, Cpu, Loader2, Plus, SlidersHorizontal, Swords, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { DeckCoverImage } from "@/components/deck/deckCover";
import { resolveCoverCard } from "@/components/deck/deckCover.utils";
import { FormatBadge } from "@/components/game/FormatBadge";
import { Button } from "@/components/ui/button";
import { isHostedEngineAvailable } from "@/config/webRuntimeConfig";
import { STARTER_DECK_ID } from "@/hooks/useQuickPlay";
import { ROUTES } from "@/lib/constants";
import { getPlatform } from "@/platform";
import { useDeckStore } from "@/stores/useDeckStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { usePresetDecks } from "@/stores/usePresetDecksStore";

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
      <section className="relative min-w-0 overflow-hidden rounded-2xl border border-primary/30 bg-card/90 shadow-2xl backdrop-blur-md">
        <div className="flex min-w-0 flex-col gap-4 p-5 sm:p-7">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              <Zap className="h-3.5 w-3.5" />
              New to the Brewery?
            </p>
            <h2 className="mt-2 font-serif text-2xl font-light leading-tight tracking-tight sm:text-3xl">
              Your first game is one click away
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Battle the AI with a ready-made starter deck, or import a deck you already play.
            </p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              Runs on {engineBadge}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
  const cover = resolveCoverCard(deck);
  const cardCount = deck.cards.length + (deck.commanders?.length ?? 0);

  let opponentLabel = "vs a random AI deck";
  if (lastAiOpponent?.kind === "preset") {
    const preset = presets.find(
      (entry) =>
        (entry.id ?? entry.name) === lastAiOpponent.id && (entry.format ?? "standard") === formatId,
    );
    if (preset) opponentLabel = `vs ${preset.name}`;
  } else if (lastAiOpponent?.kind === "saved") {
    const saved = savedDecks.find((entry) => entry.id === lastAiOpponent.id);
    if (saved && (saved.deck.format ?? "standard") === formatId) {
      opponentLabel = `vs ${saved.deck.name}`;
    }
  }

  const pending = pendingDeckId === heroById.id;

  return (
    <section className="relative min-w-0 overflow-hidden rounded-2xl border border-primary/30 bg-card/90 shadow-2xl backdrop-blur-md">
      <div className="absolute inset-0" aria-hidden="true">
        <DeckCoverImage cover={cover} alt="" className="opacity-35" />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/40" />
      </div>
      <div className="relative flex min-w-0 flex-col gap-4 p-5 sm:p-7">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            <Zap className="h-3.5 w-3.5" />
            Quick Play
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 break-words font-serif text-2xl font-light leading-tight tracking-tight sm:text-3xl">
              {deck.name}
            </h2>
            <FormatBadge formatId={formatId} />
            <span className="text-xs text-muted-foreground">{cardCount} cards</span>
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
            {engineBadge}
            <span>· {opponentLabel}</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              onClick={() =>
                navigate(ROUTES.PLAY_OFFLINE_CONSTRUCTED, {
                  state: { preSelectedDeckId: heroById.id },
                })
              }
            >
              <SlidersHorizontal className="h-3 w-3" />
              Customize
            </button>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="lg"
            className="gap-1.5"
            disabled={pendingDeckId !== null}
            onClick={() => quickPlay(heroById.id)}
          >
            {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Bot className="h-5 w-5" />}
            {pending ? "Starting…" : "Play vs AI"}
          </Button>
        </div>
      </div>
    </section>
  );
}
