import { useState } from "react";
import { ChevronRight, ChevronsRight, History, Loader2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CheckpointDto, DecisionHistoryDto } from "@/protocol/game";
import { stepLabel } from "../game.utils";
import { CheckpointRow } from "./CheckpointRow";
import { groupByTurn, journalEntries, type JournalEntry } from "./checkpointsPanel.utils";

interface CheckpointsPanelProps {
  checkpoints: CheckpointDto[];
  decisionHistory?: DecisionHistoryDto;
  canRequestRestore: boolean;
  onRequestRestore: (checkpoint: CheckpointDto) => void;
  resolvePlayerName: (playerId: string) => string;
  resolvePlayerColor: (playerId: string) => string;
}

export function CheckpointsPanel({
  checkpoints,
  decisionHistory,
  canRequestRestore,
  onRequestRestore,
  resolvePlayerName,
  resolvePlayerColor,
}: CheckpointsPanelProps) {
  const [openRuns, setOpenRuns] = useState<ReadonlySet<number>>(new Set());
  const toggleRun = (id: number) =>
    setOpenRuns((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const rowProps = { canRequestRestore, onRequestRestore, resolvePlayerName, resolvePlayerColor };
  const StatusIcon = decisionHistory?.rewinding
    ? Loader2
    : decisionHistory?.unavailableReason
      ? TriangleAlert
      : History;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div
        role="status"
        className={cn(
          "flex items-start gap-2 rounded-md bg-muted/40 px-2.5 py-2 text-ui-meta",
          decisionHistory?.unavailableReason ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <StatusIcon
          className={cn("mt-px h-3.5 w-3.5 shrink-0", decisionHistory?.rewinding && "animate-spin")}
          aria-hidden
        />
        <span>
          {decisionHistory?.unavailableReason ??
            (decisionHistory?.rewinding
              ? "Replaying the game…"
              : "Select an entry to rewind the game to it.")}
        </span>
      </div>
      {checkpoints.length === 0 ? (
        <p className="px-1 text-ui-meta italic text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {groupByTurn(checkpoints).map(([turn, steps]) => {
            const activePlayerId = steps[0]!.activePlayerId;
            const entries: JournalEntry[] = decisionHistory
              ? journalEntries(steps.slice().reverse())
              : steps.map((checkpoint) => ({ kind: "checkpoint", checkpoint }));
            return (
              <section key={turn} className="pb-2">
                <header className="sticky top-0 z-10 flex items-center gap-2 bg-card py-1.5">
                  <span className="font-game text-ui-meta font-semibold tabular-nums lining-nums text-foreground">
                    {`Turn ${turn}`}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-ui-meta text-muted-foreground">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: resolvePlayerColor(activePlayerId) }}
                    />
                    <span className="truncate">{resolvePlayerName(activePlayerId)}</span>
                  </span>
                  <span className="h-px flex-1 bg-border/60" />
                </header>
                <ol className="flex flex-col gap-0.5">
                  {entries.map((entry) => {
                    if (entry.kind === "checkpoint") {
                      return (
                        <li key={entry.checkpoint.checkpointId}>
                          <CheckpointRow checkpoint={entry.checkpoint} {...rowProps} />
                        </li>
                      );
                    }
                    const newest = entry.checkpoints[0]!;
                    const oldest = entry.checkpoints.at(-1)!;
                    const open = openRuns.has(newest.checkpointId);
                    return (
                      <li key={newest.checkpointId}>
                        <button
                          type="button"
                          aria-expanded={open}
                          className="group flex w-full touch:min-h-11 touch:min-w-11 items-center gap-2.5 rounded-md px-1.5 py-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => toggleRun(newest.checkpointId)}
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
                            <ChevronsRight className="h-3.5 w-3.5" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-ui-label text-muted-foreground">
                              Priority passes
                              <span className="rounded-full bg-muted px-1.5 text-ui-meta font-semibold tabular-nums lining-nums text-foreground">
                                {entry.checkpoints.length}
                              </span>
                            </span>
                            <span className="block truncate text-ui-meta text-muted-foreground">
                              {stepLabel(oldest.step) === stepLabel(newest.step)
                                ? stepLabel(newest.step)
                                : `${stepLabel(oldest.step)} → ${stepLabel(newest.step)}`}
                            </span>
                          </span>
                          <ChevronRight
                            className={cn(
                              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                              open && "rotate-90",
                            )}
                            aria-hidden
                          />
                        </button>
                        {open && (
                          <ol className="ml-[1.3rem] flex flex-col gap-0.5 border-l border-border/60 pl-1.5">
                            {entry.checkpoints.map((checkpoint) => (
                              <li key={checkpoint.checkpointId}>
                                <CheckpointRow checkpoint={checkpoint} {...rowProps} />
                              </li>
                            ))}
                          </ol>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
