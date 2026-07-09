import { useEffect, useRef, useState } from "react";
import type { CardDto } from "@/protocol/game";
import { LONG_PRESS_CANCEL_DIST_SQ } from "@/lib/responsive";
import { LongPressTimer } from "@/lib/longPress";

export interface HandDragStart {
  clientX: number;
  clientY: number;
  pointerId: number;
  pointerType: string;
}

interface UseHandDragOptions {
  battlefieldContainerRef: React.RefObject<HTMLDivElement | null>;
  handDropExclusionPx?: number;
  onCastSpell: (cardId: string) => void;
  dismissHover: () => void;
  onLongPress?: (card: CardDto, pos: { x: number; y: number }) => void;
}

export function useHandDrag({
  battlefieldContainerRef,
  handDropExclusionPx = 0,
  onCastSpell,
  dismissHover,
  onLongPress,
}: UseHandDragOptions) {
  const [draggingHandCard, setDraggingHandCard] = useState<CardDto | null>(null);
  const [ghostPos, setGhostPos] = useState({ x: 0, y: 0 });
  const [isOverBattlefield, setIsOverBattlefield] = useState(false);
  const isOverBattlefieldRef = useRef(false);
  const teardownRef = useRef<(() => void) | null>(null);

  useEffect(() => () => teardownRef.current?.(), []);

  function startHandCardDrag(card: CardDto, start: HandDragStart) {
    dismissHover();
    teardownRef.current?.();
    // Don't enter drag state yet — the card should stay in the hand until
    // the user has actually dragged past the dead-zone. Otherwise a simple
    // click to cast briefly hides the hand sprite + pops a floating ghost,
    // which reads as "the card is leaving the hand before I've released".

    const isTouch = start.pointerType === "touch";
    const deadZoneSq = isTouch ? LONG_PRESS_CANCEL_DIST_SQ : 25;
    let moved = false;
    const longPress = new LongPressTimer();

    const reset = () => {
      setDraggingHandCard(null);
      setIsOverBattlefield(false);
      isOverBattlefieldRef.current = false;
    };

    const teardown = () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerCancel);
      document.removeEventListener("pointerdown", handleSecondPointerDown);
      longPress.cancel();
      teardownRef.current = null;
    };

    // A second finger means a pinch, not a cast — abort without releasing the
    // spell over the battlefield.
    const handleSecondPointerDown = (pe: PointerEvent) => {
      if (pe.pointerId === start.pointerId) return;
      teardown();
      reset();
    };

    const handlePointerMove = (pe: PointerEvent) => {
      if (pe.pointerId !== start.pointerId) return;
      longPress.move(pe.clientX, pe.clientY);
      if (!moved) {
        const dx = pe.clientX - start.clientX;
        const dy = pe.clientY - start.clientY;
        if (dx * dx + dy * dy < deadZoneSq) return;
        moved = true;
        longPress.cancel();
        setDraggingHandCard(card);
      }
      // Hard-disable hover preview during drag; hover timers can be re-armed by
      // underlying mouseenter events while the cursor crosses cards.
      dismissHover();
      setGhostPos({ x: pe.clientX, y: pe.clientY });

      if (battlefieldContainerRef.current) {
        const rect = battlefieldContainerRef.current.getBoundingClientRect();
        let over =
          pe.clientX >= rect.left &&
          pe.clientX <= rect.right &&
          pe.clientY >= rect.top &&
          pe.clientY <= rect.bottom;

        if (over && handDropExclusionPx > 0) {
          const overHandStrip = pe.clientY >= rect.bottom - handDropExclusionPx;
          if (overHandStrip) over = false;
        }

        isOverBattlefieldRef.current = over;
        setIsOverBattlefield(over);
      }
    };

    const handlePointerUp = (pe: PointerEvent) => {
      if (pe.pointerId !== start.pointerId) return;
      teardown();
      if (!moved || isOverBattlefieldRef.current) onCastSpell(card.id);
      reset();
    };

    const handlePointerCancel = (pe: PointerEvent) => {
      if (pe.pointerId !== start.pointerId) return;
      teardown();
      reset();
    };

    if (isTouch && onLongPress) {
      longPress.start(start.clientX, start.clientY, () => {
        teardown();
        reset();
        onLongPress(card, { x: start.clientX, y: start.clientY });
      });
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerCancel);
    document.addEventListener("pointerdown", handleSecondPointerDown);
    teardownRef.current = () => {
      teardown();
      reset();
    };
  }

  return { draggingHandCard, ghostPos, isOverBattlefield, startHandCardDrag };
}
