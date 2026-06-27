import { CARD_W, CARD_H } from "@/components/game/game.constants";
import type { ScreenPos } from "./types";

const MOVE_THRESHOLD = 5;
const JUST_DRAGGED_CLEAR_MS = 300;

interface DragState {
  cardIds: string[];
  /** The card the user actually grabbed — used to anchor multi-card
   *  moves so every card in the selection translates by the same
   *  (col, row) delta rather than reassembling around the cursor. */
  primaryCardId: string;
  startPositions: Map<string, ScreenPos>;
  startMouseX: number;
  startMouseY: number;
  hasMoved: boolean;
}

interface HandExclusion {
  xStart: number;
  xEnd: number;
  topY: number;
}

export class DragHandler {
  private drag: DragState | null = null;
  private containerWidth = 0;
  private containerHeight = 0;
  private leftReserved = 0;
  private rightReserved = 0;
  private bottomReserved = 0;
  private cardScale = 1;
  /**
   * Horizontal band occupied by the hand fan. When set, dragging is only
   * clamped vertically where the card's x overlaps this band — outside it,
   * cards can travel all the way to the bottom of the canvas.
   */
  private handExclusion: HandExclusion | null = null;
  justDraggedCardIds = new Set<string>();
  private justDraggedTimer: ReturnType<typeof setTimeout> | null = null;

  setContainerSize(w: number, h: number): void {
    this.containerWidth = w;
    this.containerHeight = h;
  }

  setReserved(left: number, right: number, bottom: number): void {
    this.leftReserved = left;
    this.rightReserved = right;
    this.bottomReserved = bottom;
  }

  setHandExclusion(rect: { x: number; y: number; width: number; height: number } | null): void {
    this.handExclusion = rect ? { xStart: rect.x, xEnd: rect.x + rect.width, topY: rect.y } : null;
  }

  setCardScale(scale: number): void {
    this.cardScale = Math.max(0.1, scale);
  }

  get isDragging(): boolean {
    return this.drag !== null && this.drag.hasMoved;
  }

  get draggingCardIds(): Set<string> {
    if (!this.drag) return new Set();
    return new Set(this.drag.cardIds);
  }

  start(
    cardId: string,
    mouseX: number,
    mouseY: number,
    selectedCardIds: Set<string>,
    currentPositions: Map<string, ScreenPos>,
    shift: boolean,
  ): Set<string> {
    let selection = new Set(selectedCardIds);

    if (shift) {
      if (selection.has(cardId)) {
        selection.delete(cardId);
      } else {
        selection.add(cardId);
      }
    } else if (!selection.has(cardId)) {
      selection = new Set([cardId]);
    }

    const dragCards = [...selection];
    const startPositions = new Map<string, ScreenPos>();
    for (const id of dragCards) {
      const pos = currentPositions.get(id);
      if (pos) startPositions.set(id, { ...pos });
    }

    this.drag = {
      cardIds: dragCards,
      primaryCardId: cardId,
      startPositions,
      startMouseX: mouseX,
      startMouseY: mouseY,
      hasMoved: false,
    };

    return selection;
  }

  /** The card id the current drag was initiated on, or null when no
   *  drag is in progress. Used to anchor multi-card snap-to-grid. */
  get primaryDraggingCardId(): string | null {
    return this.drag?.primaryCardId ?? null;
  }

  move(mouseX: number, mouseY: number): Map<string, ScreenPos> | null {
    if (!this.drag) return null;

    const dx = mouseX - this.drag.startMouseX;
    const dy = mouseY - this.drag.startMouseY;

    if (!this.drag.hasMoved) {
      if (Math.abs(dx) < MOVE_THRESHOLD && Math.abs(dy) < MOVE_THRESHOLD) {
        return null;
      }
      this.drag.hasMoved = true;
    }

    const halfW = (CARD_W * this.cardScale) / 2;
    const halfH = (CARD_H * this.cardScale) / 2;
    const xMin = Math.max(0, this.leftReserved) + halfW;
    const xMax = Math.max(xMin, this.containerWidth - halfW - this.rightReserved);
    const yMin = halfH;
    const yMaxFloor = this.handExclusion
      ? this.containerHeight - halfH
      : Math.max(yMin, this.containerHeight - halfH - this.bottomReserved);

    const positions = new Map<string, ScreenPos>();
    for (const [id, start] of this.drag.startPositions) {
      const x = Math.max(xMin, Math.min(xMax, start.x + dx));
      let yMax = yMaxFloor;

      if (this.handExclusion) {
        const cardLeft = x - halfW;
        const cardRight = x + halfW;
        const overlapsHand =
          cardLeft < this.handExclusion.xEnd && cardRight > this.handExclusion.xStart;
        if (overlapsHand) {
          yMax = Math.max(yMin, this.handExclusion.topY - halfH);
        }
      }

      // Extra keep-out rects (stack panel, PASS cluster, etc.) are honored
      // by the grid's cell-blocked mask — the drop snaps the card into the
      // nearest unblocked cell. Clamping drag-Y against blocker tops here
      // used to push cards above any blocker they visually overlapped,
      // which made the gap between two stacked blockers (e.g. the stack
      // panel above the PASS cluster) impossible to reach. Leaving the
      // mid-drag Y free lets the user park the card anywhere in that gap
      // and the grid snap handles the legal placement on release.

      const y = Math.max(yMin, Math.min(yMax, start.y + dy));
      positions.set(id, { x, y });
    }

    return positions;
  }

  end(): { positions: Map<string, ScreenPos>; wasDrag: boolean } | null {
    if (!this.drag) return null;

    const result = {
      positions: new Map<string, ScreenPos>(),
      wasDrag: this.drag.hasMoved,
    };

    if (this.drag.hasMoved) {
      if (this.justDraggedTimer) clearTimeout(this.justDraggedTimer);
      this.justDraggedCardIds = new Set(this.drag.cardIds);
      this.justDraggedTimer = setTimeout(() => {
        this.justDraggedCardIds.clear();
      }, JUST_DRAGGED_CLEAR_MS);
    }

    this.drag = null;
    return result;
  }

  cancel(): void {
    this.drag = null;
  }

  destroy(): void {
    if (this.justDraggedTimer) clearTimeout(this.justDraggedTimer);
    this.justDraggedCardIds.clear();
  }
}
