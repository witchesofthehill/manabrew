import { cn } from "@/lib/utils";
import type { PlayerHudFact } from "@/pixi/hud/playerHud.types";

interface PlayerRuleFactsProps {
  facts: PlayerHudFact[];
}

export function PlayerRuleFacts({ facts }: PlayerRuleFactsProps) {
  return (
    <section aria-label="Rules and turn">
      <h3 className="mb-2 text-xs font-semibold text-muted-foreground">Rules and turn</h3>
      <dl className="grid gap-1.5 sm:grid-cols-2">
        {facts.map((fact) => (
          <div
            key={fact.id}
            className={cn(
              "flex min-h-10 items-center justify-between gap-3 rounded-md bg-muted/25 px-2.5 py-2 text-sm",
              fact.emphasized && "bg-active-action-priority/10",
            )}
          >
            <dt className="text-muted-foreground">{fact.label}</dt>
            <dd
              className={cn(
                "text-right font-semibold tabular-nums",
                fact.emphasized && "text-active-action-priority",
              )}
            >
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
