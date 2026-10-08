import { Button } from "@/components/ui/button";
import { useLimitedBoosterTable } from "@/components/limited/useLimitedBoosterTable";
import { LimitedBoosterControl } from "@/components/limited/LimitedBoosterControl";
import { cn } from "@/lib/utils";
import type {
  BoosterOpeningPacket,
  BoosterTearDirection,
} from "@/pixi/limited/LimitedBoosterReveal";
import type { SealedPool } from "@/types/limited";

export function LimitedBoosterTable({
  packs,
  openedIds,
  openingIds,
  disabled,
  compact,
  onOpen,
  className,
}: {
  packs: SealedPool["packs"];
  openedIds: readonly string[];
  openingIds: readonly string[];
  disabled: boolean;
  compact: boolean;
  onOpen: (
    ids: string[],
    direction: BoosterTearDirection | undefined,
    capture: () => BoosterOpeningPacket[],
  ) => void;
  className?: string;
}) {
  const {
    host,
    buttons,
    control,
    unopened,
    open,
    onOpen: openPackets,
    onTear,
    hover,
  } = useLimitedBoosterTable(packs, openedIds, openingIds, disabled, onOpen);
  const span = 1 + (unopened.length - 1) * 0.32;
  const packWidth = 86 / span;
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col items-center justify-center gap-3",
        compact ? "shrink-0" : "flex-1",
        className,
      )}
    >
      <LimitedBoosterControl
        ref={control}
        host={host}
        effectsHost={host}
        buttons={buttons}
        disabled={disabled}
        onOpen={openPackets}
        onTear={onTear}
        onHover={hover}
        label="Unopened boosters"
        className="relative z-[2] shrink-0"
        style={{
          aspectRatio: span / 1.8,
          width: compact
            ? `min(100%, ${span * 90}px, calc((100dvh - 255px) * ${span / 1.8}))`
            : `min(100%, 680px, calc((100dvh - 250px) * ${span / 1.8}))`,
        }}
        targets={unopened.map(({ pack, number, angle }, index) => ({
          id: pack.id,
          label: `Open booster ${number}${pack.setCode ? `, ${pack.setCode.toUpperCase()}` : ""}`,
          className: cn(
            "aspect-[5/7] transition-[translate] duration-150 motion-safe:enabled:hover:-translate-y-2 motion-safe:enabled:focus-visible:-translate-y-2",
            openingIds.includes(pack.id) && "invisible",
          ),
          style: {
            width: `${packWidth}%`,
            left: `${7 + index * packWidth * 0.32}%`,
            top: `${7 + (unopened.length > 1 ? (index / (unopened.length - 1)) * 12 : 0)}%`,
            zIndex: index,
            transform: `rotate(${angle}rad)`,
          },
        }))}
      >
        {(selectedIds) => (
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <p
              className={cn(
                "text-center text-xs text-muted-foreground",
                compact && "[@media(orientation:landscape)_and_(max-height:600px)]:hidden",
              )}
              aria-live="polite"
            >
              {selectedIds.length
                ? `${selectedIds.length} selected · Release to open`
                : "Drag to tear · Tap to open"}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => open(unopened.map(({ pack }) => pack.id))}
            >
              Open remaining
            </Button>
          </div>
        )}
      </LimitedBoosterControl>
    </div>
  );
}
