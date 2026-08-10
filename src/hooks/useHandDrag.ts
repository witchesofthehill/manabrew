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
  /** Press with no movement — the card's normal click behaviour. */
  onTap: (card: CardDto, at: { clientX: number; clientY: number }) => void;
  /** Fan slot the pointer is over, or null when it is outside the hand. */
  getReorderIndex: (clientX: number, clientY: number) => number | null;
  onReorder: (cardId: string, toIndex: number) => void;
  dismissHover: () => void;
  onLongPress?: (card: CardDto, pos: { x: number; y: number }) => void;
}

export function useHandDrag({
  battlefieldContainerRef,
  handDropExclusionPx = 0,
  onCastSpell,
  onTap,
  getReorderIndex,
  onReorder,
  dismissHover,
  onLongPress,
}: UseHandDragOptions) {
  const [draggingHandCard, setDraggingHandCard] = useState<CardDto | null>(null);
  const [ghostPos, setGhostPos] = useState({ x: 0, y: 0 });
  const [isOverBattlefield, setIsOverBattlefield] = useState(false);
  const [reorderIndex, setReorderIndex] = useState<number | null>(null);
  const isOverBattlefieldRef = useRef(false);
  const reorderIndexRef = useRef<number | null>(null);
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

    const setReorder = (index: number | null) => {
      reorderIndexRef.current = index;
      setReorderIndex(index);
    };

    const reset = () => {
      setDraggingHandCard(null);
      setIsOverBattlefield(false);
      isOverBattlefieldRef.current = false;
      setReorder(null);
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
        // The battlefield owns the drop while the pointer is over it; anywhere
        // else the drag is a reorder of the fan it came from.
        setReorder(over ? null : getReorderIndex(pe.clientX, pe.clientY));
      }
    };

    const handlePointerUp = (pe: PointerEvent) => {
      if (pe.pointerId !== start.pointerId) return;
      teardown();
      const toIndex = reorderIndexRef.current;
      if (!moved) onTap(card, { clientX: pe.clientX, clientY: pe.clientY });
      else if (isOverBattlefieldRef.current) onCastSpell(card.id);
      else if (toIndex != null) onReorder(card.id, toIndex);
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

  return { draggingHandCard, ghostPos, isOverBattlefield, reorderIndex, startHandCardDrag };
}
