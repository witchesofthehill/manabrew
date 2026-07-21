import { ArrowRight, LibraryBig, Swords, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { BreweryBackdrop } from "@/components/BreweryBackdrop";
import { PlayDeckShelf } from "@/components/play/PlayDeckShelf";
import { PlayHomeLinks } from "@/components/play/PlayHomeLinks";
import { RejoinMatchCard } from "@/components/play/RejoinMatchCard";
import { isFeatureEnabled } from "@/featureFlags";
import { useQuickPlay } from "@/hooks/useQuickPlay";
import { peekActiveGameSession } from "@/lib/activeGameSession";
import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useServerStore } from "@/stores/useServerStore";

const MODE_CLASS =
  "group relative flex min-h-44 min-w-0 flex-col justify-between gap-6 overflow-hidden rounded-2xl border border-border/70 bg-card/85 p-5 text-left shadow-xl backdrop-blur-md hover:shadow-2xl motion-safe:transition-[transform,border-color,box-shadow] motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none sm:min-h-52 sm:p-7 lg:min-h-60";

const MODE_ACCENTS: Record<string, { chip: string; hoverBorder: string; watermark: string }> = {
  primary: {
    chip: "border-primary/40 bg-primary/15 text-primary",
    hoverBorder: "hover:border-primary/70",
    watermark: "text-primary",
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
    label: "Play Offline",
    desc: "Choose your decks and play against the AI at your own pace.",
    icon: Swords,
    tone: "primary",
  },
  {
    to: ROUTES.LOBBY,
    label: "Multiplayer",
    desc: "Join an open table or create a room for your group.",
    icon: Users,
    tone: "sky",
  },
];

export function PlayHome() {
  const { quickPlay, pendingDeckId } = useQuickPlay();
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
        <div className="flex min-h-full w-full flex-col gap-6 px-4 py-6 sm:gap-7 sm:px-6 sm:py-9 lg:px-8">
          <header className="max-w-xl sm:pt-2">
            <h1 className="font-serif text-3xl font-light tracking-[0.02em] text-foreground sm:text-4xl">
              Ready to play?
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Start a match your way, or open a deck from your collection.
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
            <section aria-label="Play modes" className="grid gap-4 md:grid-cols-2">
              {MODES.map(({ to, label, desc, icon: Icon, tone }) => {
                const accent = MODE_ACCENTS[tone] ?? MODE_ACCENTS.primary;
                return (
                  <Link key={to} to={to} className={cn(MODE_CLASS, accent.hoverBorder)}>
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        "absolute -bottom-8 -right-5 h-36 w-36 rotate-12 opacity-[0.07] sm:h-44 sm:w-44",
                        accent.watermark,
                      )}
                    />
                    <span
                      className={cn(
                        "flex h-12 w-12 items-center justify-center rounded-full border",
                        accent.chip,
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="relative">
                      <span className="flex min-w-0 items-center justify-between gap-3 font-serif text-2xl font-light sm:text-3xl">
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
            <PlayDeckShelf onPlay={quickPlay} pendingDeckId={pendingDeckId} />
          </div>

          {isFeatureEnabled("deckHub") && (
            <div
              className={cn("motion-safe:animate-onboard-fade-up", resumePending && "hidden")}
              style={{ animationDelay: "140ms" }}
            >
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
            </div>
          )}

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
