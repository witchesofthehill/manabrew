import { memo, useEffect, useState, type CSSProperties } from "react";
import { Card } from "@/components/game/Card";
import { cn } from "@/lib/utils";
import { withAlpha } from "@/themes/gameTheme";
import { useTheme } from "@/hooks/useTheme";
import type { GameCard, StackObject } from "@/types/manabrew";
import { useStackUIStore } from "@/stores/useStackUIStore";

interface StackDisplayProps {
  stack: StackObject[];
  resolveStackCard: (stackItem: StackObject) => GameCard;
  onOpenStack: () => void;
  flashCard?: GameCard | null;
  flashToken?: string | null;
  showPreStackFlash?: boolean;
  rightPanelCollapsed?: boolean;
  rightInsetExtra?: string;
  playerColorMap?: Map<string, string>;
  validSpellIds?: string[];
  onTargetSpell?: (spellId: string) => void;
}

const STACK_CARD_ASPECT = 7 / 5;
// w-72 panel (288px) + its right-1.5 gap (~6px) + a breathing gap.
const STACK_RIGHT_WHEN_PANEL_OPEN = 288 + 6 + 8;
const STACK_RIGHT_WHEN_PANEL_COLLAPSED = 10;
const STACK_UI = {
  direction: "left" as "left" | "right",
  cardWidth: 220,
  offsetX: 36,
  offsetY: 4,
  centerOffsetY: -60,
  hoverPushX: 60,
} as const;

