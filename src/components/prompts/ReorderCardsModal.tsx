import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/game/Card";
import { PromptPresentation } from "./internal/PromptPresentation";
import type { PromptProps } from "./internal/promptProps";
import type { CardDto } from "@/protocol/game";
import type { ReorderCardsInput, ReorderCardsOutput } from "@/protocol";

const CARD_W = "w-[84px]";

function SortableCard({ id, card }: { id: string; card: CardDto }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
      }}
      {...attributes}
      {...listeners}
      className={`${CARD_W} shrink-0 cursor-grab touch-none`}
    >
      <Card card={card} className="w-full" />
    </div>
  );
}

export function ReorderCardsModal({
  input,
  respond,
}: PromptProps<ReorderCardsInput, ReorderCardsOutput>) {
  const { presentation, targetLabel, topOfDeck } = input;
  const cards = input.cards as CardDto[];
  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const [order, setOrder] = useState<string[] | null>(null);
  const ids = order ?? cards.map((c) => c.id);
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null);
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(active.id as string);
    const to = ids.indexOf(over.id as string);
    if (from >= 0 && to >= 0) setOrder(arrayMove(ids, from, to));
  }

  return (
    <Modal maxWidth="max-w-3xl" maxHeight="">
      <div className="p-5">
        <PromptPresentation presentation={presentation} forceHorizontal />
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e: DragStartEvent) => setActiveId(e.active.id as string)}
        onDragEnd={onDragEnd}
      >
        <div className="flex items-center justify-between px-5 pb-2 text-xs font-bold text-muted-foreground">
          <span>{topOfDeck ? "BOTTOM" : "FIRST"}</span>
          <span className="text-primary">{targetLabel}</span>
          <span>{topOfDeck ? "TOP" : "LAST"}</span>
        </div>
        <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
          <div className="flex max-h-[55dvh] flex-wrap justify-center gap-2 overflow-y-auto px-5 pb-4">
            {ids.map((id) => {
              const c = cardsById.get(id);
              return c ? <SortableCard key={id} id={id} card={c} /> : null;
            })}
          </div>
        </SortableContext>
        <DragOverlay>
          {activeId && cardsById.get(activeId) ? (
            <Card card={cardsById.get(activeId)!} className={CARD_W} />
          ) : null}
        </DragOverlay>
      </DndContext>

      <Modal.Footer className="justify-end">
        <Button size="sm" onClick={() => respond({ type: "reorderDecision", orderedCardIds: ids })}>
          Confirm Order
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
