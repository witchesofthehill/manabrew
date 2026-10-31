import { createElement, useState } from "react";
import { Info, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CheckpointDto } from "@/protocol/game";
import { stepLabel } from "../game.utils";
import { checkpointIcon } from "./checkpointsPanel.utils";

interface CheckpointRowProps {
  checkpoint: CheckpointDto;
  canRequestRestore: boolean;
  onRequestRestore: (checkpoint: CheckpointDto) => void;
  resolvePlayerName: (playerId: string) => string;
  resolvePlayerColor: (playerId: string) => string;
}

export function CheckpointRow({
  checkpoint,
  canRequestRestore,
  onRequestRestore,
  resolvePlayerName,
  resolvePlayerColor,
}: CheckpointRowProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const playerId = checkpoint.decidingPlayerId ?? checkpoint.activePlayerId;
  const log = checkpoint.log ?? [];
  const title = log[0] ?? checkpoint.decision ?? stepLabel(checkpoint.step);
  const subtitle = [
    log.length > 0 ? checkpoint.decision : undefined,
    stepLabel(checkpoint.step),
    resolvePlayerName(playerId),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md",
          canRequestRestore && "hover:bg-accent",
        )}
      >
        <button
          type="button"
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-1 text-left pointer-coarse:min-h-11",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !canRequestRestore && "cursor-default opacity-60",
          )}
          disabled={!canRequestRestore}
          title={canRequestRestore ? `Rewind to this point` : undefined}
          onClick={() => onRequestRestore(checkpoint)}
        >
          <span
            className={cn(
              "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground",
              canRequestRestore && "group-hover:bg-background group-hover:text-foreground",
            )}
          >
            {createElement(checkpointIcon(checkpoint), {
              className: "h-3.5 w-3.5",
              "aria-hidden": true,
            })}
            <span
              className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card"
              style={{ backgroundColor: resolvePlayerColor(playerId) }}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-foreground">{title}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{subtitle}</span>
          </span>
          {canRequestRestore && (
            <RotateCcw
              className="hidden h-3.5 w-3.5 shrink-0 text-primary group-hover:block pointer-coarse:block"
              aria-hidden
            />
          )}
        </button>
        {log.length > 0 && (
          <button
            type="button"
            aria-expanded={detailsOpen}
            aria-label={detailsOpen ? `Hide details` : `Show details`}
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground pointer-coarse:h-11 pointer-coarse:w-11",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              detailsOpen && "text-foreground",
            )}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            <Info className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
      {detailsOpen && (
        <ul className="mb-1 ml-[2.6rem] mr-1 flex flex-col gap-0.5 rounded-md bg-muted/40 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
          {log.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
