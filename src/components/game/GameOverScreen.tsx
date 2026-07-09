import type { PlayerDto } from "@/protocol/game";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface GameOverScreenProps {
  winnerId: string | null | undefined;
  me: PlayerDto;
  opponents: PlayerDto[];
  turn: number;
  onEndGame: () => void;
}

export function GameOverScreen({ winnerId, me, opponents, turn, onEndGame }: GameOverScreenProps) {
  const didWin = winnerId === me.id;
  const iConceded = me.status === "conceded";
  const otherConcedeNames = opponents.filter((op) => op.status === "conceded").map((op) => op.name);
  const anyConceded = iConceded || otherConcedeNames.length > 0;

  const { heading, tone } = (() => {
    if (winnerId == null && !anyConceded) {
      return { heading: "Draw!", tone: "neutral" as const };
    }
    if (iConceded) {
      return { heading: "You conceded", tone: "loss" as const };
    }
    if (didWin) {
      return { heading: "You Win!", tone: "win" as const };
    }
    if (winnerId != null) {
      return { heading: "You Lose!", tone: "loss" as const };
    }
    const sentence =
      otherConcedeNames.length === 1
        ? `${otherConcedeNames[0]} conceded`
        : `${otherConcedeNames.slice(0, -1).join(", ")} and ${otherConcedeNames[otherConcedeNames.length - 1]} conceded`;
    return { heading: sentence, tone: "neutral" as const };
  })();

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <h2
        className={cn(
          "text-3xl font-bold",
          tone === "neutral"
            ? "text-muted-foreground"
            : tone === "win"
              ? "text-success"
              : "text-destructive",
        )}
      >
        {heading}
      </h2>
      <p className="text-muted-foreground">
        Final life: You {me.life} — {opponents.map((op) => `${op.name} ${op.life}`).join(" · ")}
      </p>
      <p className="text-sm text-muted-foreground">Turn {turn}</p>
      <p className="text-xs text-muted-foreground italic">Returning to menu…</p>
      <Button variant="outline" size="sm" onClick={onEndGame}>
        Return to Menu
      </Button>
    </div>
  );
}
