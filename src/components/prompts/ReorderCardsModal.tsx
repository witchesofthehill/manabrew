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
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PromptPresentation } from "./internal/PromptPresentation";
import type { PromptProps } from "./internal/promptProps";
import type { CardDto } from "@/protocol/game";
import type { ReorderInput, ReorderItem, ReorderOutput } from "@/protocol";

const CARD_W = "w-[120px]";

function RankBadge({ position }: { position: number }) {
  const isFirst = position === 1;
  return (
    <div
      className={cn(
        "pointer-events-none absolute -left-2 -top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full border-2 border-background text-xs font-bold tabular-nums shadow-md",
        isFirst ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
      )}
    >
      {position}
    </div>
  );
}

function SortableCard({
  id,
  card,
  oracle,
  position,
}: {
  id: string;
  card: CardDto;
  oracle?: string;
  position: number;
}) {
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
      className={cn(
        CARD_W,
        "group relative flex shrink-0 cursor-grab touch-none flex-col gap-1.5 rounded-lg ring-primary transition-shadow hover:z-10 hover:ring-2",
      )}
    >
      <RankBadge position={position} />
      <Card card={card} className="w-full" />
      {oracle && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="line-clamp-2 cursor-help rounded-md border bg-muted/40 px-2 py-1 text-[11px] leading-snug text-muted-foreground">
              {oracle}
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[16rem] leading-relaxed">
            <DynamicTextRender text={oracle} />
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export function ReorderCardsModal({ input, respond }: PromptProps<ReorderInput, ReorderOutput>) {
  const { presentation, items } = input;
  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i as ReorderItem])), [items]);
  const [order, setOrder] = useState<string[] | null>(null);
  const ids = order ?? items.map((i) => i.id);
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

      <Modal.Instructions>
        Drag to arrange — number 1 goes first, the rest follow in order
      </Modal.Instructions>

      <TooltipProvider delayDuration={150}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e: DragStartEvent) => setActiveId(e.active.id as string)}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
            <div className="flex max-h-[55dvh] flex-wrap justify-center gap-3 overflow-y-auto px-5 py-5">
              {ids.map((id, i) => {
                const item = itemsById.get(id);
                return item ? (
                  <SortableCard
                    key={id}
                    id={id}
                    card={item.card as CardDto}
                    oracle={item.oracle}
                    position={i + 1}
                  />
                ) : null;
              })}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeId && itemsById.get(activeId) ? (
              <Card
                card={itemsById.get(activeId)!.card as CardDto}
                className={cn(CARD_W, "rounded-lg ring-2 ring-primary")}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </TooltipProvider>

      <Modal.Footer className="justify-end">
        <Button size="sm" onClick={() => respond({ type: "reorderDecision", orderedIds: ids })}>
          Confirm Order
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
