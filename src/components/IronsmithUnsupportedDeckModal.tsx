import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GameIcon } from "@/components/game/GameIcon";
import { useGameStore } from "@/stores/useGameStore";
import type { IronsmithDeckIssue } from "@/game";

function groupByPlayer(issues: IronsmithDeckIssue[]): Array<{ player: string; cards: string[] }> {
  const order: string[] = [];
  const byPlayer = new Map<string, string[]>();
  for (const issue of issues) {
    if (!byPlayer.has(issue.playerName)) {
      byPlayer.set(issue.playerName, []);
      order.push(issue.playerName);
    }
    const cards = byPlayer.get(issue.playerName)!;
    if (!cards.includes(issue.cardName)) cards.push(issue.cardName);
  }
  return order.map((player) => ({ player, cards: byPlayer.get(player)! }));
}

export function IronsmithUnsupportedDeckModal() {
  const issues = useGameStore((s) => s.ironsmithDeckError);
  const dismiss = useGameStore((s) => s.dismissIronsmithDeckError);

  const groups = issues ? groupByPlayer(issues) : [];
  const multiPlayer = groups.length > 1;

  return (
    <Dialog open={issues !== null} onOpenChange={(open) => !open && dismiss()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GameIcon name="anvil" className="h-4 w-4 text-warning" />
            Ironsmith can&apos;t run this deck yet
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Ironsmith is an experimental engine with partial card support. These cards aren&apos;t
          implemented yet, so the match can&apos;t start. Swap them out, or pick a different engine.
        </p>
        <div className="max-h-[45dvh] space-y-3 overflow-y-auto pr-1">
          {groups.map(({ player, cards }) => (
            <div key={player} className="space-y-1">
              {multiPlayer && (
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {player}
                </h3>
              )}
              <ul className="space-y-0.5">
                {cards.map((card) => (
                  <li key={card} className="text-sm text-foreground">
                    {card}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={dismiss}>
            Got it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
