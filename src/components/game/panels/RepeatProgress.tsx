import { Repeat } from "lucide-react";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import type { RepeatVoteDto } from "@/protocol";
interface RepeatProgressProps {
  vote: RepeatVoteDto;
  completed: number;
  playerName: string;
}
export function RepeatProgress({ vote, completed, playerName }: RepeatProgressProps) {
  const percent = Math.round((completed / vote.iterations) * 100);
  return (
    <div
      role="status"
      className="pointer-events-none absolute left-1/2 top-4 z-[9001] w-80 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-lg border border-border bg-card/95 px-4 py-3 text-sm text-card-foreground shadow-lg"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 font-medium">
          <Repeat className="h-4 w-4 shrink-0" />
          <span className="truncate">{`${playerName} is repeating actions`}</span>
        </span>
        <span className="tabular-nums text-muted-foreground">{`${completed} / ${vote.iterations}`}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-2 truncate text-xs text-muted-foreground">
        <DynamicTextRender className="align-middle" text={vote.actions.join(" → ")} />
      </p>
    </div>
  );
}
