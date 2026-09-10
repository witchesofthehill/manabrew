import { useCompanionStore } from "@/stores/useCompanionStore";
import type { CompanionPlayer } from "@/stores/useCompanionStore.types";
import { GameIcon } from "./GameIcon";
import { Trans } from "@lingui/react/macro";
interface StatusChipsProps {
  player: CompanionPlayer;
}
export function StatusChips({ player }: StatusChipsProps) {
  const isFirstPlayer = useCompanionStore((s) => s.session?.lastFirstPlayerId === player.id);
  return (
    <>
      {isFirstPlayer && (
        <span className="flex items-center gap-1 rounded-full bg-emerald-500/90 px-1 py-0.5 text-[9px] font-semibold text-white @sm:px-1.5 @sm:text-[10px]">
          <span className="grid size-3 place-items-center rounded-full bg-white/25 text-[8px] font-bold tabular-nums @sm:size-3.5 @sm:text-[9px]">
            1
          </span>
          <span className="hidden @xs:inline">
            <Trans>Goes first</Trans>
          </span>
        </span>
      )}
      {player.isMonarch && (
        <span className="flex items-center gap-1 rounded-full bg-amber-400/90 px-1 py-0.5 text-[9px] font-semibold text-amber-950 @sm:px-1.5 @sm:text-[10px]">
          <GameIcon icon="crown" className="size-2.5 @sm:size-3" />{" "}
          <span className="hidden @xs:inline">
            <Trans>Monarch</Trans>
          </span>
        </span>
      )}
      {player.hasInitiative && (
        <span className="flex items-center gap-1 rounded-full bg-violet-500/90 px-1 py-0.5 text-[9px] font-semibold text-white @sm:px-1.5 @sm:text-[10px]">
          <GameIcon icon="checkered-flag" className="size-2.5 @sm:size-3" />{" "}
          <span className="hidden @xs:inline">
            <Trans>Initiative</Trans>
          </span>
        </span>
      )}
      {player.hasCityBlessing && (
        <span className="flex items-center gap-1 rounded-full bg-sky-500/90 px-1 py-0.5 text-[9px] font-semibold text-white @sm:px-1.5 @sm:text-[10px]">
          <GameIcon icon="fairy-wand" className="size-2.5 @sm:size-3" />{" "}
          <span className="hidden @xs:inline">
            <Trans>Ascend</Trans>
          </span>
        </span>
      )}
      {(player.ringLevel ?? 0) > 0 && (
        <span className="flex items-center gap-1 rounded-full bg-yellow-600/90 px-1 py-0.5 text-[9px] font-semibold text-yellow-50 @sm:px-1.5 @sm:text-[10px]">
          <GameIcon icon="magic-portal" className="size-2.5 @sm:size-3" />{" "}
          <span className="hidden @xs:inline">
            <Trans>Ring</Trans>
          </span>
          <span className="tabular-nums">{player.ringLevel}/4</span>
        </span>
      )}
      {(player.speed ?? 0) > 0 && (
        <span className="flex items-center gap-1 rounded-full bg-orange-600/90 px-1 py-0.5 text-[9px] font-semibold text-orange-50 @sm:px-1.5 @sm:text-[10px]">
          <GameIcon icon="lightning-trio" className="size-2.5 @sm:size-3" />{" "}
          <span className="hidden @xs:inline">
            <Trans>Speed</Trans>
          </span>
          <span className="tabular-nums">{player.speed}/4</span>
        </span>
      )}
    </>
  );
}
