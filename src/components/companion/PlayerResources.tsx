import { cn } from "@/lib/utils";
import type { CompanionPlayer } from "@/stores/useCompanionStore.types";
import { AddCounterMenu } from "./AddCounterMenu";
import { CommanderDamageStrip } from "./CommanderDamageStrip";
import { CommanderTaxRail } from "./CommanderTaxRail";
import { CountersRail } from "./CountersRail";
import { ManaPoolRail } from "./ManaPoolRail";
import { StatusChips } from "./StatusChips";

export function PlayerResources({
  player,
  opponents,
  commanderRules,
  showDamage,
  className,
}: {
  player: CompanionPlayer;
  opponents: CompanionPlayer[];
  commanderRules: boolean;
  showDamage: boolean;
  className?: string;
}) {
  return (
    <div
      data-companion-no-body-drag
      className={cn("pointer-events-auto flex flex-wrap items-center gap-2", className)}
    >
      <AddCounterMenu player={player} />
      <StatusChips player={player} />
      <CommanderTaxRail player={player} commanderRules={commanderRules} />
      <CountersRail playerId={player.id} counters={player.counters} />
      <ManaPoolRail playerId={player.id} pool={player.manaPool} />
      {showDamage && (
        <CommanderDamageStrip
          target={player}
          opponents={opponents}
          className="flex-row flex-wrap"
        />
      )}
    </div>
  );
}
