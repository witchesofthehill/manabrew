import { Button } from "@/components/ui/button";
import type { GameSnapshotEntry } from "@/types/gameSnapshot";
import { Trans } from "@lingui/react/macro";
interface SnapshotsPanelProps {
  snapshots: GameSnapshotEntry[];
  canRestoreSnapshots: boolean;
  onRestoreSnapshot: (checkpointId: number) => void;
}
export function SnapshotsPanel({
  snapshots,
  canRestoreSnapshots,
  onRestoreSnapshot,
}: SnapshotsPanelProps) {
  const formatTs = (timestampMs: number) =>
    new Date(timestampMs).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  if (snapshots.length === 0) {
    return (
      <div className="rounded-lg p-2.5 min-h-0 flex-1 flex flex-col bg-muted/20">
        <p className="text-xs font-semibold text-muted-foreground mb-2">
          <Trans>Snapshots</Trans>
        </p>
        <p className="text-xs text-muted-foreground italic">
          <Trans>No snapshots yet.</Trans>
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg p-2.5 min-h-0 flex-1 flex flex-col bg-muted/20">
      <p className="text-xs font-semibold text-muted-foreground mb-2">
        <Trans>Snapshots</Trans>
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto text-xs text-muted-foreground pr-1">
        {snapshots
          .slice(-200)
          .reverse()
          .map((s) => (
            <div key={s.checkpointId} className="py-1 border-b border-border/40 last:border-b-0">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">{s.label}</div>
                  <div className="text-[10px] text-muted-foreground/80">
                    #{s.checkpointId} • {formatTs(s.timestampMs)}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  disabled={!canRestoreSnapshots}
                  onClick={() => onRestoreSnapshot(s.checkpointId)}
                >
                  <Trans>Restore</Trans>
                </Button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
