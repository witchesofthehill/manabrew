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
  getHandBounds?: () => { y: number; height: number } | null;
  onClickCard: (card: CardDto, position: { clientX: number; clientY: number }) => void;
  onCastSpell: (cardId: string) => void;
  onBattlefieldDrop?: (card: CardDto, position: { clientX: number; clientY: number }) => void;
  dismissHover: () => void;
  onLongPress?: (card: CardDto, pos: { x: number; y: number }) => void;
}

interface HandDragIntent {
  canCast: boolean;
}

export function useHandDrag({
  battlefieldContainerRef,
  handDropExclusionPx = 0,
  getHandBounds,
  onClickCard,
  onCastSpell,
  onBattlefieldDrop,
  dismissHover,
  onLongPress,
}: UseHandDragOptions) {
  const [draggingHandCard, setDraggingHandCard] = useState<CardDto | null>(null);
  const [ghostPos, setGhostPos] = useState({ x: 0, y: 0 });
  const [isOverBattlefield, setIsOverBattlefield] = useState(false);
  const [isOverHand, setIsOverHand] = useState(false);
  const teardownRef = useRef<(() => void) | null>(null);

  useEffect(() => () => teardownRef.current?.(), []);

  function startHandCardDrag(card: CardDto, start: HandDragStart, intent: HandDragIntent) {
    dismissHover();
    teardownRef.current?.();

    const isTouch = start.pointerType === "touch";
    const deadZoneSq = isTouch ? LONG_PRESS_CANCEL_DIST_SQ : 25;
    let moved = false;
    const longPress = new LongPressTimer();

    const reset = () => {
      setDraggingHandCard(null);
      setIsOverBattlefield(false);
      setIsOverHand(false);
    };

    const teardown = () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerCancel);
      document.removeEventListener("pointerdown", handleSecondPointerDown);
      longPress.cancel();
      teardownRef.current = null;
    };
    const classifyPosition = (clientX: number, clientY: number) => {
      const rect = battlefieldContainerRef.current?.getBoundingClientRect();
      const inside =
        rect != null &&
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom;
      const handBounds = getHandBounds?.();
      const overHand =
        inside &&
        (handBounds
          ? clientY >= rect.top + handBounds.y &&
            clientY <= rect.top + handBounds.y + handBounds.height
          : handDropExclusionPx > 0 && clientY >= rect.bottom - handDropExclusionPx);
      return {
        overHand,
        overBattlefield: inside && !overHand && intent.canCast,
      };
    };

    const handleSecondPointerDown = (event: PointerEvent) => {
      if (event.pointerId === start.pointerId) return;
      teardown();
      reset();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== start.pointerId) return;
      longPress.move(event.clientX, event.clientY);
      if (!moved) {
        const dx = event.clientX - start.clientX;
        const dy = event.clientY - start.clientY;
        if (dx * dx + dy * dy < deadZoneSq) return;
        moved = true;
        longPress.cancel();
        setDraggingHandCard(card);
      }

      dismissHover();
      const { overHand, overBattlefield } = classifyPosition(event.clientX, event.clientY);
      setGhostPos({
        x: event.clientX,
        y: overHand ? start.clientY : event.clientY,
      });
      setIsOverBattlefield(overBattlefield);
      setIsOverHand(overHand);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== start.pointerId) return;
      teardown();
      if (!moved) {
        onClickCard(card, { clientX: event.clientX, clientY: event.clientY });
      } else {
        const { overBattlefield } = classifyPosition(event.clientX, event.clientY);
        if (overBattlefield) {
          onBattlefieldDrop?.(card, { clientX: event.clientX, clientY: event.clientY });
          onCastSpell(card.id);
        }
      }
      reset();
    };

    const handlePointerCancel = (event: PointerEvent) => {
      if (event.pointerId !== start.pointerId) return;
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

  return {
    draggingHandCard,
    ghostPos,
    isOverBattlefield,
    isOverHand,
    startHandCardDrag,
  };
}
