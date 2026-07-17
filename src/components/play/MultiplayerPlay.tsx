import { ArrowLeft, ArrowRight, Search, Sparkles, UserRoundSearch, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { BreweryBackdrop } from "@/components/BreweryBackdrop";
import { PLAY_ACTION_CARD_CLASS } from "@/components/play/play.styles";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";

const ACTION_CLASS = cn(PLAY_ACTION_CARD_CLASS, "min-h-36 p-5 sm:min-h-44 sm:p-6");

export function MultiplayerPlay() {
  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <BreweryBackdrop />
      <div className="relative z-10 h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 py-5 sm:px-8 sm:py-9">
          <Button variant="ghost" size="sm" asChild className="mb-7 self-start">
            <Link to={ROUTES.PLAY}>
              <ArrowLeft className="h-4 w-4" />
              Play
            </Link>
          </Button>

          <header className="mb-6 max-w-2xl sm:mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
              Multiplayer
            </p>
            <h1 className="mt-2 font-serif text-3xl font-light tracking-[0.04em] sm:text-5xl">
              Take a seat
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Browse waiting tables, create one for your group, or see who is already online.
            </p>
          </header>

          <div className="grid gap-4 sm:grid-cols-2">
            <Link to={ROUTES.LOBBY} className={ACTION_CLASS}>
              <Search className="h-7 w-7 text-primary" />
              <span>
                <span className="flex items-center justify-between gap-3 font-serif text-2xl font-light">
                  Find a Game
                  <ArrowRight className="h-5 w-5 shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-1" />
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Browse hosted capacity and open waiting tables.
                </span>
              </span>
            </Link>

            <Link to={ROUTES.LOBBY} state={{ createTable: "match" }} className={ACTION_CLASS}>
              <Users className="h-7 w-7 text-primary" />
              <span>
                <span className="flex items-center justify-between gap-3 font-serif text-2xl font-light">
                  Play with Friends
                  <ArrowRight className="h-5 w-5 shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-1" />
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Create a table, set a password if you want, and share its name.
                </span>
              </span>
            </Link>

            <Link to={ROUTES.LOBBY} state={{ createTable: "limited" }} className={ACTION_CLASS}>
              <Sparkles className="h-7 w-7 text-primary" />
              <span>
                <span className="flex items-center justify-between gap-3 font-serif text-2xl font-light">
                  Limited Event
                  <ArrowRight className="h-5 w-5 shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-1" />
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Create a draft, sealed, or cube table using the Manabrew engine.
                </span>
              </span>
            </Link>

            <Link to={ROUTES.LOBBY} state={{ showPlayers: true }} className={ACTION_CLASS}>
              <UserRoundSearch className="h-7 w-7 text-primary" />
              <span>
                <span className="flex items-center justify-between gap-3 font-serif text-2xl font-light">
                  Players &amp; Friends
                  <ArrowRight className="h-5 w-5 shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-1" />
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  See who is online and join their table. Account friends will live here too.
                </span>
              </span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
