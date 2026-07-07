import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  defaultDropAnimationSideEffects,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DropAnimation,
} from "@dnd-kit/core";
import { GoStack } from "react-icons/go";
import { GiArrowDunk, GiCardPickup, GiTombstone } from "react-icons/gi";

import { VortexCircleIcon } from "@/components/icons/VortexCircleIcon";
import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/game/Card";
import { stackObjectToCardStub } from "@/components/game/game.utils";
import { useGameStore } from "@/stores/useGameStore";
import { cn } from "@/lib/utils";
import { PromptPresentation } from "./internal/PromptPresentation";
import type { PromptProps } from "./internal/promptProps";
import type { CardDto } from "@/protocol/game";
import type { ScryInput, ScryOutput, ScryDestination } from "@/protocol";

const POOL = "pool";
const CARD_W = "w-[84px]";

const hideActiveDuringDrop = defaultDropAnimationSideEffects({
  styles: { active: { opacity: "0" } },
});
const DROP_ANIMATION: DropAnimation = {
  duration: 200,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
  sideEffects: (params) => {
    const card = params.dragOverlay.node.firstElementChild;
    if (card instanceof HTMLElement) {
      card.style.rotate = "0deg";
      card.style.boxShadow = "none";
    }
    return hideActiveDuringDrop(params);
  },
};

function DraggableCard({
  id,
  card,
  disabled,
  className,
}: {
  id: string;
  card: CardDto;
  disabled?: boolean;
  className?: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      {...(disabled ? {} : attributes)}
      {...(disabled ? {} : listeners)}
      className={cn(
        CARD_W,
        "relative shrink-0 touch-pan-x rounded-lg ring-primary",
        disabled ? "cursor-default" : "cursor-grab hover:z-10 hover:ring-2",
        isDragging && "opacity-0",
        className,
      )}
    >
      <Card card={card} className="w-full" bare />
    </div>
  );
}

function TopDeckIcon() {
  return (
    <div className="flex flex-col items-center">
      <GiArrowDunk preserveAspectRatio="none" className="mr-5 mb-2 h-6 w-8" />
      <GoStack className="-mt-1 h-10 w-10" />
    </div>
  );
}

function BottomDeckIcon() {
  return (
    <div className="flex flex-col items-center gap-1">
      <GiArrowDunk preserveAspectRatio="none" className="mr-5 h-6 w-8" />
      <div className="h-9 w-12 rounded-md border-2 border-dashed border-current" />
    </div>
  );
}

const DESTINATION_META: Record<ScryDestination, { label: string; verb: string; icon: ReactNode }> =
  {
    libraryTop: { label: "Top of Library", verb: "Put on top", icon: <TopDeckIcon /> },
    libraryBottom: { label: "Bottom of Library", verb: "Send to bottom", icon: <BottomDeckIcon /> },
    graveyard: {
      label: "Graveyard",
      verb: "To graveyard",
      icon: <GiTombstone className="h-11 w-11" />,
    },
    exile: { label: "Exile", verb: "Exile", icon: <VortexCircleIcon className="h-11 w-11" /> },
    hand: { label: "Hand", verb: "To hand", icon: <GiCardPickup className="h-11 w-11" /> },
  };

function ZoneHint({ destination }: { destination: ScryDestination }) {
  const { icon, verb } = DESTINATION_META[destination];
  return (
    <div className="flex flex-col items-center gap-2 text-muted-foreground/70">
      {icon}
      <span className="text-sm font-medium">{verb}</span>
    </div>
  );
}

function Zone({
  id,
  destination,
  ids,
  cardsById,
}: {
  id: string;
  destination: ScryDestination;
  ids: string[];
  cardsById: Map<string, CardDto>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div className="flex min-w-[140px] flex-1 flex-col">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {DESTINATION_META[destination].label}
      </p>
      <div
        ref={setNodeRef}
        className={cn(
          "flex h-[200px] items-center overflow-hidden rounded-lg border-2 border-dashed p-3 sm:h-[320px]",
          ids.length === 0 ? "justify-center" : "flex-nowrap justify-center",
          isOver ? "border-primary bg-primary/5" : "border-muted-foreground/40",
        )}
      >
        {ids.length === 0 && !isOver ? (
          <ZoneHint destination={destination} />
        ) : (
          ids.map((cid, i) => {
            const c = cardsById.get(cid);
            if (!c) return null;
            // Only the top of the stack (last placed) can be dragged out.
            const isTop = i === ids.length - 1;
            return (
              <DraggableCard
                key={cid}
                id={cid}
                card={c}
                disabled={!isTop}
                className={i > 0 ? "-ml-[64px]" : undefined}
              />
            );
          })
        )}
        {isOver && (
          <div
            className={cn(
              CARD_W,
              "relative z-20 aspect-[5/7] shrink-0 rounded-lg border-2 border-dashed border-primary bg-primary/8",
              ids.length > 0 && "-ml-[64px]",
            )}
          />
        )}
      </div>
    </div>
  );
}