function StackDisplayImpl({
  stack,
  resolveStackCard,
  onOpenStack,
  flashCard,
  flashToken,
  showPreStackFlash = true,
  rightPanelCollapsed = true,
  rightInsetExtra,
  playerColorMap,
  validSpellIds,
  onTargetSpell,
}: StackDisplayProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const setHoveredStackObjectId = useStackUIStore((s) => s.setHoveredStackObjectId);
  const themeColors = useTheme().gameTheme;
  const targetingActive = (validSpellIds?.length ?? 0) > 0;
  const validSpellIdSet = new Set(validSpellIds ?? []);
  const stackIdsKey = stack.map((obj) => obj.id).join(",");
  const [prevStackIds, setPrevStackIds] = useState<Set<string>>(
    () => new Set(stack.map((obj) => obj.id)),
  );
  const enteringIds = new Set(
    stack.filter((obj) => !prevStackIds.has(obj.id)).map((obj) => obj.id),
  );

  const hoveredIndex = hoveredId ? stack.findIndex((obj) => obj.id === hoveredId) : -1;
  const flashStackIndex = flashCard ? stack.findIndex((obj) => obj.sourceId === flashCard.id) : -1;
  const directionSign = STACK_UI.direction === "right" ? 1 : -1;
  const cardHeight = Math.round(STACK_UI.cardWidth * STACK_CARD_ASPECT);
  const totalItems = stack.length;
  const spanX = Math.max(0, totalItems - 1) * STACK_UI.offsetX;
  const pileHeight = cardHeight + Math.max(0, totalItems - 1) * Math.abs(STACK_UI.offsetY);

  const baseLefts = stack.map((_, idx) => idx * STACK_UI.offsetX * directionSign);
  const lefts =
    hoveredIndex < 0
      ? baseLefts
      : stack.map((_, idx) => {
          if (idx === hoveredIndex) return baseLefts[idx];
          const pushSign = (idx < hoveredIndex ? -1 : 1) * directionSign;
          return baseLefts[idx] + pushSign * STACK_UI.hoverPushX;
        });
  // Bounds fixed by direction so hover transitions don't snap/rebase.
  const fixedMinLeft =
    STACK_UI.direction === "right" ? -STACK_UI.hoverPushX : -spanX - STACK_UI.hoverPushX;
  const fixedMaxLeft =
    STACK_UI.direction === "right" ? spanX + STACK_UI.hoverPushX : STACK_UI.hoverPushX;
  const xShift = -fixedMinLeft;
  const pileWidth = fixedMaxLeft - fixedMinLeft + STACK_UI.cardWidth;
  const top = `calc(50% - ${pileHeight / 2}px + ${STACK_UI.centerOffsetY}px)`;

  const [prevStackIdsKey, setPrevStackIdsKey] = useState(stackIdsKey);
  if (prevStackIdsKey !== stackIdsKey) {
    setPrevStackIdsKey(stackIdsKey);
    setPrevStackIds(new Set(stack.map((obj) => obj.id)));
  }

  const topForIndex = (idx: number) => (stack.length - 1 - idx) * STACK_UI.offsetY;

  const [prevLayout, setPrevLayout] = useState<Record<string, { left: number; top: number }>>({});
  const layoutKey = stack.map((obj, idx) => `${obj.id}:${lefts[idx] + xShift}:${idx}`).join("|");
  const [prevLayoutKey, setPrevLayoutKey] = useState(layoutKey);
  if (prevLayoutKey !== layoutKey) {
    setPrevLayoutKey(layoutKey);
    const nextLayout: Record<string, { left: number; top: number }> = {};
    stack.forEach((obj, idx) => {
      nextLayout[obj.id] = {
        left: lefts[idx] + xShift,
        top: topForIndex(idx),
      };
    });
    setPrevLayout(nextLayout);
  }

  useEffect(() => {
    return () => setHoveredStackObjectId(null);
  }, [setHoveredStackObjectId]);

  if (stack.length === 0 && !flashCard) return null;

  const baseRightInset = rightPanelCollapsed
    ? STACK_RIGHT_WHEN_PANEL_COLLAPSED
    : STACK_RIGHT_WHEN_PANEL_OPEN;
  const rightInset = rightInsetExtra
    ? `calc(${baseRightInset}px + ${rightInsetExtra})`
    : `${baseRightInset}px`;

  return (
    <div
      data-stack-panel
      className={cn("pointer-events-auto absolute z-40 transition-[right] duration-200")}
      style={{ top, right: rightInset }}
    >
      <div
        className="relative"
        style={{ height: `${pileHeight}px`, width: `${pileWidth}px` }}
        onMouseLeave={() => {
          setHoveredId(null);
          setHoveredStackObjectId(null);
        }}
      >
        {stack.map((obj, idx) => {
          const card = resolveStackCard(obj);
          const isHovered = hoveredId === obj.id;
          const isTopOfStack = idx === stack.length - 1;
          const isFlashedStackCard = flashStackIndex === idx;
          const targetLeft = lefts[idx] + xShift;
          const targetTop = topForIndex(idx);
          const prev = prevLayout[obj.id];
          const hasPositionChange = !prev || prev.left !== targetLeft || prev.top !== targetTop;
          const zIndex =
            hoveredIndex < 0
              ? idx + 1
              : 200 - Math.abs(idx - hoveredIndex) * 10 + (isHovered ? 5 : 0);
          const seatColor = playerColorMap?.get(obj.controllerId);
          const isValidTarget = targetingActive && validSpellIdSet.has(obj.id);
          const isDimmed = targetingActive && !isValidTarget;
          const cardStyle: CSSProperties = {
            ...(seatColor
              ? {
                  boxShadow: `0 0 0 2px ${withAlpha(seatColor, 0.7)}, 0 0 14px ${withAlpha(seatColor, 0.45)}`,
                  borderRadius: "inherit",
                }
              : {}),
            ...(isValidTarget
              ? ({ "--tw-ring-color": themeColors.cardRing } as CSSProperties)
              : {}),
          };
          return (
            <div
              key={obj.id}
              data-stack-object-id={obj.id}
              data-card-id={obj.sourceId}
              data-casting-card={obj.isCasting ? obj.sourceId : undefined}
              className={cn(
                "absolute left-0 will-change-transform",
                hasPositionChange
                  ? "transition-[left,top,transform] duration-560 ease-[cubic-bezier(0.23,0.63,0.32,1)]"
                  : "transition-transform duration-560 ease-[cubic-bezier(0.23,0.63,0.32,1)]",
                isHovered && "-translate-y-2 scale-105",
                isDimmed && "opacity-60",
              )}
              style={{
                left: `${targetLeft}px`,
                top: `${targetTop}px`,
                zIndex,
                width: `${STACK_UI.cardWidth}px`,
                height: `${cardHeight}px`,
              }}
              onMouseEnter={() => {
                setHoveredId(obj.id);
                setHoveredStackObjectId(obj.id);
              }}
              onClick={() => {
                if (isValidTarget && onTargetSpell) onTargetSpell(obj.id);
                else onOpenStack();
              }}
            >
              <Card
                card={card}
                className={cn(
                  "w-full h-full cursor-pointer",
                  obj.isCasting && "casting-card",
                  isFlashedStackCard && "animate-card-stack-flash-in",
                  enteringIds.has(obj.id) && !isFlashedStackCard && "animate-card-stack-enter",
                  isTopOfStack && !obj.isCasting && "playable-card",
                  isValidTarget && "ring-4",
                )}
                style={cardStyle}
              />
            </div>
          );
        })}

        {flashCard && flashStackIndex < 0 && showPreStackFlash && (
          <div
            key={flashToken ?? flashCard.id}
            className="absolute top-0 pointer-events-none animate-card-flash"
            style={{
              zIndex: 200,
              // Align with the newest card's slot, not the container corner, so
              // it doesn't overlap the top card when the stack is non-empty.
              left: `${stack.length > 0 ? (lefts[stack.length - 1] ?? 0) + xShift : 0}px`,
              top: "0px",
              width: `${STACK_UI.cardWidth}px`,
              height: `${cardHeight}px`,
            }}
          >
            <Card card={flashCard} className="w-full h-full shadow-2xl" />
          </div>
        )}
      </div>
    </div>
  );
}

export const StackDisplay = memo(StackDisplayImpl);
