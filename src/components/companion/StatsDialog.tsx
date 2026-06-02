import { useMemo } from "react";
import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useCompanionStore } from "@/stores/useCompanionStore";
import type { CompanionSession } from "@/stores/useCompanionStore.types";

interface DerivedStats {
  totalGames: number;
  totalDurationMs: number;
  avgDurationMs: number;
  avgTurns: number;
  winsByName: { name: string; wins: number }[];
}

function deriveStats(archive: CompanionSession[]): DerivedStats {
  const winsByName = new Map<string, number>();
  let totalDurationMs = 0;
  let totalTurns = 0;
  let counted = 0;
  for (const archived of archive) {
    totalDurationMs += archived.timer.accumulatedMs;
    totalTurns += archived.turn;
    counted += 1;
    const living = archived.players.filter((p) => !p.isDead);
    if (living.length === 1) {
      const name = living[0]!.name;
      winsByName.set(name, (winsByName.get(name) ?? 0) + 1);
    }
  }
  return {
    totalGames: archive.length,
    totalDurationMs,
    avgDurationMs: counted > 0 ? totalDurationMs / counted : 0,
    avgTurns: counted > 0 ? totalTurns / counted : 0,
    winsByName: [...winsByName.entries()]
      .map(([name, wins]) => ({ name, wins }))
      .sort((a, b) => b.wins - a.wins),
  };
}

export function StatsDialog() {
  const archive = useCompanionStore((s) => s.archive);
  const stats = useMemo(() => deriveStats(archive), [archive]);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Trophy className="mr-2 size-4" /> Stats ({stats.totalGames})
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Play stats</DialogTitle>
        </DialogHeader>
        {stats.totalGames === 0 ? (
          <p className="text-sm text-muted-foreground">
            No archived games yet. End a game to start collecting stats.
          </p>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <Stat label="Games" value={stats.totalGames.toString()} />
              <Stat label="Avg length" value={formatDuration(stats.avgDurationMs)} />
              <Stat label="Avg turns" value={stats.avgTurns.toFixed(1)} />
              <Stat label="Total time" value={formatDuration(stats.totalDurationMs)} />
            </div>
            <div>
              <div className="mb-1 font-medium">Wins by player</div>
              {stats.winsByName.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No clean wins recorded (last-standing only).
                </p>
              ) : (
                <ul className="space-y-0.5 text-muted-foreground">
                  {stats.winsByName.map((row) => (
                    <li key={row.name} className="flex justify-between">
                      <span>{row.name}</span>
                      <span className="tabular-nums">{row.wins}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}
