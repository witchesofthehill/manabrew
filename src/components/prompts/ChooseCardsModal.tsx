import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/game/Card";
import { cn } from "@/lib/utils";
import { PromptPresentation } from "./internal/PromptPresentation";
import type { PromptProps } from "./internal/promptProps";
import type { GameCard } from "@/types/manabrew";
import type { ChooseCardsInput, ChooseCardsOutput } from "@/protocol";

const CARD_W = "w-[84px]";

function SelectableCard({
  id,
  card,
  selected,
  disabled,
  widthClass = CARD_W,
  onClick,
}: {
  id: string;
  card: GameCard;
  selected?: boolean;
  disabled?: boolean;
  widthClass?: string;
  onClick?: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      {...(disabled ? {} : attributes)}
      {...(disabled ? {} : listeners)}
      onClick={disabled ? undefined : onClick}
      className={cn(
        widthClass,
        "shrink-0 rounded transition-all",
        disabled ? "cursor-not-allowed opacity-30" : "cursor-pointer touch-none",
        isDragging && "opacity-30",
        selected && "ring-2 ring-primary",
      )}
    >
      <Card card={card} className="w-full" />
    </div>
  );
}

function Bucket({
  id,
  label,
  ids,
  cardsById,
}: {
  id: string;
  label: string;
  ids: string[];
  cardsById: Map<string, GameCard>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div className="flex-1">
      <p className="mb-2 text-xs font-bold text-muted-foreground">{label}</p>
      <div
        ref={setNodeRef}
        className={cn(
          "always-scrollbar flex h-[300px] flex-wrap content-start gap-2 overflow-y-auto rounded-lg border-2 border-dashed p-3",
          isOver ? "border-primary bg-primary/5" : "border-muted-foreground/40",
        )}
      >
        {ids.map((cid) => {
          const c = cardsById.get(cid);
          return c ? <SelectableCard key={cid} id={cid} card={c} /> : null;
        })}
      </div>
    </div>
  );
}

export function ChooseCardsModal({
  input,
  respond,
}: PromptProps<ChooseCardsInput, ChooseCardsOutput>) {
  const { presentation, min, max, targetLabel, otherLabel } = input;
  const cards = input.cards as GameCard[];
  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const twoBucket = otherLabel != null;

  const [buckets, setBuckets] = useState<Record<string, string[]> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const state = buckets ?? { other: cards.map((c) => c.id), target: [] };
  const chosen = twoBucket ? state.target : [...selected];
  const canConfirm = chosen.length >= min && chosen.length <= max;
  const atMax = selected.size >= max;

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null);
    if (!over) return;
    const to = over.id as string;
    if (to !== "other" && to !== "target") return;
    const from = state.other.includes(active.id as string) ? "other" : "target";
    if (from === to) return;
    setBuckets({
      other: state.other.filter((i) => i !== active.id),
      target: state.target.filter((i) => i !== active.id),
      [to]: [...state[to].filter((i) => i !== active.id), active.id as string],
    } as Record<string, string[]>);
  }

  return (
    <Modal maxWidth="max-w-3xl" maxHeight="">
      <div className="p-5">
        <PromptPresentation presentation={presentation} forceHorizontal />
      </div>

      {twoBucket ? (
        <DndContext
          sensors={sensors}
          onDragStart={(e: DragStartEvent) => setActiveId(e.active.id as string)}
          onDragEnd={onDragEnd}
        >
          <div className="flex gap-3 px-5 pb-4">
            <Bucket id="other" label={otherLabel!} ids={state.other} cardsById={cardsById} />
            <Bucket id="target" label={targetLabel} ids={state.target} cardsById={cardsById} />
          </div>
          <DragOverlay>
            {activeId && cardsById.get(activeId) ? (
              <Card card={cardsById.get(activeId)!} className={CARD_W} />
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <div className="always-scrollbar scrollbar-inset-x mb-4 flex flex-nowrap gap-3 overflow-x-auto px-5 pt-2 pb-4">
          {cards.map((c) => (
            <SelectableCard
              key={c.id}
              id={c.id}
              card={c}
              widthClass="w-[150px]"
              selected={selected.has(c.id)}
              disabled={atMax && !selected.has(c.id)}
              onClick={() =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                  return next;
                })
              }
            />
          ))}
        </div>
      )}

      <Modal.Footer className="justify-end gap-3">
        <span className="text-sm tabular-nums text-muted-foreground">
          {chosen.length}/{max}
        </span>
        <Button
          size="sm"
          disabled={!canConfirm}
          onClick={() => respond({ type: "chooseCardsDecision", chosenCardIds: chosen })}
        >
          {chosen.length === 0 && min === 0 ? "Skip" : "Confirm"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
