import type { CompanionPlayer } from "@/stores/useCompanionStore.types";
import { GameIcon } from "./GameIcon";

interface StatusChipsProps {
  player: CompanionPlayer;
}

export function StatusChips({ player }: StatusChipsProps) {
  return (
    <>
      {player.isMonarch && (
        <span className="flex items-center gap-1 rounded-full bg-amber-400/90 px-1 py-0.5 text-[9px] font-semibold text-amber-950 @sm:px-1.5 @sm:text-[10px]">
          <GameIcon icon="crown" className="size-2.5 @sm:size-3" />{" "}
          <span className="hidden @xs:inline">Monarch</span>
        </span>
      )}
      {player.hasInitiative && (
        <span className="flex items-center gap-1 rounded-full bg-violet-500/90 px-1 py-0.5 text-[9px] font-semibold text-white @sm:px-1.5 @sm:text-[10px]">
          <GameIcon icon="checkered-flag" className="size-2.5 @sm:size-3" />{" "}
          <span className="hidden @xs:inline">Initiative</span>
        </span>
      )}
      {player.hasCityBlessing && (
        <span className="flex items-center gap-1 rounded-full bg-sky-500/90 px-1 py-0.5 text-[9px] font-semibold text-white @sm:px-1.5 @sm:text-[10px]">
          <GameIcon icon="fairy-wand" className="size-2.5 @sm:size-3" />{" "}
          <span className="hidden @xs:inline">Ascend</span>
        </span>
      )}
    </>
  );
}
