import { ArrowRight, Boxes, FlaskConical, LibraryBig, Swords, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { BreweryBackdrop } from "@/components/BreweryBackdrop";
import { PlayDeckShelf } from "@/components/play/PlayDeckShelf";
import { PlayHomeLinks } from "@/components/play/PlayHomeLinks";
import { QuickPlayHero } from "@/components/play/QuickPlayHero";
import { RejoinMatchCard } from "@/components/play/RejoinMatchCard";
import { PLAY_ACTION_CARD_CLASS } from "@/components/play/play.styles";
import { isFeatureEnabled } from "@/featureFlags";
import { useQuickPlay } from "@/hooks/useQuickPlay";
import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useServerStore } from "@/stores/useServerStore";

const MODE_CLASS = cn(
  PLAY_ACTION_CARD_CLASS,
  "relative min-h-40 overflow-hidden p-5 sm:min-h-48 sm:p-6 lg:min-h-52",
);

export function PlayHome() {
  const { quickPlay, quickPlayStarter, quickPlayPreset, pendingDeckId } = useQuickPlay();
  const connected = useServerStore((state) => state.connected);
  const rooms = useServerStore((state) => state.rooms);
  const players = useServerStore((state) => state.players);
  const openTables = rooms.filter((room) => room.status === "Lobby").length;
  const lobbyTeaser =
    connected && (openTables > 0 || players.length > 0)
      ? `${openTables} ${openTables === 1 ? "table" : "tables"} open · ${players.length} online`
      : null;

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <BreweryBackdrop />
      <div className="relative z-10 h-full overflow-y-auto">
        <div className="flex min-h-full w-full flex-col gap-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-10 lg:px-8">
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

          <div className="flex flex-col gap-4 motion-safe:animate-onboard-fade-up sm:gap-5">
            <RejoinMatchCard />
            <QuickPlayHero
              quickPlay={quickPlay}
              quickPlayStarter={quickPlayStarter}
              pendingDeckId={pendingDeckId}
            />

            <section className="grid gap-4 md:grid-cols-3">
              <Link to={ROUTES.PLAY_OFFLINE_CONSTRUCTED} className={MODE_CLASS}>
                <span className="flex h-11 w-11 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
                  <Swords className="h-5 w-5" />
                </span>
                <span>
                  <span className="flex min-w-0 items-center justify-between gap-2 font-serif text-2xl font-light">
                    Constructed
                    <ArrowRight className="h-5 w-5 shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-1" />
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    Pick a deck and battle the AI.
                  </span>
                </span>
              </Link>

              <Link to={ROUTES.LIMITED} className={MODE_CLASS}>
                <span className="flex h-11 w-11 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
                  <Boxes className="h-5 w-5" />
                </span>
                <span>
                  <span className="flex min-w-0 items-center justify-between gap-2 font-serif text-2xl font-light">
                    Draft &amp; Sealed
                    <ArrowRight className="h-5 w-5 shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-1" />
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    Draft, sealed, Winston, and cube.
                  </span>
                </span>
              </Link>

              <Link to={ROUTES.LOBBY} className={MODE_CLASS}>
                <span className="flex h-11 w-11 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
                  <Users className="h-5 w-5" />
                </span>
                <span>
                  <span className="flex min-w-0 items-center justify-between gap-2 font-serif text-2xl font-light">
                    Multiplayer
                    <ArrowRight className="h-5 w-5 shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-1" />
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    Find a table or set up a game for your group.
                  </span>
                  {lobbyTeaser && (
                    <span className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-primary">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                      </span>
                      {lobbyTeaser}
                    </span>
                  )}
                </span>
              </Link>
            </section>
          </div>

          <div className="motion-safe:animate-onboard-fade-up" style={{ animationDelay: "80ms" }}>
            <PlayDeckShelf
              onQuickPlay={quickPlay}
              onQuickPlayPreset={quickPlayPreset}
              pendingDeckId={pendingDeckId}
            />
          </div>

          <div className="motion-safe:animate-onboard-fade-up" style={{ animationDelay: "140ms" }}>
            {isFeatureEnabled("deckHub") ? (
              <Link
                to={ROUTES.HUB}
                className="group flex min-w-0 items-start justify-between gap-3 rounded-xl border border-primary/30 bg-primary/10 p-5 backdrop-blur-md hover:border-primary/60 motion-safe:transition-colors motion-reduce:transition-none sm:items-center sm:gap-4"
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
              <section className="flex min-w-0 items-start justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 p-5 backdrop-blur-md sm:items-center sm:gap-4">
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
          </div>

          <div
            className="mt-auto flex flex-col gap-6 motion-safe:animate-onboard-fade-up sm:gap-8"
            style={{ animationDelay: "200ms" }}
          >
            <PlayHomeLinks />
          </div>
        </div>
      </div>
    </div>
  );
}
