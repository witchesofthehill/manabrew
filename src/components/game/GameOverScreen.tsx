import type { PlayerDto } from "@/protocol/game";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
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
      return { heading: i18n._(msg`Draw!`), tone: "neutral" as const };
    }
    if (iConceded) {
      return { heading: i18n._(msg`You conceded`), tone: "loss" as const };
    }
    if (didWin) {
      return { heading: i18n._(msg`You Win!`), tone: "win" as const };
    }
    if (winnerId != null) {
      return { heading: i18n._(msg`You Lose!`), tone: "loss" as const };
    }
    const names = new Intl.ListFormat(i18n.locale, {
      style: "long",
      type: "conjunction",
    }).format(otherConcedeNames);
    return { heading: i18n._(msg`${names} conceded`), tone: "neutral" as const };
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
        <Trans>
          Final life: You {me.life} — {opponents.map((op) => `${op.name} ${op.life}`).join(" · ")}
        </Trans>
      </p>
      <p className="text-sm text-muted-foreground">
        <Trans>Turn {turn}</Trans>
      </p>
      <p className="text-xs text-muted-foreground italic">
        <Trans>Returning to menu…</Trans>
      </p>
      <Button variant="outline" size="sm" onClick={onEndGame}>
        <Trans>Return to Menu</Trans>
      </Button>
    </div>
  );
}
