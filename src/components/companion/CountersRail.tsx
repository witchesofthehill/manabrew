import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCompanionStore } from "@/stores/useCompanionStore";
import type { CompanionCounter } from "@/stores/useCompanionStore.types";
import { CompanionIcon } from "./icons";
import { usePressHold } from "./usePressHold";

interface CountersRailProps {
  playerId: string;
  counters: CompanionCounter[];
  className?: string;
}

export function CountersRail({ playerId, counters, className }: CountersRailProps) {
  if (counters.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {counters.map((counter) => (
        <CounterChip key={counter.id} playerId={playerId} counter={counter} />
      ))}
    </div>
  );
}

function CounterChip({ playerId, counter }: { playerId: string; counter: CompanionCounter }) {
  const adjust = useCompanionStore((s) => s.adjustCounter);
  const remove = useCompanionStore((s) => s.removeCounter);

  const decBindings = usePressHold({
    onTap: () => adjust(playerId, counter.id, -1),
    onHoldTick: () => adjust(playerId, counter.id, -1),
  });
  const incBindings = usePressHold({
    onTap: () => adjust(playerId, counter.id, 1),
    onHoldTick: () => adjust(playerId, counter.id, 1),
  });

  return (
    <div
      className={cn(
        "group flex max-w-full flex-wrap items-center gap-0.5 rounded-full bg-black/45 px-1 py-0.5 text-white shadow ring-1 ring-white/10 backdrop-blur @sm:gap-1 @sm:px-2 @sm:py-1",
      )}
    >
      <button
        type="button"
        className="grid size-6 shrink-0 place-items-center rounded-full text-ui-label hover:bg-white/15 @sm:size-7 touch:min-h-11 touch:min-w-11"
        aria-label={`Decrease ${counter.label}`}
        {...decBindings}
      >
        −
      </button>
      <div className="flex min-w-0 flex-wrap items-center gap-1 break-words px-0.5 text-ui-meta font-medium @sm:px-1">
        <CompanionIcon iconKey={counter.iconKey} className="size-3.5 @sm:size-4" />
        <span className="tabular-nums">{counter.value}</span>
        <span className="opacity-75">{counter.label}</span>
      </div>
      <button
        type="button"
        className="grid size-6 shrink-0 place-items-center rounded-full text-ui-label hover:bg-white/15 @sm:size-7 touch:min-h-11 touch:min-w-11"
        aria-label={`Increase ${counter.label}`}
        {...incBindings}
      >
        +
      </button>
      <button
        type="button"
        className="ml-0.5 grid size-6 shrink-0 place-items-center rounded-full text-ui-label text-white/60 hover:bg-white/15 hover:text-white touch:min-h-11 touch:min-w-11"
        aria-label={`Remove ${counter.label}`}
        onClick={() => remove(playerId, counter.id)}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
