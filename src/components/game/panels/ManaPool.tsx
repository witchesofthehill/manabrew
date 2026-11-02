import { ManaSymbols } from "@/components/game/ManaSymbols";
import { MANA_KEYS } from "../game.constants";
import { useTheme } from "@/hooks/useTheme";

export function ManaPool({ pool }: { pool: Record<string, number> }) {
  const fontSizes = useTheme().gameTheme.fontSizes;
  return (
    <div className="flex flex-row items-center gap-1 flex-wrap">
      {MANA_KEYS.flatMap((key) => {
        const count = pool[key] ?? 0;
        if (count === 0) return [];
        return [
          <span key={key} className="inline-flex flex-row items-center gap-0.5 flex-nowrap">
            <span
              className="text-ui-meta font-extrabold text-white leading-none tabular-nums"
              style={{ fontSize: `max(${fontSizes.manaCount}px, var(--text-ui-meta))` }}
            >
              {count}
            </span>
            <ManaSymbols cost={key} size="lg" />
          </span>,
        ];
      })}
    </div>
  );
}
