import { Card } from "@/components/game/Card";
import { Badge } from "@/components/ui/badge";
import { Modal } from "./Modal";
import type { StackObjectDto } from "@/protocol/game";
import { cn } from "@/lib/utils";
import { stackObjectToCardStub } from "../game.utils";
import { useCardPreview } from "@/hooks/useCardPreview";
import { HoverCardPreview } from "@/components/game/HoverCardPreview";
import { MODAL_CARD_SIZE } from "../game.styles";
import { useTheme } from "@/hooks/useTheme";
import { withAlpha } from "@/themes/gameTheme";
import type { CSSProperties } from "react";
import { Button } from "@/components/ui/button";

interface SpellStackModalProps {
  stack: StackObjectDto[];
  /** Stack entry IDs the player may target (counter). Empty means view-only. */
  validSpellIds: string[];
  onTarget: (spellId: string) => void;
  onCancel: () => void;
  /** Maps controllerId → player seat color for per-player glow. */
  playerColorMap?: Map<string, string>;
}

export function SpellStackModal({
  stack,
  validSpellIds,
  onTarget,
  onCancel,
  playerColorMap,
}: SpellStackModalProps) {
  const preview = useCardPreview();

  const themeColors = useTheme().gameTheme;
  const ringColor = themeColors.cardRing;

  const isTargeting = validSpellIds.length > 0;

  // Display newest (top of stack) first — stack[last] = top, stack[0] = bottom
  const displayStack = [...stack].reverse();

  return (
    <Modal onClose={onCancel} maxWidth="max-w-3xl" maxHeight="max-h-[85vh]">
      <Modal.Header>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-base">
              {isTargeting ? "Choose a Spell to Counter" : "Spells on the Stack"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {stack.length} spell{stack.length !== 1 ? "s" : ""} on the stack
              {" · "}
              Top of stack is shown first
            </p>
          </div>
          {isTargeting && <Badge variant="secondary">{validSpellIds.length} targetable</Badge>}
        </div>
      </Modal.Header>

      {isTargeting && (
        <Modal.Instructions>Click a highlighted spell to counter it.</Modal.Instructions>
      )}

      <Modal.Body>
        {stack.length === 0 ? (
          <Modal.EmptyState message="The stack is empty." />
        ) : (
          <div className="flex flex-wrap gap-6 content-start justify-center">
            {displayStack.map((obj, idx) => {
              const isValid = validSpellIds.includes(obj.id);
              const cardStub = stackObjectToCardStub(obj);
              const isTop = idx === 0;
              const seatColor = playerColorMap?.get(obj.controllerId);
              const glowStyle: CSSProperties = {
                ...(seatColor
                  ? {
                      boxShadow: `0 0 0 2px ${withAlpha(seatColor, 0.7)}, 0 0 14px ${withAlpha(seatColor, 0.45)}`,
                    }
                  : {}),
                ...(isValid ? ({ "--tw-ring-color": ringColor } as CSSProperties) : {}),
              };
              return (
                <div
                  key={obj.id}
                  className={cn(
                    "shrink-0 flex flex-col items-center gap-1 group",
                    isValid ? "cursor-pointer" : "cursor-default",
                    !isValid && isTargeting && "opacity-50",
                  )}
                  onMouseEnter={(e) => preview.handleMouseEnter(cardStub, e)}
                  onMouseLeave={preview.handleMouseLeave}
                  onClick={isValid ? () => onTarget(obj.id) : undefined}
                >
                  <Card
                    card={cardStub}
                    className={cn(
                      MODAL_CARD_SIZE,
                      "transition-transform",
                      isValid && "ring-2 group-hover:scale-105 group-hover:-translate-y-2",
                    )}
                    style={Object.keys(glowStyle).length > 0 ? glowStyle : undefined}
                  />
                  <div className="flex items-center gap-1">
                    <Badge variant={isTop ? "default" : "outline"} className="text-[10px] h-4 px-1">
                      {isTop ? "TOP" : `+${idx}`}
                    </Badge>
                    {obj.isCasting && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1">
                        Casting
                      </Badge>
                    )}
                    {isValid && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] h-4 px-1"
                        style={{ color: ringColor }}
                      >
                        ← Counter
                      </Badge>
                    )}
                  </div>
                  {obj.text && (
                    <p className="text-[10px] text-muted-foreground text-center max-w-[100px] line-clamp-3 leading-tight">
                      {obj.text}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button variant="outline" size="sm" onClick={onCancel}>
          {isTargeting ? "Cancel" : "Close"}
        </Button>
      </Modal.Footer>

      <HoverCardPreview preview={preview} />
    </Modal>
  );
}
