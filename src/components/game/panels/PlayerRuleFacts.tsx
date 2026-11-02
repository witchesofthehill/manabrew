import { cn } from "@/lib/utils";
import type { PlayerHudFact } from "@/pixi/hud/playerHud.types";

interface PlayerRuleFactsProps {
  facts: PlayerHudFact[];
}

export function PlayerRuleFacts({ facts }: PlayerRuleFactsProps) {
  return (
    <section aria-label="Rules and turn">
      <h3 className="mb-2 text-ui-meta font-semibold text-muted-foreground">Rules and turn</h3>
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-1.5">
        {facts.map((fact) => (
          <div
            key={fact.id}
            className={cn(
              "flex min-h-10 flex-wrap items-center justify-between gap-3 rounded-md bg-muted/25 px-2.5 py-2 text-ui-meta",
              fact.emphasized && "bg-primary/10",
            )}
          >
            <dt className="text-muted-foreground">{fact.label}</dt>
            <dd
              className={cn(
                "text-right font-semibold tabular-nums lining-nums",
                fact.emphasized && "text-primary",
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
