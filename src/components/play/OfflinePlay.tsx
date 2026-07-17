import { ArrowLeft, ArrowRight, Boxes, Swords } from "lucide-react";
import { Link } from "react-router-dom";
import { BreweryBackdrop } from "@/components/BreweryBackdrop";
import { PLAY_ACTION_CARD_CLASS } from "@/components/play/play.styles";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";

const MODE_CLASS = cn(PLAY_ACTION_CARD_CLASS, "min-h-44 p-5 sm:min-h-56 sm:p-7");

export function OfflinePlay() {
  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <BreweryBackdrop />
      <div className="relative z-10 h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-5 sm:px-8 sm:py-9">
          <Button variant="ghost" size="sm" asChild className="mb-8 self-start">
            <Link to={ROUTES.PLAY}>
              <ArrowLeft className="h-4 w-4" />
              Play
            </Link>
          </Button>

          <header className="mb-6 max-w-2xl sm:mb-9">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
              Offline Play
            </p>
            <h1 className="mt-2 font-serif text-3xl font-light tracking-[0.04em] sm:text-5xl">
              Choose your game
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Face an AI opponent with a deck you built, or open packs and build on the spot.
            </p>
          </header>

          <div className="grid gap-4 md:grid-cols-2">
            <Link to={ROUTES.PLAY_OFFLINE_CONSTRUCTED} className={MODE_CLASS}>
              <span className="flex h-12 w-12 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
                <Swords className="h-5 w-5" />
              </span>
              <span>
                <span className="flex items-center justify-between gap-3 font-serif text-2xl font-light sm:text-3xl">
                  Constructed
                  <ArrowRight className="h-5 w-5 shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-1" />
                </span>
                <span className="mt-2 block text-sm text-muted-foreground">
                  Pick two decks, choose a format, and battle the AI.
                </span>
              </span>
            </Link>

            <Link to={ROUTES.LIMITED} className={MODE_CLASS}>
              <span className="flex h-12 w-12 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
                <Boxes className="h-5 w-5" />
              </span>
              <span>
                <span className="flex items-center justify-between gap-3 font-serif text-2xl font-light sm:text-3xl">
                  Draft &amp; Sealed
                  <ArrowRight className="h-5 w-5 shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-1" />
                </span>
                <span className="mt-2 block text-sm text-muted-foreground">
                  Draft, sealed, Winston, and cube. Limited currently uses the Manabrew engine.
                </span>
              </span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
