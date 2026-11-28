import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CompanionBar } from "@/components/companion/CompanionBar";
import { CompanionBoard } from "@/components/companion/CompanionBoard";
import { GameIcon } from "@/components/companion/GameIcon";
import { GameSummaryDialog } from "@/components/companion/GameSummaryDialog";
import { NewSessionDialog } from "@/components/companion/NewSessionDialog";
import { PhaseStrip } from "@/components/companion/PhaseStrip";
import { StatsDialog } from "@/components/companion/StatsDialog";
import { WinBanner } from "@/components/companion/WinBanner";
import { useTopBarOverride } from "@/components/layout/TopBarOverride";
import { readClockwiseSeats } from "@/components/companion/layouts/turnOrder";
import { cn } from "@/lib/utils";
import { useCompanionStore } from "@/stores/useCompanionStore";
import "@/components/companion/companion.css";
export default function Companion() {
  const session = useCompanionStore((s) => s.session);
  const newSession = useCompanionStore((s) => s.newSession);
  const archive = useCompanionStore((s) => s.archive);
  const restoreFromArchive = useCompanionStore((s) => s.restoreFromArchive);
  const [newOpen, setNewOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement));
  const boardRef = useRef<HTMLDivElement>(null);
  useTopBarOverride({ hidden: Boolean(session) && fullscreen });

  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else if (fullscreen) {
      setFullscreen(false);
    } else if (document.documentElement.requestFullscreen) {
      void document.documentElement.requestFullscreen().catch(() => setFullscreen(true));
    } else {
      setFullscreen(true);
    }
  }

  if (!session) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center gap-4 overflow-y-auto overscroll-contain px-4 py-6 text-center sm:px-6 lg:px-8">
        <GameIcon icon="healing" className="size-14 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">Start tracking</h2>
          <p className="max-w-sm text-ui-body text-muted-foreground">
            Track life, counters, commander damage and table layout for paper play. One device
            passes around the table.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={() => setNewOpen(true)}>
            Start a game
          </Button>
          <StatsDialog />
        </div>
        {archive.length > 0 && (
          <div className="mt-4 w-full max-w-sm space-y-1 text-left">
            <p className="text-ui-meta font-semibold uppercase tracking-wide text-muted-foreground">
              Recent games
            </p>
            <ul className="divide-y divide-border rounded-md border border-border">
              {archive.slice(0, 5).map((archived) => (
                <li key={archived.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-ui-label">
                      {archived.tag || "Untitled game"}
                    </div>
                    <div className="text-ui-meta text-muted-foreground">
                      {new Date(archived.createdAt).toLocaleString()} · {archived.players.length}p
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => restoreFromArchive(archived.id)}
                  >
                    Resume
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <NewSessionDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          hasExistingSession={false}
          onCreate={(input) => {
            newSession(input);
            setNewOpen(false);
          }}
        />
        <GameSummaryDialog />
      </div>
    );
  }
  const centerDock =
    session.layout === "1v1" ||
    session.layout === "quad" ||
    session.layout === "three-wedge" ||
    session.layout === "five-rows" ||
    session.layout === "six-grid" ||
    (session.layout === "vertical-stack" && session.players.length === 2);
  return (
    <div
      className={cn(
        "companion-tracker h-full min-h-0 bg-card pb-[var(--safe-area-inset-bottom)] pl-[var(--safe-area-inset-left)] pr-[var(--safe-area-inset-right)]",
        fullscreen && "pt-[var(--safe-area-inset-top)]",
      )}
    >
      <div
        className="companion-table relative size-full"
        data-center-dock={centerDock ? "" : undefined}
      >
        <div className="companion-dock">
          <CompanionBar
            session={session}
            getClockwiseSeats={() =>
              readClockwiseSeats(
                boardRef.current,
                session.players.map((player) => player.id),
              )
            }
            onOpenNewSession={() => setNewOpen(true)}
            fullscreen={fullscreen}
            onToggleFullscreen={toggleFullscreen}
          />
        </div>
        {session.phasesEnabled && (
          <div className="companion-phases">
            <PhaseStrip />
          </div>
        )}
        <div ref={boardRef} className="companion-board relative min-h-0 min-w-0">
          <CompanionBoard session={session} />
          <WinBanner session={session} />
        </div>
      </div>
      <NewSessionDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        hasExistingSession
        onCreate={(input) => {
          newSession(input);
          setNewOpen(false);
        }}
      />
      <GameSummaryDialog />
    </div>
  );
}
