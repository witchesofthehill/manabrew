import type { CSSProperties } from "react";
import type { GameCard } from "@/types/manabrew";
import { Card } from "@/components/game/Card";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";

interface CommandZoneTileProps {
  commanders: GameCard[];
  onCastCommander?: (cardId: string) => void;
  onStartDrag?: (card: GameCard, e: React.MouseEvent) => void;
  onOpenZone?: () => void;
  onHoverCard?: (card: GameCard | null, e?: React.MouseEvent) => void;
}

const COMMANDER_CARD_SIZE = "w-[72px] h-[100px] shrink-0" as const;

export function CommandZoneTile({
  commanders,
  onCastCommander,
  onStartDrag,
  onOpenZone,
  onHoverCard,
}: CommandZoneTileProps) {
  const themeColors = useTheme().gameTheme;
  const first = commanders[0];
  const count = commanders.length;
  if (!first) return null;

  const canCast = first.isPlayable && !!onCastCommander;

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
