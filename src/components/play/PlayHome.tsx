import { ArrowRight, Boxes, FlaskConical, LibraryBig, Swords, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { BreweryBackdrop } from "@/components/BreweryBackdrop";
import { PlayDeckShelf } from "@/components/play/PlayDeckShelf";
import { PlayHomeLinks } from "@/components/play/PlayHomeLinks";
import { QuickPlayHero } from "@/components/play/QuickPlayHero";
import { RejoinMatchCard } from "@/components/play/RejoinMatchCard";
import { isFeatureEnabled } from "@/featureFlags";
import { useQuickPlay } from "@/hooks/useQuickPlay";
import { peekActiveGameSession } from "@/lib/activeGameSession";
import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useServerStore } from "@/stores/useServerStore";

const MODE_CLASS =
  "group relative flex min-h-40 min-w-0 flex-col justify-between gap-4 overflow-hidden rounded-2xl border border-border/70 bg-card/85 p-5 text-left shadow-xl backdrop-blur-md hover:shadow-2xl motion-safe:transition-[transform,border-color,box-shadow] motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none sm:min-h-48 sm:p-6 lg:min-h-52";

const MODE_ACCENTS: Record<string, { chip: string; hoverBorder: string; watermark: string }> = {
  primary: {
    chip: "border-primary/40 bg-primary/15 text-primary",
    hoverBorder: "hover:border-primary/70",
    watermark: "text-primary",
  },
  purple: {
    chip: "border-format-badge-purple/40 bg-format-badge-purple/15 text-format-badge-purple",
    hoverBorder: "hover:border-format-badge-purple/60",
    watermark: "text-format-badge-purple",
  },
  sky: {
    chip: "border-format-badge-sky/40 bg-format-badge-sky/15 text-format-badge-sky",
    hoverBorder: "hover:border-format-badge-sky/60",
    watermark: "text-format-badge-sky",
  },
};

const MODES = [
  {
    to: ROUTES.PLAY_OFFLINE_CONSTRUCTED,
    label: "Constructed",
    desc: "Pick a deck and battle the AI.",
    icon: Swords,
    tone: "primary",
  },
  {
    to: ROUTES.LIMITED,
    label: "Draft & Sealed",
    desc: "Draft, sealed, Winston, and cube.",
    icon: Boxes,
    tone: "purple",
  },
  {
    to: ROUTES.LOBBY,
    label: "Multiplayer",
    desc: "Find a table or set up a game for your group.",
    icon: Users,
    tone: "sky",
  },
];

export function PlayHome() {
  const { quickPlay, quickPlayStarter, quickPlayPreset, pendingDeckId } = useQuickPlay();
  const [resumeSession, setResumeSession] = useState(peekActiveGameSession);
  const resumePending = resumeSession !== null;
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

          {resumeSession && (
            <RejoinMatchCard session={resumeSession} onDismiss={() => setResumeSession(null)} />
          )}

          <div
            className={cn(
              "flex flex-col gap-4 motion-safe:animate-onboard-fade-up sm:gap-5",
              resumePending && "hidden",
            )}
          >
            <QuickPlayHero
              quickPlay={quickPlay}
              quickPlayStarter={quickPlayStarter}
              pendingDeckId={pendingDeckId}
            />

            <section className="grid gap-4 md:grid-cols-3">
              {MODES.map(({ to, label, desc, icon: Icon, tone }) => {
                const accent = MODE_ACCENTS[tone] ?? MODE_ACCENTS.primary;
                return (
                  <Link key={to} to={to} className={cn(MODE_CLASS, accent.hoverBorder)}>
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        "absolute -bottom-5 -right-5 h-28 w-28 rotate-12 opacity-[0.07]",
                        accent.watermark,
                      )}
                    />
                    <span
                      className={cn(
                        "flex h-11 w-11 items-center justify-center rounded-full border",
                        accent.chip,
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="relative">
                      <span className="flex min-w-0 items-center justify-between gap-2 font-serif text-2xl font-light">
                        {label}
                        <ArrowRight className="h-5 w-5 shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-1" />
                      </span>
                      <span className="mt-1 block text-sm text-muted-foreground">{desc}</span>
                      {to === ROUTES.LOBBY && lobbyTeaser && (
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
                );
              })}
            </section>
          </div>

          <div
            className={cn("motion-safe:animate-onboard-fade-up", resumePending && "hidden")}
            style={{ animationDelay: "80ms" }}
          >
            <PlayDeckShelf
              onQuickPlay={quickPlay}
              onQuickPlayPreset={quickPlayPreset}
              pendingDeckId={pendingDeckId}
            />
          </div>

          <div
            className={cn("motion-safe:animate-onboard-fade-up", resumePending && "hidden")}
            style={{ animationDelay: "140ms" }}
          >
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
            className={cn(
              "mt-auto flex flex-col gap-6 motion-safe:animate-onboard-fade-up sm:gap-8",
              resumePending && "hidden",
            )}
            style={{ animationDelay: "200ms" }}
          >
            <PlayHomeLinks />
          </div>
        </div>
      </div>
    </div>
  );
}
