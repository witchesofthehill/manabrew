import { useCompanionStore } from "@/stores/useCompanionStore";
import type { CompanionPlayer } from "@/stores/useCompanionStore.types";
import { GameIcon } from "./GameIcon";
interface StatusChipsProps {
  player: CompanionPlayer;
}
export function StatusChips({ player }: StatusChipsProps) {
  const isFirstPlayer = useCompanionStore((s) => s.session?.lastFirstPlayerId === player.id);
  return (
    <>
      {isFirstPlayer && (
        <span className="flex max-w-full flex-wrap items-center gap-1 break-words rounded-full bg-emerald-500/90 px-1 py-0.5 text-ui-meta font-semibold text-white @sm:px-1.5">
          <span className="grid min-h-4 min-w-4 place-items-center rounded-full bg-white/25 text-ui-meta font-bold tabular-nums">
            1
          </span>
          <span>Goes first</span>
        </span>
      )}
      {player.isMonarch && (
        <span className="flex max-w-full flex-wrap items-center gap-1 break-words rounded-full bg-amber-400/90 px-1 py-0.5 text-ui-meta font-semibold text-amber-950 @sm:px-1.5">
          <GameIcon icon="crown" className="size-3.5 shrink-0" /> <span>Monarch</span>
        </span>
      )}
      {player.hasInitiative && (
        <span className="flex max-w-full flex-wrap items-center gap-1 break-words rounded-full bg-violet-500/90 px-1 py-0.5 text-ui-meta font-semibold text-white @sm:px-1.5">
          <GameIcon icon="checkered-flag" className="size-3.5 shrink-0" /> <span>Initiative</span>
        </span>
      )}
      {player.hasCityBlessing && (
        <span className="flex max-w-full flex-wrap items-center gap-1 break-words rounded-full bg-sky-500/90 px-1 py-0.5 text-ui-meta font-semibold text-white @sm:px-1.5">
          <GameIcon icon="fairy-wand" className="size-3.5 shrink-0" /> <span>Ascend</span>
        </span>
      )}
      {(player.ringLevel ?? 0) > 0 && (
        <span className="flex max-w-full flex-wrap items-center gap-1 break-words rounded-full bg-yellow-600/90 px-1 py-0.5 text-ui-meta font-semibold text-yellow-50 @sm:px-1.5">
          <GameIcon icon="magic-portal" className="size-3.5 shrink-0" /> <span>Ring</span>
          <span className="tabular-nums">{player.ringLevel}/4</span>
        </span>
      )}
      {(player.speed ?? 0) > 0 && (
        <span className="flex max-w-full flex-wrap items-center gap-1 break-words rounded-full bg-orange-600/90 px-1 py-0.5 text-ui-meta font-semibold text-orange-50 @sm:px-1.5">
          <GameIcon icon="lightning-trio" className="size-3.5 shrink-0" /> <span>Speed</span>
          <span className="tabular-nums">{player.speed}/4</span>
        </span>
      )}
    </>
  );
}