function PoolRow({
  id,
  ids,
  cardsById,
}: {
  id: string;
  ids: string[];
  cardsById: Map<string, CardDto>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "always-scrollbar scrollbar-inset-x mx-5 mb-4 flex h-[150px] flex-nowrap items-center gap-2 overflow-x-auto rounded-lg border-2 border-dashed p-3",
        isOver ? "border-primary bg-primary/5" : "border-muted-foreground/40",
      )}
    >
      {ids.map((cid) => {
        const c = cardsById.get(cid);
        return c ? <DraggableCard key={cid} id={cid} card={c} /> : null;
      })}
    </div>
  );
}

export function ScryModal({ input, respond }: PromptProps<ScryInput, ScryOutput>) {
  const { presentation, zones } = input;
  const cards = input.cards as CardDto[];
  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const gameView = useGameStore((s) => s.gameView);
  const sourceCard = useMemo<CardDto | undefined>(() => {
    const id = presentation.sourceCardId;
    if (!id || !gameView) return undefined;
    const visible = [
      ...gameView.battlefield,
      ...gameView.players.flatMap((p) => [...p.hand, ...p.graveyard, ...p.exile, ...p.commandZone]),
    ];
    const gc = visible.find((c) => c.id === id);
    if (gc) return gc;
    const stackObj = gameView.stack.find((s) => s.sourceId === id);
    return stackObj ? (stackObjectToCardStub(stackObj) as CardDto) : undefined;
  }, [presentation.sourceCardId, gameView]);
  const zoneIds = useMemo(() => zones.map((_, i) => `z${i}`), [zones]);

  const [items, setItems] = useState<Record<string, string[]>>(() => ({
    [POOL]: cards.map((c) => c.id),
    ...Object.fromEntries(zoneIds.map((z) => [z, [] as string[]])),
  }));
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  // Re-seed when the card set changes (e.g. preview cards arrive after mount).
  const cardKey = useMemo(() => cards.map((c) => c.id).join("|"), [cards]);
  useEffect(() => {
    setItems({
      [POOL]: cards.map((c) => c.id),
      ...Object.fromEntries(zoneIds.map((z) => [z, [] as string[]])),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey]);

  const findContainer = (id: string) => Object.keys(items).find((k) => items[k].includes(id));

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over) return;
    const from = findContainer(active.id as string);
    const to = over.id as string;
    if (!from || !(to in items) || from === to) return;
    setItems((prev) => ({
      ...prev,
      [from]: prev[from].filter((i) => i !== active.id),
      [to]: [...prev[to], active.id as string], // dropped card lands on top of the stack
    }));
  }

  const allPlaced = items[POOL].length === 0;

  return (
    <Modal maxWidth="max-w-4xl" maxHeight="">
      {sourceCard && (
        <div className="pointer-events-none absolute top-0 left-full ml-6 drop-shadow-2xl">
          <Card card={sourceCard} bare className="w-[240px]" />
        </div>
      )}
      <div className="p-5 pb-3">
        <PromptPresentation
          presentation={{ ...presentation, sourceCardId: undefined }}
          forceHorizontal
        />
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={(e) => setActiveId(e.active.id as string)}
        onDragEnd={onDragEnd}
      >
        <p className="px-5 pb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Cards to place
        </p>
        <PoolRow id={POOL} ids={items[POOL]} cardsById={cardsById} />

        <div className="flex flex-wrap gap-3 px-5 pb-4">
          {zones.map((destination, i) => (
            <Zone
              key={zoneIds[i]}
              id={zoneIds[i]}
              destination={destination}
              ids={items[zoneIds[i]]}
              cardsById={cardsById}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={DROP_ANIMATION}>
          {activeId && cardsById.get(activeId) ? (
            <div className={cn(CARD_W, "rounded-lg ring-2 ring-primary rotate-6")}>
              <Card card={cardsById.get(activeId)!} className="w-full" bare />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <Modal.Footer className="justify-end gap-3">
        <span className="text-sm tabular-nums text-muted-foreground">
          {cards.length - items[POOL].length}/{cards.length} placed
        </span>
        <Button
          size="sm"
          disabled={!allPlaced}
          onClick={() =>
            // Engine convention: first id in each zone = top of that pile. The
            // last card dropped sits visually on top, so reverse the drop order.
            respond({
              type: "scryDecision",
              zoneCardIds: zoneIds.map((z) => [...items[z]].reverse()),
            })
          }
        >
          Confirm
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
