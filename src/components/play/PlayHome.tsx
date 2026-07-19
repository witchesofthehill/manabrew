import { ArrowRight, FlaskConical, LibraryBig, Swords, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { BreweryBackdrop } from "@/components/BreweryBackdrop";
import { PlayDeckShelf } from "@/components/play/PlayDeckShelf";
import { PlayHomeLinks } from "@/components/play/PlayHomeLinks";
import { QuickPlayHero } from "@/components/play/QuickPlayHero";
import { PLAY_ACTION_CARD_CLASS } from "@/components/play/play.styles";
import { isFeatureEnabled } from "@/featureFlags";
import { useQuickPlay } from "@/hooks/useQuickPlay";
import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";

const MODE_CLASS = cn(
  PLAY_ACTION_CARD_CLASS,
  "relative min-h-36 overflow-hidden p-4 sm:min-h-44 sm:p-6 lg:min-h-48 lg:p-7",
);

export function PlayHome() {
  const quickPlay = useQuickPlay();

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <BreweryBackdrop />
      <div className="relative z-10 h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:gap-6 sm:px-6 sm:py-10 lg:px-10">
          <header className="max-w-2xl sm:pt-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-primary">
              <FlaskConical className="h-4 w-4" />
              The Brewery
            </div>
            <h1 className="font-serif text-3xl font-light tracking-[0.04em] text-foreground sm:text-5xl lg:text-6xl">
              Choose your table
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              Bring a deck to the forge, challenge the house, or gather your party online.
            </p>
          </header>

          <QuickPlayHero onQuickPlay={quickPlay} />

          <section className="grid gap-4 md:grid-cols-2">
            <Link to={ROUTES.PLAY_OFFLINE} className={MODE_CLASS}>
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
                <Swords className="h-5 w-5" />
              </span>
              <span>
                <span className="flex min-w-0 items-center justify-between gap-2 font-serif text-2xl font-light sm:text-3xl">
                  Offline Play
                  <ArrowRight className="h-5 w-5 shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-1" />
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Choose your format and face an AI deck.
                </span>
              </span>
            </Link>

            <Link to={ROUTES.LOBBY} className={MODE_CLASS}>
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
                <Users className="h-5 w-5" />
              </span>
              <span>
                <span className="flex min-w-0 items-center justify-between gap-2 font-serif text-2xl font-light sm:text-3xl">
                  Multiplayer
                  <ArrowRight className="h-5 w-5 shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-1" />
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Find a table or set up a game for your group.
                </span>
              </span>
            </Link>
          </section>

          <PlayDeckShelf onQuickPlay={quickPlay} />

          {isFeatureEnabled("deckHub") ? (
            <Link
              to={ROUTES.HUB}
              className="group flex min-w-0 items-start justify-between gap-3 rounded-xl border border-primary/30 bg-primary/10 p-4 backdrop-blur-md hover:border-primary/60 motion-safe:transition-colors motion-reduce:transition-none sm:items-center sm:gap-4 sm:p-5"
            >
              <span className="flex min-w-0 items-center gap-3 sm:gap-4">
                <LibraryBig className="h-6 w-6 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block font-medium">Discover decks from the community</span>
                  <span className="text-sm text-muted-foreground">Browse the Deck Hub.</span>
                </span>
              </span>
              <ArrowRight className="mt-0.5 h-5 w-5 shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-1 sm:mt-0" />
            </Link>
          ) : (
            <section className="flex min-w-0 items-start justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 backdrop-blur-md sm:items-center sm:gap-4 sm:p-5">
              <span className="flex min-w-0 items-center gap-3 sm:gap-4">
                <LibraryBig className="h-6 w-6 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    Deck Hub
                    <span className="rounded border border-primary/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                      Coming soon
                    </span>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    Discover, share, and play decks brewed by the community.
                  </span>
                </span>
              </span>
            </section>
          )}

          <PlayHomeLinks />
        </div>
      </div>
    </div>
  );
}
