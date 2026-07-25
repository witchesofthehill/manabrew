import { LibraryBig, Swords, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FeatureTile } from "@/components/play/FeatureTile";
import { PlayDeckShelf } from "@/components/play/PlayDeckShelf";
import { PlayHomeLinks } from "@/components/play/PlayHomeLinks";
import { RejoinMatchCard } from "@/components/play/RejoinMatchCard";
import { isFeatureEnabled } from "@/featureFlags";
import { useQuickPlay } from "@/hooks/useQuickPlay";
import { peekActiveGameSession } from "@/lib/activeGameSession";
import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useServerStore } from "@/stores/useServerStore";

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
  const { quickPlay, quickPlayPreset, pendingDeckId } = useQuickPlay();
  const [resumeSession, setResumeSession] = useState(peekActiveGameSession);
  const resumePending = resumeSession !== null;
  const connected = useServerStore((state) => state.connected);
  const connecting = useServerStore((state) => state.connecting);
  const connectionError = useServerStore((state) => state.error);
  const rooms = useServerStore((state) => state.rooms);
  const players = useServerStore((state) => state.players);
  const connect = useServerStore((state) => state.connect);
  const listRooms = useServerStore((state) => state.listRooms);
  const listPlayers = useServerStore((state) => state.listPlayers);
  const serverHost = usePreferencesStore((state) => state.serverHost);
  const serverPort = usePreferencesStore((state) => state.serverPort);
  const serverUsername = usePreferencesStore((state) => state.serverUsername);
  const serverPassword = usePreferencesStore((state) => state.serverPassword);
  const openTables = rooms.filter((room) => room.status === "Lobby").length;
  const lobbyTeaser =
    connected && (openTables > 0 || players.length > 0)
      ? `${openTables} ${openTables === 1 ? "table" : "tables"} open · ${players.length} online`
      : null;

  useEffect(() => {
    if (!resumePending && !connected && !connecting && !connectionError && serverUsername) {
      connect(serverHost, serverPort, serverUsername, serverPassword);
    }
  }, [
    connect,
    connected,
    connecting,
    connectionError,
    resumePending,
    serverHost,
    serverPort,
    serverUsername,
    serverPassword,
  ]);

  useEffect(() => {
    if (!connected || resumePending) return;
    listRooms();
    listPlayers();
    const id = setInterval(() => {
      listRooms();
      listPlayers();
    }, 5000);
    return () => clearInterval(id);
  }, [connected, listPlayers, listRooms, resumePending]);

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
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
            <RejoinMatchCard session={resumeSession} onAbandoned={() => setResumeSession(null)} />
          )}

          <div
            className={cn(
              "flex flex-col gap-4 motion-safe:animate-onboard-fade-up sm:gap-5",
              resumePending && "hidden",
            )}
          >
            <section aria-label="Play modes" className="grid gap-4 md:grid-cols-2">
              {MODES.map(({ to, label, desc, icon, tone }) => (
                <FeatureTile
                  key={to}
                  to={to}
                  label={label}
                  desc={desc}
                  icon={icon}
                  tone={tone}
                  size="lg"
                  footer={
                    to === ROUTES.LOBBY && lobbyTeaser ? (
                      <span className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-primary">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                        </span>
                        {lobbyTeaser}
                      </span>
                    ) : undefined
                  }
                />
              ))}
            </section>
          </div>

          <div
            className={cn("motion-safe:animate-onboard-fade-up", resumePending && "hidden")}
            style={{ animationDelay: "80ms" }}
          >
            <PlayDeckShelf
              onPlay={quickPlay}
              onPlayPreset={quickPlayPreset}
              pendingDeckId={pendingDeckId}
            />
          </div>

          {isFeatureEnabled("deckHub") && (
            <div
              className={cn("motion-safe:animate-onboard-fade-up", resumePending && "hidden")}
              style={{ animationDelay: "140ms" }}
            >
              <Link
                to={ROUTES.HUB}
                className="group flex min-w-0 items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 p-5 backdrop-blur-md hover:border-primary/60 motion-safe:transition-colors motion-reduce:transition-none sm:gap-4"
              >
                <span className="flex min-w-0 items-center gap-3 sm:gap-4">
                  <LibraryBig className="h-6 w-6 shrink-0 text-primary" />
                  <span className="min-w-0">
                    <span className="block font-medium">Discover decks from the community</span>
                    <span className="text-sm text-muted-foreground">Browse the Deck Hub.</span>
                  </span>
                </span>
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
