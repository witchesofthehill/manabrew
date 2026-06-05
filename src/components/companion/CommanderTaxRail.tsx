import { useCompanionStore } from "@/stores/useCompanionStore";
import type { CompanionPlayer } from "@/stores/useCompanionStore.types";
import { GameIcon } from "./GameIcon";
import { usePressHold } from "./usePressHold";

interface CommanderTaxRailProps {
  player: CompanionPlayer;
  commanderRules: boolean;
}

export function CommanderTaxRail({ player, commanderRules }: CommanderTaxRailProps) {
  if (!commanderRules) return null;
  const slots = ([0, 1] as const).filter(
    (slot) => slot === 0 || player.commanders[slot] || (player.commanderCasts?.[slot] ?? 0) > 0,
  );
  return (
    <div className="flex items-center gap-1 rounded-full bg-black/45 px-1 py-0.5 text-white shadow ring-1 ring-white/10 backdrop-blur">
      {slots.map((slot) => (
        <TaxPip
          key={slot}
          playerId={player.id}
          slot={slot}
          casts={player.commanderCasts?.[slot] ?? 0}
        />
      ))}
    </div>
  );
}

function TaxPip({ playerId, slot, casts }: { playerId: string; slot: 0 | 1; casts: number }) {
  const adjust = useCompanionStore((s) => s.adjustCommanderCast);
  const tax = casts * 2;
  const bindings = usePressHold({
    onTap: () => adjust(playerId, slot, 1),
    onHoldTick: () => adjust(playerId, slot, -1),
  });
  return (
    <button
      type="button"
      className="flex items-center gap-0.5 rounded-full px-1.5 py-1 text-xs font-semibold hover:bg-white/15"
      aria-label={`Commander tax: pay ${tax} generic (tap +1 cast, hold -1)`}
      title="Commander tax — tap +1 cast, hold -1"
      {...bindings}
    >
      <GameIcon icon="crown" className="size-3.5 text-white/80" />
      <span className="tabular-nums">{tax}</span>
    </button>
  );
}
