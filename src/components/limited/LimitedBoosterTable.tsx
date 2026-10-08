import { Button } from "@/components/ui/button";
import { useLimitedBoosterTable } from "@/components/limited/useLimitedBoosterTable";
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
  const { host, buttons, unopened, open, hover, selectedIds, handlers } = useLimitedBoosterTable(
    packs,
    openedIds,
    openingIds,
    disabled,
    onOpen,
  );
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
      <div
        ref={host}
        role="group"
        aria-label="Unopened boosters"
        {...handlers}
        className="relative z-[2] shrink-0"
        style={{
          aspectRatio: span / 1.8,
          width: compact
            ? `min(100%, ${span * 90}px, calc((100dvh - 255px) * ${span / 1.8}))`
            : `min(100%, 680px, calc((100dvh - 250px) * ${span / 1.8}))`,
        }}
      >
        {unopened.map(({ pack, number, angle }, index) => (
          <button
            key={pack.id}
            ref={(button) => {
              if (button) buttons.current.set(pack.id, button);
              else buttons.current.delete(pack.id);
            }}
            type="button"
            data-limited-pack-id={pack.id}
            disabled={disabled}
            aria-label={`Open booster ${number}${pack.setCode ? `, ${pack.setCode.toUpperCase()}` : ""}`}
            aria-pressed={selectedIds.includes(pack.id)}
            onClick={(event) =>
              open(event.shiftKey ? unopened.map(({ pack }) => pack.id) : [pack.id])
            }
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") hover(pack.id, true);
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") hover(pack.id, false);
            }}
            onFocus={() => hover(pack.id, true)}
            onBlur={() => hover(pack.id, false)}
            className={cn(
              "group absolute aspect-[5/7] cursor-pointer touch-none rounded-lg transition-[translate] duration-150 motion-safe:enabled:hover:-translate-y-2 motion-safe:enabled:focus-visible:-translate-y-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:cursor-wait",
              openingIds.includes(pack.id) && "invisible",
            )}
            style={{
              width: `${packWidth}%`,
              left: `${7 + index * packWidth * 0.32}%`,
              top: `${7 + (unopened.length > 1 ? (index / (unopened.length - 1)) * 12 : 0)}%`,
              zIndex: index,
              transform: `rotate(${angle}rad)`,
            }}
          >
            <span className="pointer-events-none absolute inset-x-[8%] top-[10%] h-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-foreground/10 to-transparent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          </button>
        ))}
      </div>
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
            : "Tap a pack. Swipe across to open several."}
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
    </div>
  );
}
