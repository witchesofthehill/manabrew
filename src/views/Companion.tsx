import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CompanionBar } from "@/components/companion/CompanionBar";
import { CompanionBoard } from "@/components/companion/CompanionBoard";
import { GameSummaryDialog } from "@/components/companion/GameSummaryDialog";
import { PhaseStrip } from "@/components/companion/PhaseStrip";
import { StatsDialog } from "@/components/companion/StatsDialog";
import { WinBanner } from "@/components/companion/WinBanner";
import { GameIcon } from "@/components/companion/GameIcon";
import { NewSessionDialog } from "@/components/companion/NewSessionDialog";
import { useCompanionStore } from "@/stores/useCompanionStore";

export default function Companion() {
  const session = useCompanionStore((s) => s.session);
  const newSession = useCompanionStore((s) => s.newSession);
  const archive = useCompanionStore((s) => s.archive);
  const restoreFromArchive = useCompanionStore((s) => s.restoreFromArchive);
  const [newOpen, setNewOpen] = useState(false);

  if (!session) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <GameIcon icon="healing" className="size-14 text-muted-foreground" />
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Life tracker</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Track life, counters, commander damage and table layout for paper play. One device
            passes around the table.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setNewOpen(true)}>Start a game</Button>
          <StatsDialog />
        </div>
        {archive.length > 0 && (
          <div className="mt-4 w-full max-w-sm space-y-1 text-left">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Recent games
            </p>
            <ul className="divide-y divide-border rounded-md border border-border">
              {archive.slice(0, 5).map((archived) => (
                <li key={archived.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{archived.tag || "Untitled game"}</div>
                    <div className="text-[10px] text-muted-foreground">
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CompanionBar session={session} onOpenNewSession={() => setNewOpen(true)} />
      <PhaseStrip />
      <div className="relative flex-1 min-h-0">
        <CompanionBoard session={session} />
        <WinBanner session={session} />
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
