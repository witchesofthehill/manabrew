import type { CSSProperties } from "react";
import type { GameCard } from "@/types/manabrew";
import { Card } from "@/components/game/Card";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";

interface CommandZoneTileProps {
  commanders: GameCard[];
  /** Invoked when the first commander is playable and the user clicks it
   *  (no drag movement). Same semantic as a hand-card tap-to-cast. */
  onCastCommander?: (cardId: string) => void;
  /** Begin a drag-to-cast gesture on mousedown. Mirrors the hand-card
   *  drag: the handler decides whether the motion becomes a drag or
   *  collapses to a click, so the tile just forwards the event. */
  onStartDrag?: (card: GameCard, e: React.MouseEvent) => void;
  /** Fallback click (e.g. open zone modal) when no cast is available. */
  onOpenZone?: () => void;
  onHoverCard?: (card: GameCard | null, e?: React.MouseEvent) => void;
  /** Id of the card currently being drag-cast. When it matches the
   *  shown commander, the tile renders an empty placeholder — mirrors
   *  the hand's "lift" behaviour so the zone reads as emptied while the
   *  ghost is in flight. */
  draggingCardId?: string | null;
}

const COMMANDER_CARD_SIZE = "w-[72px] h-[100px] shrink-0" as const;

export function CommandZoneTile({
  commanders,
  onCastCommander,
  onStartDrag,
  onOpenZone,
  onHoverCard,
  draggingCardId,
}: CommandZoneTileProps) {
  const themeColors = useTheme().gameTheme;
  const first = commanders[0];
  const count = commanders.length;
  if (!first) return null;

  // While the commander is being drag-cast, render a dashed empty slot
  // in-place so the cluster layout stays stable but the zone reads as
  // emptied (matching the hand's gap-when-dragging behaviour).
  if (draggingCardId && draggingCardId === first.id) {
    return (
      <div
        className="relative h-[100px] w-[72px] shrink-0 rounded-md border-2 border-dashed border-muted-foreground/45 bg-muted/10"
        aria-hidden="true"
      />
    );
  }

  const canCast = first.isPlayable && !!onCastCommander;

  // Mousedown initiates the drag-to-cast flow when the commander is
  // playable; the drag hook decides whether the gesture resolves as a
  // cast (release over battlefield OR no movement). Non-playable state
  // still supports a plain click to open the zone viewer.
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (canCast && onStartDrag) {
      onStartDrag(first, e);
    }
  };

  const handleClick = canCast ? undefined : onOpenZone;

  return (
    <div
      className="relative shrink-0"
      data-card-id={first.id}
      onMouseEnter={onHoverCard ? (e) => onHoverCard(first, e) : undefined}
      onMouseLeave={onHoverCard ? () => onHoverCard(null) : undefined}
    >
      <Card
        card={first}
        className={cn(COMMANDER_CARD_SIZE, canCast && "ring-2 cursor-grab playable-card")}
        style={canCast ? ({ "--tw-ring-color": themeColors.cardRing } as CSSProperties) : undefined}
        onClick={handleClick}
      />
      {/* Invisible mousedown surface on top of the Card so the drag
          hook sees the original event (Card's onClick path can't carry
          the mouse-move subscription for us). Pointer events fall
          through onClick when canCast is false via handleClick. */}
      {canCast && <div className="absolute inset-0 cursor-grab" onMouseDown={handleMouseDown} />}
      {count > 1 && (
        <span className="absolute -right-1 -top-1 rounded-full bg-black/80 px-1 text-[10px] font-bold leading-none text-white shadow ring-1 ring-black/40">
          ×{count}
        </span>
      )}
    </div>
  );
}
