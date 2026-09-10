import { ArrowLeft, Bot, Loader2, Pencil, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { DeckCoverImage } from "@/components/deck/deckCover";
import { resolveCoverCard } from "@/components/deck/deckCover.utils";
import { FormatBadge } from "@/components/game/FormatBadge";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";
import { getFormat } from "@/lib/formats";
import { useOwnedDecks } from "@/hooks/useOwnedDecks";
import { useAccountDecks } from "@/hooks/useAccountDecks";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
interface DeckPlayActionsProps {
  savedDeckId: string;
}
export function DeckPlayActions({ savedDeckId }: DeckPlayActionsProps) {
  const savedDeck = useOwnedDecks().find((entry) => entry.id === savedDeckId);
  const { resolved: accountDecksResolved } = useAccountDecks();
  if (!savedDeck && !accountDecksResolved) {
    return (
      <div
        className="flex h-full items-center justify-center"
        aria-label={i18n._(msg`Loading deck`)}
      >
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!savedDeck) {
    return (
      <div className="relative h-full min-h-0 overflow-hidden">
        <div className="relative z-10 flex h-full items-center justify-center overflow-y-auto px-4 py-4">
          <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card/90 p-6 text-center shadow-xl backdrop-blur-md">
            <h2 className="font-serif text-3xl font-light">
              <Trans>Deck not found</Trans>
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              <Trans>This saved deck may have been renamed or removed.</Trans>
            </p>
            <Button asChild variant="outline" className="mt-5">
              <Link to={ROUTES.PLAY}>
                <Trans>
                  <ArrowLeft className="h-4 w-4" />
                  Back to Play
                </Trans>
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }
  const deck = savedDeck.deck;
  const formatId = deck.format ?? "standard";
  const format = getFormat(formatId);
  const cover = resolveCoverCard(deck);
  const cardCount = deck.cards.length + (deck.commanders?.length ?? 0);
  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <div className="relative z-10 h-full overflow-y-auto">
        <div className="flex min-h-full w-full flex-col px-4 py-5 sm:px-6 sm:py-9 lg:px-8">
          <section className="group grid min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-2xl backdrop-blur-md lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
            <div className="relative min-h-56 overflow-hidden bg-muted sm:min-h-80 lg:min-h-[30rem]">
              <DeckCoverImage
                cover={cover}
                alt={cover?.identity.name ?? deck.name}
                className="motion-reduce:transform-none motion-reduce:transition-none"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent lg:bg-gradient-to-r lg:from-transparent lg:via-background/10 lg:to-background/70" />
            </div>

            <div className="flex min-w-0 flex-col justify-center p-5 sm:p-8 lg:p-10">
              <div className="flex flex-wrap items-center gap-2">
                <FormatBadge formatId={formatId} />
                <span className="text-xs text-muted-foreground">
                  <Trans>{cardCount} cards</Trans>
                </span>
              </div>
              <h2 className="mt-3 break-words font-serif text-4xl font-light leading-none tracking-tight sm:text-5xl">
                {deck.name}
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
                {format?.description ??
                  i18n._(msg`${format?.name ?? formatId} deck ready for play.`)}
              </p>

              <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <Button size="lg" asChild className="w-full justify-start">
                  <Link
                    to={ROUTES.PLAY_OFFLINE_CONSTRUCTED}
                    state={{ preSelectedDeckId: savedDeck.id }}
                  >
                    <Trans>
                      <Bot className="h-5 w-5" />
                      Play Offline
                    </Trans>
                  </Link>
                </Button>
                <Button size="lg" variant="secondary" asChild className="w-full justify-start">
                  <Link to={ROUTES.LOBBY} state={{ preferredSavedDeckId: savedDeck.id }}>
                    <Trans>
                      <Users className="h-5 w-5" />
                      Multiplayer
                    </Trans>
                  </Link>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  asChild
                  className="w-full justify-start sm:col-span-2 lg:col-span-1 xl:col-span-2"
                >
                  <Link
                    to={{
                      pathname: ROUTES.DECK_EDITOR,
                      search: `?deck=${encodeURIComponent(savedDeck.id)}`,
                    }}
                    state={{ deckEditorFromList: true }}
                  >
                    <Trans>
                      <Pencil className="h-5 w-5" />
                      Edit Deck
                    </Trans>
                  </Link>
                </Button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
