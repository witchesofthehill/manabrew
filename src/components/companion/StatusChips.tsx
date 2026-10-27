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
        <span className="flex max-w-full flex-wrap items-center gap-1 break-words rounded-full bg-emerald-500/90 px-1 py-0.5 text-ui-meta font-semibold text-white @sm:px-1.5 non-touch:text-[9px] non-touch:@sm:text-[10px] non-touch:leading-[inherit]">
          <span className="grid min-h-4 min-w-4 place-items-center rounded-full bg-white/25 text-ui-meta font-bold tabular-nums non-touch:text-[8px] non-touch:@sm:text-[9px] non-touch:leading-[inherit] non-touch:size-3 non-touch:min-h-0 non-touch:min-w-0 non-touch:@sm:size-3.5">
            1
          </span>
          <span className="non-touch:hidden non-touch:@xs:inline">Goes first</span>
        </span>
      )}
      {player.isMonarch && (
        <span className="flex max-w-full flex-wrap items-center gap-1 break-words rounded-full bg-amber-400/90 px-1 py-0.5 text-ui-meta font-semibold text-amber-950 @sm:px-1.5 non-touch:text-[9px] non-touch:@sm:text-[10px] non-touch:leading-[inherit]">
          <GameIcon
            icon="crown"
            className="size-3.5 shrink-0 non-touch:size-2.5 non-touch:@sm:size-3"
          />{" "}
          <span className="non-touch:hidden non-touch:@xs:inline">Monarch</span>
        </span>
      )}
      {player.hasInitiative && (
        <span className="flex max-w-full flex-wrap items-center gap-1 break-words rounded-full bg-violet-500/90 px-1 py-0.5 text-ui-meta font-semibold text-white @sm:px-1.5 non-touch:text-[9px] non-touch:@sm:text-[10px] non-touch:leading-[inherit]">
          <GameIcon
            icon="checkered-flag"
            className="size-3.5 shrink-0 non-touch:size-2.5 non-touch:@sm:size-3"
          />{" "}
          <span className="non-touch:hidden non-touch:@xs:inline">Initiative</span>
        </span>
      )}
      {player.hasCityBlessing && (
        <span className="flex max-w-full flex-wrap items-center gap-1 break-words rounded-full bg-sky-500/90 px-1 py-0.5 text-ui-meta font-semibold text-white @sm:px-1.5 non-touch:text-[9px] non-touch:@sm:text-[10px] non-touch:leading-[inherit]">
          <GameIcon
            icon="fairy-wand"
            className="size-3.5 shrink-0 non-touch:size-2.5 non-touch:@sm:size-3"
          />{" "}
          <span className="non-touch:hidden non-touch:@xs:inline">Ascend</span>
        </span>
      )}
      {(player.ringLevel ?? 0) > 0 && (
        <span className="flex max-w-full flex-wrap items-center gap-1 break-words rounded-full bg-yellow-600/90 px-1 py-0.5 text-ui-meta font-semibold text-yellow-50 @sm:px-1.5 non-touch:text-[9px] non-touch:@sm:text-[10px] non-touch:leading-[inherit]">
          <GameIcon
            icon="magic-portal"
            className="size-3.5 shrink-0 non-touch:size-2.5 non-touch:@sm:size-3"
          />{" "}
          <span className="non-touch:hidden non-touch:@xs:inline">Ring</span>
          <span className="tabular-nums">{player.ringLevel}/4</span>
        </span>
      )}
      {(player.speed ?? 0) > 0 && (
        <span className="flex max-w-full flex-wrap items-center gap-1 break-words rounded-full bg-orange-600/90 px-1 py-0.5 text-ui-meta font-semibold text-orange-50 @sm:px-1.5 non-touch:text-[9px] non-touch:@sm:text-[10px] non-touch:leading-[inherit]">
          <GameIcon
            icon="lightning-trio"
            className="size-3.5 shrink-0 non-touch:size-2.5 non-touch:@sm:size-3"
          />{" "}
          <span className="non-touch:hidden non-touch:@xs:inline">Speed</span>
          <span className="tabular-nums">{player.speed}/4</span>
        </span>
      )}
    </>
  );
}
