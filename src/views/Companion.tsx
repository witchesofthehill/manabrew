import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CompanionBar } from "@/components/companion/CompanionBar";
import { CompanionBoard } from "@/components/companion/CompanionBoard";
import { GameIcon } from "@/components/companion/GameIcon";
import { NewSessionDialog } from "@/components/companion/NewSessionDialog";
import { useCompanionStore } from "@/stores/useCompanionStore";

export default function Companion() {
  const session = useCompanionStore((s) => s.session);
  const newSession = useCompanionStore((s) => s.newSession);
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
        <Button onClick={() => setNewOpen(true)}>Start a game</Button>
        <NewSessionDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          hasExistingSession={false}
          onCreate={(input) => {
            newSession(input);
            setNewOpen(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CompanionBar session={session} onOpenNewSession={() => setNewOpen(true)} />
      <div className="relative flex-1 min-h-0">
        <CompanionBoard session={session} />
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
    </div>
  );
}
