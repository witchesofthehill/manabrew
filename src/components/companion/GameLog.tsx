import { Undo2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCompanionStore } from "@/stores/useCompanionStore";
import type { CompanionEvent, CompanionSession } from "@/stores/useCompanionStore.types";

interface GameLogProps {
  session: CompanionSession;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GameLog({ session, open, onOpenChange }: GameLogProps) {
  const undo = useCompanionStore((s) => s.undo);
  const history = session.history;

  const undoTo = (eventIndex: number) => {
    // Synchronously fire undo for each step we want to rewind. History is
    // capped at COMPANION_HISTORY_LIMIT (80), so the worst-case loop is
    // bounded and every iteration is one atomic Zustand transition.
    const stepsBack = history.length - 1 - eventIndex;
    for (let i = 0; i < stepsBack; i++) undo();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-80 overflow-y-auto p-0">
        <SheetHeader className="px-4 py-3">
          <SheetTitle>Game log</SheetTitle>
        </SheetHeader>
        <ol className="divide-y divide-border">
          {history.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">No events yet.</li>
          )}
          {history
            .map((event, index) => ({ event, index }))
            .reverse()
            .map(({ event, index }) => (
              <li
                key={`${event.at}-${index}`}
                className={cn(
                  "flex items-center justify-between gap-2 px-4 py-2 text-sm",
                  index === history.length - 1 && "bg-accent/50",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate">{describeEvent(event, session)}</div>
                  <div className="text-[10px] text-muted-foreground">{formatTime(event.at)}</div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  onClick={() => undoTo(index)}
                  title="Rewind to this point"
                  aria-label="Rewind to this point"
                >
                  <Undo2 className="size-3.5" />
                </Button>
              </li>
            ))}
        </ol>
      </SheetContent>
    </Sheet>
  );
}

function nameFor(playerId: string, session: CompanionSession): string {
  return session.players.find((p) => p.id === playerId)?.name ?? "?";
}

function describeEvent(event: CompanionEvent, session: CompanionSession): string {
  switch (event.type) {
    case "life": {
      const delta = event.next - event.prev;
      const sign = delta > 0 ? "+" : "";
      return `${nameFor(event.playerId, session)} life ${sign}${delta} (→ ${event.next})`;
    }
    case "counter": {
      const delta = event.next - event.prev;
      const sign = delta > 0 ? "+" : "";
      return `${nameFor(event.playerId, session)} counter ${sign}${delta} (→ ${event.next})`;
    }
    case "counterAdd":
      return `${nameFor(event.playerId, session)} added ${event.counter.label}`;
    case "counterRemove":
      return `${nameFor(event.playerId, session)} removed ${event.counter.label}`;
    case "commander":
      return `${nameFor(event.playerId, session)} set commander slot ${event.slot + 1} → ${event.next?.name ?? "(empty)"}`;
    case "dead":
      return `${nameFor(event.playerId, session)} ${event.next ? "eliminated" : "revived"}`;
    case "cmdDmg": {
      const delta = event.next - event.prev;
      const sign = delta > 0 ? "+" : "";
      return `${nameFor(event.targetId, session)} took ${sign}${delta} cmd dmg from ${nameFor(event.sourceId, session)}`;
    }
  }
}

function formatTime(at: number): string {
  const d = new Date(at);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}
