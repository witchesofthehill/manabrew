import { useRef, useState } from "react";
import type { CardDto } from "@/protocol/game";

interface UseHandDragOptions {
  battlefieldContainerRef: React.RefObject<HTMLDivElement | null>;
  handDropExclusionPx?: number;
  onCastSpell: (cardId: string) => void;
  dismissHover: () => void;
}

export function useHandDrag({
  battlefieldContainerRef,
  handDropExclusionPx = 0,
  onCastSpell,
  dismissHover,
}: UseHandDragOptions) {
  const [draggingHandCard, setDraggingHandCard] = useState<CardDto | null>(null);
  const [ghostPos, setGhostPos] = useState({ x: 0, y: 0 });
  const [isOverBattlefield, setIsOverBattlefield] = useState(false);
  const isOverBattlefieldRef = useRef(false);

  function startHandCardDrag(card: CardDto, e: React.MouseEvent) {
    dismissHover();
    // Don't enter drag state yet — the card should stay in the hand until
    // the user has actually dragged past the dead-zone. Otherwise a simple
    // click to cast briefly hides the hand sprite + pops a floating ghost,
    // which reads as "the card is leaving the hand before I've released".

    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const handleMouseMove = (me: MouseEvent) => {
      if (!moved) {
        const dx = me.clientX - startX;
        const dy = me.clientY - startY;
        if (dx * dx + dy * dy < 25) return; // 5px dead zone for taps
        moved = true;
        // Transitioning into drag now that we've crossed the threshold.
        setDraggingHandCard(card);
      }
      // Hard-disable hover preview during drag; hover timers can be re-armed by
      // underlying mouseenter events while the cursor crosses cards.
      dismissHover();
      setGhostPos({ x: me.clientX, y: me.clientY });

      if (battlefieldContainerRef.current) {
        const rect = battlefieldContainerRef.current.getBoundingClientRect();
        let over =
          me.clientX >= rect.left &&
          me.clientX <= rect.right &&
          me.clientY >= rect.top &&
          me.clientY <= rect.bottom;

        if (over && handDropExclusionPx > 0) {
          const overHandStrip = me.clientY >= rect.bottom - handDropExclusionPx;
          if (overHandStrip) over = false;
        }

        isOverBattlefieldRef.current = over;
        setIsOverBattlefield(over);
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);

      if (!moved) {
        onCastSpell(card.id);
      } else if (isOverBattlefieldRef.current) {
        onCastSpell(card.id);
      }

      setDraggingHandCard(null);
      setIsOverBattlefield(false);
      isOverBattlefieldRef.current = false;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  return { draggingHandCard, ghostPos, isOverBattlefield, startHandCardDrag };
}
