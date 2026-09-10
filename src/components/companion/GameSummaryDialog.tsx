import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompanionStore } from "@/stores/useCompanionStore";
import type { CompanionPlayer, CompanionSession } from "@/stores/useCompanionStore.types";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
export function GameSummaryDialog() {
  const summary = useCompanionStore((s) => s.summarySession);
  const dismissSummary = useCompanionStore((s) => s.dismissSummary);
  return (
    <Dialog open={Boolean(summary)} onOpenChange={(open) => !open && dismissSummary()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            <Trans>Game summary</Trans>
          </DialogTitle>
        </DialogHeader>
        {summary && <SummaryBody session={summary.session} winnerId={summary.winnerId} />}
      </DialogContent>
    </Dialog>
  );
}
function SummaryBody({
  session,
  winnerId,
}: {
  session: CompanionSession;
  winnerId: string | null;
}) {
  const winner = session.players.find((p) => p.id === winnerId) ?? null;
  const lengthMs = session.timer.accumulatedMs;
  return (
    <>
      <div className="space-y-3">
        {winner && (
          <p className="text-center text-lg font-semibold">
            <Trans>🏆 {winner.name} wins</Trans>
          </p>
        )}
        <div className="rounded-md border border-border p-3 text-sm">
          <div className="mb-1 font-medium">
            <Trans>Final scores</Trans>
          </div>
          <ul className="space-y-0.5 text-muted-foreground">
            {session.players.map((p) => (
              <li key={p.id} className="flex justify-between gap-2">
                <span className="truncate">
                  {p.name}
                  {p.isDead ? " (eliminated)" : ""}
                </span>
                <span className="tabular-nums">{p.life}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
          <div>
            <div className="font-medium text-foreground">
              <Trans>Length</Trans>
            </div>
            <div>{formatDuration(lengthMs)}</div>
          </div>
          <div>
            <div className="font-medium text-foreground">
              <Trans>Turns</Trans>
            </div>
            <div>{session.turn || "—"}</div>
          </div>
          <div>
            <div className="font-medium text-foreground">
              <Trans>Players</Trans>
            </div>
            <div>{session.players.length}</div>
          </div>
          <div>
            <div className="font-medium text-foreground">
              <Trans>Events</Trans>
            </div>
            <div>{session.history.length}</div>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => copySummary(session, winner)}>
          <Trans>
            <Copy className="mr-2 size-4" /> Copy to clipboard
          </Trans>
        </Button>
        <Button onClick={() => useCompanionStore.getState().dismissSummary()}>
          <Trans>Close</Trans>
        </Button>
      </DialogFooter>
    </>
  );
}
function copySummary(session: CompanionSession, winner: CompanionPlayer | null) {
  const lines = [
    i18n._(msg`Manabrew game summary`),
    winner ? i18n._(msg`Winner: ${winner.name}`) : i18n._(msg`Winner: none`),
    i18n._(msg`Length: ${formatDuration(session.timer.accumulatedMs)}`),
    i18n._(msg`Turns: ${session.turn || 0}`),
    "",
    i18n._(msg`Final scores:`),
    ...session.players.map((p) => `  ${p.name}: ${p.life}${p.isDead ? " (eliminated)" : ""}`),
  ];
  void navigator.clipboard.writeText(lines.join("\n"));
}
function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}
