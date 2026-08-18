import { useRef, useState, useLayoutEffect, useCallback } from "react";
import { CARD_W, CARD_H, CARD_GAP as GAP } from "@/components/game/game.constants";
import { useMarquee } from "./useMarqueeSelection";

interface UseBattlefieldLayoutOptions {
  cardIds: string[];
  bottomReserved: number;
  leftReserved: number;
  rightReserved: number;
  landCardIds?: string[];
}

export function useBattlefieldLayout({
  cardIds,
  bottomReserved,
  leftReserved,
  rightReserved,
  landCardIds,
}: UseBattlefieldLayoutOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [draggingCardIds, setDraggingCardIds] = useState<Set<string>>(new Set());
  const [justDraggedCardIds, setJustDraggedCardIds] = useState<Set<string>>(new Set());

  const dragRef = useRef<{
    cardIds: string[];
    startMouseX: number;
    startMouseY: number;
    startPositions: Record<string, { x: number; y: number }>;
    moved: boolean;
  } | null>(null);

  const handleMarqueeComplete = useCallback(
    (rect: { left: number; top: number; width: number; height: number }, additive: boolean) => {
      const hits = new Set<string>();
      for (const [id, pos] of Object.entries(positions)) {
        if (
          pos.x < rect.left + rect.width &&
          pos.x + CARD_W > rect.left &&
          pos.y < rect.top + rect.height &&
          pos.y + CARD_H > rect.top
        ) {
          hits.add(id);
        }
      }
      setSelectedCardIds(additive ? new Set([...selectedCardIds, ...hits]) : hits);
    },
    [positions, selectedCardIds],
  );

  const { marqueeRect, handleContainerMouseDown } = useMarquee({
    onMarqueeComplete: handleMarqueeComplete,
    externalContainerRef: containerRef,
  });

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const containerW = containerRef.current.clientWidth;
    const containerH = containerRef.current.clientHeight;
    const xMin = Math.max(0, leftReserved);
    const xMaxByRight = Math.max(xMin, containerW - CARD_W - Math.max(0, rightReserved));
    const usableW = Math.max(CARD_W, xMaxByRight - xMin + CARD_W);
    const cols = Math.max(1, Math.floor((usableW + GAP) / (CARD_W + GAP)));
    const xMax = xMaxByRight;

    const landSet = landCardIds ? new Set(landCardIds) : null;
    const landRowY =
      containerH > 0 ? Math.max(0, containerH - CARD_H - Math.max(0, bottomReserved) - GAP) : 0;
    const cardIdSet = new Set(cardIds);

    setPositions((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        if (!cardIdSet.has(id)) delete next[id];
      }

      const isOccupied = (
        x: number,
        y: number,
        currentPositions: Record<string, { x: number; y: number }>,
      ) => {
        return Object.values(currentPositions).some((pos) => {
          return (
            x < pos.x + CARD_W + GAP / 2 &&
            x + CARD_W + GAP / 2 > pos.x &&
            y < pos.y + CARD_H + GAP / 2 &&
            y + CARD_H + GAP / 2 > pos.y
          );
        });
      };

      let nextNonLandSlot = 0;
      let nextLandSlot = 0;

      for (const id of cardIds) {
        if (!next[id]) {
          if (landSet?.has(id)) {
            while (true) {
              const x = Math.min(xMax, xMin + (nextLandSlot % cols) * (CARD_W + GAP) + GAP);
              const y = landRowY - Math.floor(nextLandSlot / cols) * (CARD_H + GAP); // Grow lands upward if they overflow
              if (!isOccupied(x, y, next) || nextLandSlot > 100) {
                next[id] = { x, y };
                break;
              }
              nextLandSlot++;
            }
          } else {
            while (true) {
              const x = Math.min(xMax, xMin + (nextNonLandSlot % cols) * (CARD_W + GAP) + GAP);
              const y = Math.floor(nextNonLandSlot / cols) * (CARD_H + GAP) + GAP;
              if (!isOccupied(x, y, next) || nextNonLandSlot > 200) {
                next[id] = { x, y };
                break;
              }
              nextNonLandSlot++;
            }
          }
        }
      }
      return next;
    });

    setSelectedCardIds((prev) => {
      const next = new Set([...prev].filter((id) => cardIdSet.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [cardIds, bottomReserved, leftReserved, rightReserved, landCardIds]);

  const handleCardMouseDown = useCallback(
    (e: React.MouseEvent, cardId: string) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.shiftKey) {
        setSelectedCardIds((prev) => {
          const next = new Set(prev);
          if (next.has(cardId)) next.delete(cardId);
          else next.add(cardId);
          return next;
        });
        return;
      }

      const pos = positions[cardId];
      if (!pos) return;

      const inSelection = selectedCardIds.has(cardId);
      const cardsToDrag = inSelection ? [...selectedCardIds] : [cardId];

      if (!inSelection) setSelectedCardIds(new Set());

      const startPositions: Record<string, { x: number; y: number }> = {};
      for (const id of cardsToDrag) {
        startPositions[id] = positions[id] ?? { x: 0, y: 0 };
      }

      dragRef.current = {
        cardIds: cardsToDrag,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startPositions,
        moved: false,
      };
      setDraggingCardIds(new Set(cardsToDrag));

      const handleMouseMove = (me: MouseEvent) => {
        // Snapshot the mutable ref into a local ONCE — after this line,
        // nothing in this handler reads dragRef.current again, so even if
        // handleMouseUp nulls it before React processes queued updaters
        // we are safe.
        const drag = dragRef.current;
        if (!drag) return;

        const dx = me.clientX - drag.startMouseX;
        const dy = me.clientY - drag.startMouseY;
        if (!drag.moved && Math.sqrt(dx * dx + dy * dy) < 5) return;
        drag.moved = true;

        const el = containerRef.current;
        if (!el) return;
        const xMin = Math.max(0, leftReserved);
        const xMax = Math.max(xMin, el.clientWidth - CARD_W - Math.max(0, rightReserved));

        const dragCardIds = drag.cardIds;
        const dragStartPositions = drag.startPositions;

        setPositions((prev) => {
          const next = { ...prev };
          for (const id of dragCardIds) {
            const start = dragStartPositions[id];
            if (!start) continue;
            next[id] = {
              x: Math.max(xMin, Math.min(xMax, start.x + dx)),
              y: Math.max(0, Math.min(el.clientHeight - CARD_H, start.y + dy)),
            };
          }
          return next;
        });
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        const drag = dragRef.current;
        dragRef.current = null;
        const draggedIds = drag?.moved ? [...drag.cardIds] : [];
        setDraggingCardIds(new Set());
        if (draggedIds.length > 0) {
          const draggedSet = new Set(draggedIds);
          setJustDraggedCardIds(draggedSet);
          setTimeout(
            () => setJustDraggedCardIds((prev) => (prev === draggedSet ? new Set() : prev)),
            0,
          );
        }
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [leftReserved, rightReserved, positions, selectedCardIds],
  );

  const wrappedHandleContainerMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Clear selection on click/drag on empty space (shift preserves it)
      if (!e.shiftKey) setSelectedCardIds(new Set());
      handleContainerMouseDown(e);
    },
    [handleContainerMouseDown],
  );

  return {
    containerRef,
    positions,
    selectedCardIds,
    draggingCardIds,
    justDraggedCardIds,
    marqueeRect,
    handleCardMouseDown,
    handleContainerMouseDown: wrappedHandleContainerMouseDown,
  };
}
