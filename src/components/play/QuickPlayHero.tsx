import { Bot, Users, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { DeckCoverImage } from "@/components/deck/deckCover";
import { resolveCoverCard } from "@/components/deck/deckCover.utils";
import { FormatBadge } from "@/components/game/FormatBadge";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";
import { useDeckStore } from "@/stores/useDeckStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

interface QuickPlayHeroProps {
  onQuickPlay: (savedDeckId: string) => void;
}

export function QuickPlayHero({ onQuickPlay }: QuickPlayHeroProps) {
  const lastPlayedDeckId = usePreferencesStore((state) => state.lastPlayedDeckId);
  const savedDecks = useDeckStore((state) => state.savedDecks);
  const playable = savedDecks.filter(
    (savedDeck) =>
      !savedDeck.deck.draft &&
      savedDeck.deck.format !== "draft" &&
      savedDeck.deck.format !== "sealed",
  );
  const hero =
    playable.find((entry) => entry.id === lastPlayedDeckId) ??
    [...playable].sort((a, b) => b.savedAt - a.savedAt)[0];
  if (!hero) return null;

  const deck = hero.deck;
  const formatId = deck.format ?? "standard";
  const cover = resolveCoverCard(deck);
  const cardCount = deck.cards.length + (deck.commanders?.length ?? 0);

  return (
    <section className="grid min-w-0 overflow-hidden rounded-2xl border border-primary/30 bg-card/90 shadow-2xl backdrop-blur-md sm:grid-cols-[10rem_minmax(0,1fr)]">
      <div className="relative hidden min-h-40 bg-muted sm:block">
        <DeckCoverImage cover={cover} alt={cover?.identity.name ?? deck.name} />
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-background/10 to-background/70" />
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-4 p-5 sm:p-6">
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
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="lg" className="gap-1.5" onClick={() => onQuickPlay(hero.id)}>
            <Bot className="h-5 w-5" />
            Play vs AI
          </Button>
          <Button size="lg" variant="secondary" asChild className="gap-1.5">
            <Link to={ROUTES.LOBBY} state={{ preferredSavedDeckId: hero.id }}>
              <Users className="h-5 w-5" />
              Multiplayer
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
