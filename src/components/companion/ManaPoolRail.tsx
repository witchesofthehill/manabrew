import { manaSymbolUrl } from "@/api/scryfall";
import { cn } from "@/lib/utils";
import { useCompanionStore } from "@/stores/useCompanionStore";
import { MANA_COLORS, type ManaColor } from "@/stores/useCompanionStore.types";
import { usePressHold } from "./usePressHold";

interface ManaPoolRailProps {
  playerId: string;
  pool: Partial<Record<ManaColor, number>> | undefined;
}

export function ManaPoolRail({ playerId, pool }: ManaPoolRailProps) {
  const hasAnyMana = pool ? MANA_COLORS.some((c) => (pool[c] ?? 0) > 0) : false;
  if (!hasAnyMana) return null;
  return (
    <div className="flex items-center gap-1 rounded-full bg-black/45 px-1 py-0.5 text-white shadow ring-1 ring-white/10 backdrop-blur">
      {MANA_COLORS.map((color) => {
        const value = pool?.[color] ?? 0;
        if (value === 0) return null;
        return <ManaPip key={color} playerId={playerId} color={color} value={value} />;
      })}
    </div>
  );
}

function ManaPip({
  playerId,
  color,
  value,
}: {
  playerId: string;
  color: ManaColor;
  value: number;
}) {
  const adjustMana = useCompanionStore((s) => s.adjustMana);
  const bindings = usePressHold({
    onTap: () => adjustMana(playerId, color, 1),
    onHoldTick: () => adjustMana(playerId, color, -1),
  });
  return (
    <button
      type="button"
      className={cn(
        "flex items-center gap-0.5 rounded-full px-1 py-0.5 text-[10px] font-semibold hover:bg-white/15",
      )}
      aria-label={`Mana ${color}: ${value} (tap +1, hold -1)`}
      {...bindings}
    >
      <img src={manaSymbolUrl(color)} alt="" className="size-3" draggable={false} />
      <span className="tabular-nums">{value}</span>
    </button>
  );
}
